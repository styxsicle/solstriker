import type { PrismaClient } from '@prisma/client';

export interface TokenCoverage {
  pairAddress: string | null;
  interval: string | null;
  earliestCandle: string | null;
  latestCandle: string | null;
  candleCount: number;
  gapCount: number;
  lastBackfillAt: string | null;
  status: 'NONE' | 'PARTIAL' | 'COVERED';
}

/**
 * Read-only candle-coverage summary for a token. Reports the stored series
 * (per the most-recently-backfilled pair+interval), not a live fetch.
 */
export async function tokenCoverage(
  prisma: PrismaClient,
  tokenId: string,
): Promise<TokenCoverage> {
  const latest = await prisma.tokenMarketCandle.findFirst({
    where: { tokenId },
    orderBy: [{ fetchedAt: 'desc' }, { createdAt: 'desc' }],
    select: { pairAddress: true, interval: true, fetchedAt: true },
  });
  if (!latest) {
    return {
      pairAddress: null,
      interval: null,
      earliestCandle: null,
      latestCandle: null,
      candleCount: 0,
      gapCount: 0,
      lastBackfillAt: null,
      status: 'NONE',
    };
  }

  const where = { tokenId, pairAddress: latest.pairAddress, interval: latest.interval };
  const [count, earliest, newest] = await Promise.all([
    prisma.tokenMarketCandle.count({ where }),
    prisma.tokenMarketCandle.findFirst({ where, orderBy: { openTime: 'asc' }, select: { openTime: true } }),
    prisma.tokenMarketCandle.findFirst({ where, orderBy: { openTime: 'desc' }, select: { openTime: true } }),
  ]);

  return {
    pairAddress: latest.pairAddress,
    interval: latest.interval,
    earliestCandle: earliest?.openTime.toISOString() ?? null,
    latestCandle: newest?.openTime.toISOString() ?? null,
    candleCount: count,
    gapCount: 0, // interior gaps are reported per backfill run; not recomputed here
    lastBackfillAt: latest.fetchedAt.toISOString(),
    status: count > 0 ? 'COVERED' : 'NONE',
  };
}
