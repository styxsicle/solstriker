/**
 * Phase 2C-A — strategy-fingerprint APIs.
 *
 * Read routes expose only the LATEST COMPLETED fingerprint per wallet;
 * historical runs stay queryable by run id but are never mixed into the
 * current view. There is deliberately no ranking, leaderboard, top-wallet or
 * ownership-inference endpoint here, and no route recommends following,
 * copying or trading anything.
 */
import type { FastifyInstance } from 'fastify';
import type { PrismaClient, WalletStrategyFingerprint, WalletStrategyPatternMetric } from '@prisma/client';
import { z } from 'zod';
import {
  analyzeStrategies,
  MAX_STRATEGY_WALLETS,
  releaseStrategyLock,
  tryAcquireStrategyLock,
} from '../services/walletStrategies/analyzeStrategies.js';
import { latestFingerprintByWallet } from '../services/walletStrategies/latestRuns.js';

const analyzeSchema = z.object({
  walletIds: z.array(z.string().min(1)).min(1).max(MAX_STRATEGY_WALLETS),
});
const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  confidence: z.string().optional(),
});
const patternSchema = z.object({ patternType: z.string().optional() });

const parse = (json: string): unknown => {
  try {
    return JSON.parse(json);
  } catch {
    return [];
  }
};

type FingerprintRow = WalletStrategyFingerprint & {
  patterns?: WalletStrategyPatternMetric[];
  trackedWallet?: { address: string; label: string | null; emoji: string | null };
};

const patternDto = (pattern: WalletStrategyPatternMetric) => ({
  ...pattern,
  warningCodes: parse(pattern.warningCodes),
  createdAt: pattern.createdAt.toISOString(),
  updatedAt: pattern.updatedAt.toISOString(),
});

const dto = (fingerprint: FingerprintRow) => ({
  ...fingerprint,
  descriptorCodes: parse(fingerprint.descriptorCodes),
  descriptorEvidence: parse(fingerprint.descriptorEvidenceJson),
  descriptorEvidenceJson: undefined,
  warningCodes: parse(fingerprint.warningCodes),
  calculatedAt: fingerprint.calculatedAt.toISOString(),
  createdAt: fingerprint.createdAt.toISOString(),
  updatedAt: fingerprint.updatedAt.toISOString(),
  patterns: fingerprint.patterns?.map(patternDto),
});

export function registerWalletStrategyRoutes(app: FastifyInstance, prisma: PrismaClient) {
  app.post('/api/wallet-strategies/analyze', async (request, reply) => {
    const body = analyzeSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'validation_error' });
    const { walletIds } = body.data;
    if (new Set(walletIds).size !== walletIds.length) {
      return reply.code(400).send({ error: 'duplicate_selection' });
    }
    const wallets = await prisma.trackedWallet.findMany({ where: { id: { in: walletIds } } });
    if (wallets.length !== walletIds.length) return reply.code(400).send({ error: 'unknown_wallet' });
    if (wallets.some((wallet) => wallet.source === 'dev-seed')) {
      return reply.code(400).send({ error: 'dev_wallet_excluded' });
    }
    if (!tryAcquireStrategyLock()) return reply.code(409).send({ error: 'analysis_in_progress' });
    try {
      // Selection order is preserved so the primary wallet can be analyzed first.
      const ordered = walletIds.flatMap((id) => wallets.filter((wallet) => wallet.id === id));
      return await analyzeStrategies(prisma, ordered);
    } catch {
      // Sanitized: an internal failure never returns paths, keys or driver text.
      return reply.code(500).send({ error: 'strategy_analysis_failed' });
    } finally {
      // Always released, including after a failure, so the lab never deadlocks.
      releaseStrategyLock();
    }
  });

  app.get('/api/wallet-strategies', async (request, reply) => {
    const query = listSchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'validation_error' });
    const { page, pageSize, confidence } = query.data;
    const ids = [...(await latestFingerprintByWallet(prisma)).values()];
    const where = { id: { in: ids }, ...(confidence ? { confidence } : {}) };
    const [items, total] = await Promise.all([
      prisma.walletStrategyFingerprint.findMany({
        where,
        include: {
          trackedWallet: { select: { address: true, label: true, emoji: true } },
          patterns: { orderBy: [{ patternType: 'asc' }, { sortOrder: 'asc' }, { patternValue: 'asc' }] },
        },
        orderBy: { trackedWalletId: 'asc' }, // stable, non-performance ordering
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.walletStrategyFingerprint.count({ where }),
    ]);
    return { items: items.map(dto), page, pageSize, total };
  });

  app.get('/api/wallet-strategies/:walletId/patterns', async (request, reply) => {
    const { walletId } = request.params as { walletId: string };
    const query = patternSchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'validation_error' });
    const fingerprintId = (await latestFingerprintByWallet(prisma)).get(walletId);
    if (!fingerprintId) return reply.code(404).send({ error: 'strategy_fingerprint_not_found' });
    const items = await prisma.walletStrategyPatternMetric.findMany({
      where: {
        fingerprintId,
        ...(query.data.patternType ? { patternType: query.data.patternType } : {}),
      },
      orderBy: [{ patternType: 'asc' }, { sortOrder: 'asc' }, { patternValue: 'asc' }],
    });
    return { fingerprintId, items: items.map(patternDto) };
  });

  app.get('/api/wallet-strategies/:walletId', async (request, reply) => {
    const { walletId } = request.params as { walletId: string };
    const fingerprintId = (await latestFingerprintByWallet(prisma)).get(walletId);
    if (!fingerprintId) return reply.code(404).send({ error: 'strategy_fingerprint_not_found' });
    const fingerprint = await prisma.walletStrategyFingerprint.findUnique({
      where: { id: fingerprintId },
      include: {
        trackedWallet: { select: { address: true, label: true, emoji: true } },
        patterns: { orderBy: [{ patternType: 'asc' }, { sortOrder: 'asc' }, { patternValue: 'asc' }] },
      },
    });
    return dto(fingerprint as FingerprintRow);
  });

  app.get('/api/wallet-strategy-runs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const run = await prisma.walletStrategyFingerprintRun.findUnique({ where: { id } });
    if (!run) return reply.code(404).send({ error: 'strategy_run_not_found' });
    return {
      ...run,
      startedAt: run.startedAt.toISOString(),
      completedAt: run.completedAt?.toISOString() ?? null,
      createdAt: run.createdAt.toISOString(),
      updatedAt: run.updatedAt.toISOString(),
    };
  });
}
