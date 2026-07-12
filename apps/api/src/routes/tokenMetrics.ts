import type { FastifyInstance } from 'fastify';
import type { PrismaClient, TokenMarketSnapshot } from '@prisma/client';
import { z } from 'zod';
import { isValidSolanaAddress } from '@memecoin-lab/shared';
import type { MarketDataProvider } from '../providers/market/marketDataProvider.js';
import {
  freshnessOf,
  USABLE_SNAPSHOT_STATUSES,
  type Freshness,
} from '../services/tokenMetrics/freshness.js';
import {
  MAX_TOKENS_PER_REFRESH,
  refreshTokenMetrics,
  releaseRefreshLock,
  tryAcquireRefreshLock,
} from '../services/tokenMetrics/refreshTokenMetrics.js';

const refreshBodySchema = z.object({
  /** Token IDs or mint addresses (max 20; 1–5 recommended). */
  tokens: z.array(z.string().trim().min(1)).min(1).max(MAX_TOKENS_PER_REFRESH),
  includeDev: z.boolean().default(false),
});

const historyQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export interface SnapshotDto {
  id: string;
  tokenId: string;
  refreshRunId: string;
  observedAt: string;
  fetchedAt: string;
  ageSeconds: number | null;
  freshness: Freshness;
  priceUsd: string | null;
  priceSol: string | null;
  marketCapUsd: string | null;
  fdvUsd: string | null;
  liquidityUsd: string | null;
  volume5mUsd: string | null;
  volume1hUsd: string | null;
  volume6hUsd: string | null;
  volume24hUsd: string | null;
  buys5m: number | null;
  sells5m: number | null;
  buys1h: number | null;
  sells1h: number | null;
  buys6h: number | null;
  sells6h: number | null;
  buys24h: number | null;
  sells24h: number | null;
  priceChange5mPct: string | null;
  priceChange1hPct: string | null;
  priceChange6hPct: string | null;
  priceChange24hPct: string | null;
  pairAddress: string | null;
  dex: string | null;
  baseMint: string | null;
  quoteMint: string | null;
  tokenName: string | null;
  tokenSymbol: string | null;
  source: string;
  status: string;
  confidence: string;
  selectionReason: string | null;
  sanitizedErrorCode: string | null;
}

export function snapshotDto(s: TokenMarketSnapshot, now = new Date()): SnapshotDto {
  const usable = (USABLE_SNAPSHOT_STATUSES as readonly string[]).includes(s.status);
  const { freshness, ageSeconds } = usable
    ? freshnessOf(s.observedAt, now)
    : { freshness: 'UNKNOWN' as Freshness, ageSeconds: null };
  return {
    id: s.id,
    tokenId: s.tokenId,
    refreshRunId: s.refreshRunId,
    observedAt: s.observedAt.toISOString(),
    fetchedAt: s.fetchedAt.toISOString(),
    ageSeconds,
    freshness,
    priceUsd: s.priceUsd,
    priceSol: s.priceSol,
    marketCapUsd: s.marketCapUsd,
    fdvUsd: s.fdvUsd,
    liquidityUsd: s.liquidityUsd,
    volume5mUsd: s.volume5mUsd,
    volume1hUsd: s.volume1hUsd,
    volume6hUsd: s.volume6hUsd,
    volume24hUsd: s.volume24hUsd,
    buys5m: s.buys5m,
    sells5m: s.sells5m,
    buys1h: s.buys1h,
    sells1h: s.sells1h,
    buys6h: s.buys6h,
    sells6h: s.sells6h,
    buys24h: s.buys24h,
    sells24h: s.sells24h,
    priceChange5mPct: s.priceChange5mPct,
    priceChange1hPct: s.priceChange1hPct,
    priceChange6hPct: s.priceChange6hPct,
    priceChange24hPct: s.priceChange24hPct,
    pairAddress: s.pairAddress,
    dex: s.dex,
    baseMint: s.baseMint,
    quoteMint: s.quoteMint,
    tokenName: s.tokenName,
    tokenSymbol: s.tokenSymbol,
    source: s.source,
    status: s.status,
    confidence: s.confidence,
    selectionReason: s.selectionReason,
    sanitizedErrorCode: s.sanitizedErrorCode,
  };
}

/** Latest USABLE (COMPLETE/PARTIAL) snapshot per token id. */
export async function latestUsableSnapshots(
  prisma: PrismaClient,
  tokenIds?: string[],
): Promise<Map<string, TokenMarketSnapshot>> {
  const rows = await prisma.tokenMarketSnapshot.findMany({
    where: {
      status: { in: [...USABLE_SNAPSHOT_STATUSES] },
      ...(tokenIds ? { tokenId: { in: tokenIds } } : {}),
    },
    orderBy: [{ tokenId: 'asc' }, { observedAt: 'desc' }, { createdAt: 'desc' }],
    distinct: ['tokenId'],
  });
  return new Map(rows.map((row) => [row.tokenId, row]));
}

export interface TokenMetricsRouteDeps {
  prisma: PrismaClient;
  marketProvider: MarketDataProvider;
  nodeEnv: string;
}

