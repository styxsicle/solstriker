import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { latestUsableSnapshots, snapshotDto, type SnapshotDto } from './tokenMetrics.js';

const tokensQuerySchema = z.object({
  // 'false' hides synthetic dev-seed records; absent keeps prior behavior.
  includeDev: z.enum(['true', 'false']).optional(),
  // 'true' attaches each token's latest usable market snapshot (Phase 1D-B1).
  withMarket: z.enum(['true', 'false']).optional(),
  // Filter on market-data presence.
  marketData: z.enum(['with', 'without']).optional(),
  // JS-side sort (financial values are stored as exact decimal strings).
  sort: z.enum(['discovered', 'marketCap', 'liquidity', 'volume24h', 'lastCollected']).optional(),
});

const sortValue = (market: SnapshotDto | null, key: string): number | null => {
  if (!market) return null;
  const raw =
    key === 'marketCap'
      ? market.marketCapUsd
      : key === 'liquidity'
        ? market.liquidityUsd
        : key === 'volume24h'
          ? market.volume24hUsd
          : market.observedAt;
  if (raw === null) return null;
  const parsed = key === 'lastCollected' ? Date.parse(raw) : Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

export function registerTokenRoutes(app: FastifyInstance, prisma: PrismaClient) {
  app.get('/api/tokens', async (request, reply) => {
    const query = tokensQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ error: 'validation_error', issues: query.error.issues });
    }
    const { includeDev, withMarket, marketData, sort } = query.data;

    const tokens = await prisma.token.findMany({
      where: includeDev === 'false' ? { source: { not: 'dev-seed' } } : {},
      orderBy: { discoveredAt: 'desc' },
    });

    const attachMarket = withMarket === 'true';
    const latest = attachMarket
      ? await latestUsableSnapshots(
          prisma,
          tokens.map((t) => t.id),
        )
      : new Map<string, never>();
    const now = new Date();

    let items = tokens.map((t) => ({
      id: t.id,
      mintAddress: t.mintAddress,
      name: t.name,
      symbol: t.symbol,
      stage: t.stage,
      source: t.source,
      discoveredAt: t.discoveredAt.toISOString(),
      lastSeenAt: t.lastSeenAt.toISOString(),
      ...(attachMarket
        ? { market: latest.has(t.id) ? snapshotDto(latest.get(t.id)!, now) : null }
        : {}),
    }));

    if (attachMarket && marketData) {
      items = items.filter((item) =>
        marketData === 'with' ? item.market !== null : item.market === null,
      );
    }
    if (attachMarket && sort && sort !== 'discovered') {
      // Descending, unknown values last — missing data is never treated as zero.
      items = [...items].sort((a, b) => {
        const av = sortValue(a.market ?? null, sort);
        const bv = sortValue(b.market ?? null, sort);
        if (av === null && bv === null) return 0;
        if (av === null) return 1;
        if (bv === null) return -1;
        return bv - av;
      });
    }

    return {
      items,
      total: items.length,
      liveDiscovery: false, // token discovery still comes from wallet activity only
    };
  });
}
