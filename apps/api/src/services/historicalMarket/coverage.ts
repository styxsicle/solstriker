import type { PrismaClient } from '@prisma/client';
import { intervalSeconds, isSupportedInterval } from './intervals.js';

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
  const [openTimes, newest] = await Promise.all([
    prisma.tokenMarketCandle.findMany({
      where,
      orderBy: { openTime: 'asc' },
      select: { openTime: true },
    }),
    prisma.tokenMarketCandle.findFirst({ where, orderBy: { openTime: 'desc' }, select: { openTime: true } }),
  ]);
  const duration = isSupportedInterval(latest.interval)
    ? intervalSeconds(latest.interval) * 1000
    : null;
  let gapCount = 0;
  if (duration !== null) {
    for (let i = 1; i < openTimes.length; i++) {
      const elapsed = openTimes[i].openTime.getTime() - openTimes[i - 1].openTime.getTime();
      if (elapsed > duration) gapCount += Math.floor(elapsed / duration) - 1;
    }
  }

  return {
    pairAddress: latest.pairAddress,
    interval: latest.interval,
    earliestCandle: openTimes[0]?.openTime.toISOString() ?? null,
    latestCandle: newest?.openTime.toISOString() ?? null,
    candleCount: openTimes.length,
    gapCount,
    lastBackfillAt: latest.fetchedAt.toISOString(),
    status: openTimes.length === 0 ? 'NONE' : gapCount > 0 ? 'PARTIAL' : 'COVERED',
  };
}
