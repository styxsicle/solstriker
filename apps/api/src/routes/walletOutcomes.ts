import type { FastifyInstance } from 'fastify';
import type { PrismaClient, WalletEntryOutcome } from '@prisma/client';
import { z } from 'zod';
import {
  calculateOutcomes,
  CALCULATION_VERSION,
  MAX_EVENTS_PER_CALCULATION,
} from '../services/walletOutcomes/calculateOutcomes.js';

const calcBodySchema = z
  .object({
    walletEventIds: z.array(z.string().trim().min(1)).max(MAX_EVENTS_PER_CALCULATION).optional(),
    tokens: z.array(z.string().trim().min(1)).max(50).optional(),
  })
  .refine((b) => (b.walletEventIds && b.walletEventIds.length > 0) || (b.tokens && b.tokens.length > 0), {
    message: 'provide walletEventIds or tokens',
  });

const listQuerySchema = z.object({
  walletId: z.string().optional(),
  tokenId: z.string().optional(),
  status: z.enum(['COMPLETE', 'PARTIAL', 'UNAVAILABLE', 'ERROR']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export function outcomeDto(o: WalletEntryOutcome) {
  return {
    id: o.id,
    walletEventId: o.walletEventId,
    tokenId: o.tokenId,
    pairAddress: o.pairAddress,
    entryTime: o.entryTime.toISOString(),
    entryPriceUsd: o.entryPriceUsd,
    entryPriceMethod: o.entryPriceMethod,
    entryCandleTime: o.entryCandleTime?.toISOString() ?? null,
    entryDelaySeconds: o.entryDelaySeconds,
    price1mUsd: o.price1mUsd,
    price5mUsd: o.price5mUsd,
    price15mUsd: o.price15mUsd,
    price30mUsd: o.price30mUsd,
    price1hUsd: o.price1hUsd,
    price4hUsd: o.price4hUsd,
    price24hUsd: o.price24hUsd,
    return1mPct: o.return1mPct,
    return5mPct: o.return5mPct,
    return15mPct: o.return15mPct,
    return30mPct: o.return30mPct,
    return1hPct: o.return1hPct,
    return4hPct: o.return4hPct,
    return24hPct: o.return24hPct,
    maxPrice1hUsd: o.maxPrice1hUsd,
    minPrice1hUsd: o.minPrice1hUsd,
    maxReturn1hPct: o.maxReturn1hPct,
    maxDrawdown1hPct: o.maxDrawdown1hPct,
    timeToMax1hSeconds: o.timeToMax1hSeconds,
    maxPrice24hUsd: o.maxPrice24hUsd,
    minPrice24hUsd: o.minPrice24hUsd,
    maxReturn24hPct: o.maxReturn24hPct,
    maxDrawdown24hPct: o.maxDrawdown24hPct,
    timeToMax24hSeconds: o.timeToMax24hSeconds,
    status: o.status,
    confidence: o.confidence,
    coverageStart: o.coverageStart?.toISOString() ?? null,
    coverageEnd: o.coverageEnd?.toISOString() ?? null,
    missingWindowCount: o.missingWindowCount,
    calculationVersion: o.calculationVersion,
    calculatedAt: o.calculatedAt.toISOString(),
  };
}

export interface WalletOutcomesRouteDeps {
  prisma: PrismaClient;
}

export function registerWalletOutcomesRoutes(app: FastifyInstance, deps: WalletOutcomesRouteDeps) {
  const { prisma } = deps;

  app.post('/api/wallet-entry-outcomes/calculate', async (request, reply) => {
    const body = calcBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'validation_error', issues: body.error.issues });
    }

    // Resolve the target BUY events (by explicit ids, or eligible BUYs of the
    // selected tokens). Never "all events in the database".
    let eventIds = body.data.walletEventIds ?? [];
    if (body.data.tokens && body.data.tokens.length > 0) {
      const tokens = await prisma.token.findMany({
        where: {
          OR: [{ id: { in: body.data.tokens } }, { mintAddress: { in: body.data.tokens } }],
        },
        select: { id: true },
      });
      const tokenEvents = await prisma.walletEvent.findMany({
        where: {
          tokenId: { in: tokens.map((t) => t.id) },
          eventType: 'BUY',
          confidence: { in: ['CONFIRMED', 'LIKELY'] },
        },
        select: { id: true },
        take: MAX_EVENTS_PER_CALCULATION,
      });
      eventIds = [...new Set([...eventIds, ...tokenEvents.map((e) => e.id)])];
    }

    if (eventIds.length === 0) {
      return reply.code(400).send({ error: 'no_events_selected' });
    }
    if (eventIds.length > MAX_EVENTS_PER_CALCULATION) {
      return reply.code(400).send({ error: 'too_many_events', max: MAX_EVENTS_PER_CALCULATION });
    }

    const events = await prisma.walletEvent.findMany({ where: { id: { in: eventIds } } });
    if (events.length === 0) {
      return reply.code(400).send({ error: 'unknown_events' });
    }
    return calculateOutcomes({ prisma }, events);
  });

  app.get('/api/wallet-entry-outcomes', async (request, reply) => {
    const query = listQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ error: 'validation_error', issues: query.error.issues });
    }
    const { walletId, tokenId, status, page, pageSize } = query.data;
    const where = {
      calculationVersion: CALCULATION_VERSION,
      ...(tokenId ? { tokenId } : {}),
      ...(status ? { status } : {}),
      ...(walletId ? { walletEvent: { walletId } } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.walletEntryOutcome.findMany({
        where,
        orderBy: { entryTime: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.walletEntryOutcome.count({ where }),
    ]);
    return { items: items.map(outcomeDto), page, pageSize, total };
  });

  app.get('/api/wallet-entry-outcomes/:walletEventId', async (request, reply) => {
    const { walletEventId } = request.params as { walletEventId: string };
    const outcome = await prisma.walletEntryOutcome.findFirst({
      where: { walletEventId, calculationVersion: CALCULATION_VERSION },
      orderBy: { calculationVersion: 'desc' },
    });
    if (!outcome) return reply.code(404).send({ error: 'no_outcome' });
    return outcomeDto(outcome);
  });
}