export function registerTokenMetricsRoutes(app: FastifyInstance, deps: TokenMetricsRouteDeps) {
  const { prisma, marketProvider } = deps;

  app.post('/api/token-metrics/refresh', async (request, reply) => {
    const body = refreshBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'validation_error', issues: body.error.issues });
    }
    const { tokens: selections, includeDev } = body.data;

    if (new Set(selections).size !== selections.length) {
      return reply.code(400).send({ error: 'duplicate_selection' });
    }
    if (!marketProvider.isConfigured()) {
      return reply.code(503).send({ error: 'provider_not_configured' });
    }
    if (includeDev && deps.nodeEnv === 'production') {
      return reply.code(403).send({ error: 'include_dev_disabled_in_production' });
    }

    // Selections may be token IDs or mint addresses. Anything that is neither
    // an existing token nor a valid mint format is rejected explicitly.
    const tokens = await prisma.token.findMany({
      where: { OR: [{ id: { in: selections } }, { mintAddress: { in: selections } }] },
    });
    const known = new Set(tokens.flatMap((t) => [t.id, t.mintAddress]));
    const unknown = selections.filter((s) => !known.has(s));
    if (unknown.length > 0) {
      const invalidFormat = unknown.filter(
        (s) => !s.startsWith('c') && !isValidSolanaAddress(s),
      );
      return reply.code(400).send({
        error: invalidFormat.length > 0 ? 'invalid_mint_address' : 'unknown_token',
        tokens: unknown,
      });
    }

    const devTokens = tokens.filter((t) => t.source === 'dev-seed');
    if (!includeDev && devTokens.length > 0) {
      return reply.code(400).send({
        error: 'dev_token_excluded',
        tokens: devTokens.map((t) => t.mintAddress),
        hint: 'Development tokens are skipped by default; pass includeDev: true to refresh them.',
      });
    }

    if (!tryAcquireRefreshLock()) {
      return reply.code(409).send({ error: 'refresh_in_progress' });
    }
    try {
      const result = await refreshTokenMetrics({ prisma, provider: marketProvider }, tokens);
      return result;
    } finally {
      releaseRefreshLock();
    }
  });

  app.get('/api/token-metrics', async () => {
    const latest = await latestUsableSnapshots(prisma);
    const now = new Date();
    return {
      items: [...latest.values()]
        .sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime())
        .map((s) => snapshotDto(s, now)),
      total: latest.size,
    };
  });

  app.get('/api/token-metrics/:mint/latest', async (request, reply) => {
    const { mint } = request.params as { mint: string };
    const token = await prisma.token.findUnique({ where: { mintAddress: mint } });
    if (!token) return reply.code(404).send({ error: 'unknown_token' });

    const [latestAny, usable] = await Promise.all([
      prisma.tokenMarketSnapshot.findFirst({
        where: { tokenId: token.id },
        orderBy: [{ fetchedAt: 'desc' }, { createdAt: 'desc' }],
      }),
      latestUsableSnapshots(prisma, [token.id]),
    ]);
    const usableSnapshot = usable.get(token.id) ?? null;
    const { freshness, ageSeconds } = usableSnapshot
      ? freshnessOf(usableSnapshot.observedAt)
      : { freshness: 'NEVER_FETCHED' as Freshness, ageSeconds: null };

    return {
      token: {
        id: token.id,
        mintAddress: token.mintAddress,
        name: token.name,
        symbol: token.symbol,
      },
      freshness,
      ageSeconds,
      latest: latestAny ? snapshotDto(latestAny) : null,
      latestUsable: usableSnapshot ? snapshotDto(usableSnapshot) : null,
    };
  });

  app.get('/api/token-metrics/:mint/snapshots', async (request, reply) => {
    const { mint } = request.params as { mint: string };
    const query = historyQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ error: 'validation_error', issues: query.error.issues });
    }
    const token = await prisma.token.findUnique({ where: { mintAddress: mint } });
    if (!token) return reply.code(404).send({ error: 'unknown_token' });

    const { page, pageSize } = query.data;
    const [items, total] = await Promise.all([
      prisma.tokenMarketSnapshot.findMany({
        where: { tokenId: token.id },
        orderBy: [{ observedAt: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.tokenMarketSnapshot.count({ where: { tokenId: token.id } }),
    ]);
    const now = new Date();
    return { items: items.map((s) => snapshotDto(s, now)), page, pageSize, total };
  });

  app.get('/api/token-metrics/refresh-runs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const run = await prisma.tokenMarketRefreshRun.findUnique({
      where: { id },
      include: {
        snapshots: {
          include: { token: { select: { mintAddress: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!run) return reply.code(404).send({ error: 'unknown_refresh_run' });
    const now = new Date();
    return {
      id: run.id,
      provider: run.provider,
      status: run.status,
      startedAt: run.startedAt.toISOString(),
      completedAt: run.completedAt?.toISOString() ?? null,
      requestedCount: run.requestedCount,
      processedCount: run.processedCount,
      completeCount: run.completeCount,
      partialCount: run.partialCount,
      notFoundCount: run.notFoundCount,
      errorCount: run.errorCount,
      snapshotCount: run.snapshotCount,
      sanitizedErrorSummary: run.sanitizedErrorSummary,
      snapshots: run.snapshots.map((s) => ({
        mint: s.token.mintAddress,
        ...snapshotDto(s, now),
      })),
    };
  });
}
