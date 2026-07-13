/**
 * FOMO Simulator V1 — paper calls only.
 *
 * Every route is user-triggered and works exclusively on already-stored
 * data: no provider calls, no background monitoring, no price polling, no
 * real trading, no wallet connection, no signing. The call action is always
 * derived on the backend (see services/fomoSimulator/mapping.ts) — a
 * frontend-provided action is ignored by design because the schema simply
 * has no field for one.
 */
import type { FastifyInstance } from 'fastify';
import type { PaperCall, PaperPosition, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { MAX_LOOKBACK_DAYS, MAX_SLOW_COOK_WALLETS, MAX_CANDIDATE_LIMIT } from '../services/slowCook/analyze.js';
import { recordPaperCall } from '../services/fomoSimulator/recordCall.js';
import { refreshPositionValuation } from '../services/fomoSimulator/refresh.js';
import { buildFomoSummary } from '../services/fomoSimulator/summary.js';
import { MAX_ASSUMPTION_PCT, MAX_NOTIONAL_USD, MIN_NOTIONAL_USD } from '../services/fomoSimulator/math.js';

/** Positive decimal string, e.g. "100" or "0.3". Never a float. */
const decimalString = z
  .string()
  .regex(/^\d+(\.\d+)?$/, 'must be a plain decimal string');

const amountSchema = decimalString.refine(
  (value) => Number(value) >= MIN_NOTIONAL_USD && Number(value) <= MAX_NOTIONAL_USD,
  `must be between ${MIN_NOTIONAL_USD} and ${MAX_NOTIONAL_USD} USD`,
);
const assumptionPctSchema = decimalString.refine(
  (value) => Number(value) >= 0 && Number(value) <= MAX_ASSUMPTION_PCT,
  `must be between 0 and ${MAX_ASSUMPTION_PCT} percent`,
);

const recordCallSchema = z.object({
  tokenId: z.string().min(1),
  walletIds: z.array(z.string().min(1)).min(1).max(MAX_SLOW_COOK_WALLETS),
  lookbackDays: z.coerce.number().int().min(1).max(MAX_LOOKBACK_DAYS).optional(),
  minimumWallets: z.coerce.number().int().min(1).max(MAX_SLOW_COOK_WALLETS).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_CANDIDATE_LIMIT).optional(),
  includeLowerConfidence: z.boolean().optional(),
  simulatedAmountUsd: amountSchema.optional(),
  assumptions: z
    .object({
      feeRatePct: assumptionPctSchema.optional(),
      entrySlippagePct: assumptionPctSchema.optional(),
      exitSlippagePct: assumptionPctSchema.optional(),
    })
    .optional(),
});

const parseArray = (json: string | null): unknown[] => {
  if (json === null) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};
const parseObject = (json: string | null): unknown => {
  if (json === null) return null;
  try {
    return JSON.parse(json) as unknown;
  } catch {
    return null;
  }
};

export function serializeCall(call: PaperCall) {
  return {
    ...call,
    walletIds: parseArray(call.walletIdsJson),
    walletAddresses: parseArray(call.walletAddressesJson),
    walletLabels: parseArray(call.walletLabelsJson),
    styleSummaries: parseArray(call.styleSummariesJson),
    reasons: parseArray(call.reasonsJson),
    invalidation: parseArray(call.invalidationJson),
    evidence: parseObject(call.evidenceJson),
    dataQuality: parseObject(call.dataQualityJson),
    settings: parseObject(call.settingsJson),
    warningCodes: parseArray(call.warningCodes),
  };
}

export function serializePosition(position: PaperPosition) {
  return {
    ...position,
    walletIds: parseArray(position.walletIdsJson),
    entryWarningCodes: parseArray(position.entryWarningCodes),
  };
}

export function registerFomoSimulatorRoutes(app: FastifyInstance, prisma: PrismaClient) {
  app.post('/api/fomo-simulator/calls', async (request, reply) => {
    const body = recordCallSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'validation_error' });
    const { walletIds, tokenId } = body.data;
    if (new Set(walletIds).size !== walletIds.length) {
      return reply.code(400).send({ error: 'duplicate_selection' });
    }

    const [wallets, token] = await Promise.all([
      prisma.trackedWallet.findMany({ where: { id: { in: walletIds } } }),
      prisma.token.findUnique({ where: { id: tokenId } }),
    ]);
    if (wallets.length !== walletIds.length) return reply.code(400).send({ error: 'unknown_wallet' });
    if (wallets.some((wallet) => wallet.source === 'dev-seed')) {
      return reply.code(400).send({ error: 'dev_wallet_excluded' });
    }
    if (!token) return reply.code(400).send({ error: 'unknown_token' });

    try {
      const result = await recordPaperCall(prisma, body.data);
      if (result.outcome === 'DUPLICATE') {
        return reply.code(409).send({ error: 'duplicate_call', paperCallId: result.existingCallId });
      }
      if (result.outcome === 'STALE_ANALYSIS') {
        return reply.code(409).send({ error: 'stale_analysis' });
      }
      return {
        call: serializeCall(result.call),
        position: result.position ? serializePosition(result.position) : null,
      };
    } catch {
      return reply.code(500).send({ error: 'paper_call_failed' });
    }
  });

  app.get('/api/fomo-simulator/calls', async () => {
    const calls = await prisma.paperCall.findMany({ orderBy: { createdAt: 'desc' } });
    return { items: calls.map(serializeCall), total: calls.length };
  });

  app.get('/api/fomo-simulator/positions', async () => {
    const positions = await prisma.paperPosition.findMany({ orderBy: { openedAt: 'desc' } });
    return { items: positions.map(serializePosition), total: positions.length };
  });

  app.get('/api/fomo-simulator/positions/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const position = await prisma.paperPosition.findUnique({
      where: { id },
      include: {
        calls: { orderBy: { createdAt: 'asc' } },
        valuations: { orderBy: { observedAt: 'asc' } },
      },
    });
    if (!position) return reply.code(404).send({ error: 'position_not_found' });
    const { calls, valuations, ...rest } = position;
    return {
      ...serializePosition(rest as PaperPosition),
      calls: calls.map(serializeCall),
      valuations,
    };
  });

  app.post('/api/fomo-simulator/positions/:id/refresh', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const result = await refreshPositionValuation(prisma, id);
      if (!result) return reply.code(404).send({ error: 'position_not_found' });
      return {
        position: serializePosition(result.position),
        valuationCreated: result.valuationCreated,
        skippedReason: result.skippedReason,
      };
    } catch {
      return reply.code(500).send({ error: 'refresh_failed' });
    }
  });

  app.get('/api/fomo-simulator/summary', async () => buildFomoSummary(prisma));
}
