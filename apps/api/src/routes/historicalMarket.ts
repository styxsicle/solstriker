import type { FastifyInstance } from 'fastify';
import type { PrismaClient, TokenMarketCandle } from '@prisma/client';
import { z } from 'zod';
import { isValidSolanaAddress } from '@memecoin-lab/shared';
import type { HistoricalMarketProvider } from '../providers/historicalMarket/historicalMarketProvider.js';
import {
  backfillCandles,
  MAX_TOKENS_PER_BACKFILL,
  releaseBackfillLock,
  tryAcquireBackfillLock,
} from '../services/historicalMarket/backfillCandles.js';
import {
  isSupportedInterval,
  MAX_RANGE_SECONDS,
  SUPPORTED_INTERVALS,
} from '../services/historicalMarket/intervals.js';
import { tokenCoverage } from '../services/historicalMarket/coverage.js';

const backfillBodySchema = z.object({
  tokens: z.array(z.string().trim().min(1)).min(1).max(MAX_TOKENS_PER_BACKFILL),
  interval: z.enum(['1m', '5m', '15m', '1h']),
  start: z.string().datetime(),
  end: z.string().datetime(),
  includeDev: z.boolean().default(false),
});

const candlesQuerySchema = z.object({
  mint: z.string().trim().min(1),
  interval: z.enum(['1m', '5m', '15m', '1h']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(1000).default(200),
});

function candleDto(c: TokenMarketCandle) {
  return {
    id: c.id,
    tokenId: c.tokenId,
    pairAddress: c.pairAddress,
    interval: c.interval,
    openTime: c.openTime.toISOString(),
    closeTime: c.closeTime.toISOString(),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volumeUsd: c.volumeUsd,
    source: c.source,
    fetchedAt: c.fetchedAt.toISOString(),
    backfillRunId: c.backfillRunId,
  };
}

export interface HistoricalMarketRouteDeps {
  prisma: PrismaClient;
  historicalProvider: HistoricalMarketProvider;
  nodeEnv: string;
}

export function registerHistoricalMarketRoutes(
  app: FastifyInstance,
  deps: HistoricalMarketRouteDeps,
) {
  const { prisma, historicalProvider } = deps;

  app.post('/api/historical-market/backfill', async (request, reply) => {
    const body = backfillBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'validation_error', issues: body.error.issues });
    }
    const { tokens: selections, interval, start, end, includeDev } = body.data;

    if (new Set(selections).size !== selections.length) {
      return reply.code(400).send({ error: 'duplicate_selection' });
    }
    if (!isSupportedInterval(interval)) {
      return reply.code(400).send({ error: 'unsupported_interval', supported: SUPPORTED_INTERVALS });
    }
    const startSec = Math.floor(new Date(start).getTime() / 1000);
    const endSec = Math.floor(new Date(end).getTime() / 1000);
    if (endSec <= startSec) {
      return reply.code(400).send({ error: 'invalid_range', hint: 'end must be after start' });
    }
    if (endSec - startSec > MAX_RANGE_SECONDS[interval]) {
      return reply.code(400).send({
        error: 'range_too_large',
        maxSeconds: MAX_RANGE_SECONDS[interval],
        interval,
      });
    }
    if (!historicalProvider.isConfigured()) {
      return reply.code(503).send({ error: 'provider_not_configured' });
    }
    if (includeDev && deps.nodeEnv === 'production') {
      return reply.code(403).send({ error: 'include_dev_disabled_in_production' });
    }

    const found = await prisma.token.findMany({
      where: { OR: [{ id: { in: selections } }, { mintAddress: { in: selections } }] },
    });
    const known = new Set(found.flatMap((t) => [t.id, t.mintAddress]));
    const unknown = selections.filter((s) => !known.has(s));
    if (unknown.length > 0) {
      const invalidFormat = unknown.filter((s) => !s.startsWith('c') && !isValidSolanaAddress(s));
      return reply.code(400).send({
        error: invalidFormat.length > 0 ? 'invalid_mint_address' : 'unknown_token',
        tokens: unknown,
      });
    }
    const devTokens = found.filter((t) => t.source === 'dev-seed');
    if (!includeDev && devTokens.length > 0) {
      return reply.code(400).send({
        error: 'dev_token_excluded',
        tokens: devTokens.map((t) => t.mintAddress),
      });
    }

    if (!tryAcquireBackfillLock()) {
      return reply.code(409).send({ error: 'backfill_in_progress' });
    }
    try {
      return await backfillCandles({ prisma, provider: historicalProvider }, found, {
        interval,
        startSec,
        endSec,
      });
    } finally {
      releaseBackfillLock();
    }
  });

  app.get('/api/historical-market/candles', async (request, reply) => {
    const query = candlesQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ error: 'validation_error', issues: query.error.issues });
    }
    const token = await prisma.token.findUnique({ where: { mintAddress: query.data.mint } });
    if (!token) return reply.code(404).send({ error: 'unknown_token' });

    const { page, pageSize, interval } = query.data;
    const where = { tokenId: token.id, ...(interval ? { interval } : {}) };
    const [items, total] = await Promise.all([
      prisma.tokenMarketCandle.findMany({
        where,
        orderBy: { openTime: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.tokenMarketCandle.count({ where }),
    ]);
    return { items: items.map(candleDto), page, pageSize, total };
  });

  app.get('/api/historical-market/:mint/coverage', async (request, reply) => {
    const { mint } = request.params as { mint: string };
    const token = await prisma.token.findUnique({ where: { mintAddress: mint } });
    if (!token) return reply.code(404).send({ error: 'unknown_token' });
    const coverage = await tokenCoverage(prisma, token.id);
    return { token: { id: token.id, mintAddress: token.mintAddress }, coverage };
  });

  app.get('/api/historical-market/backfill-runs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const run = await prisma.historicalMarketBackfillRun.findUnique({ where: { id } });
    if (!run) return reply.code(404).send({ error: 'unknown_backfill_run' });
    return {
      id: run.id,
      provider: run.provider,
      status: run.status,
      startedAt: run.startedAt.toISOString(),
      completedAt: run.completedAt?.toISOString() ?? null,
      requestedTokenCount: run.requestedTokenCount,
      processedTokenCount: run.processedTokenCount,
      requestedInterval: run.requestedInterval,
      requestedStart: run.requestedStart.toISOString(),
      requestedEnd: run.requestedEnd.toISOString(),
      candlesInserted: run.candlesInserted,
      candlesUpdated: run.candlesUpdated,
      duplicatesPrevented: run.duplicatesPrevented,
      gapCount: run.gapCount,
      completeCount: run.completeCount,
      partialCount: run.partialCount,
      notFoundCount: run.notFoundCount,
      errorCount: run.errorCount,
      sanitizedErrorSummary: run.sanitizedErrorSummary,
    };
  });
}
