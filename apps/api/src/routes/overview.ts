import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { freshnessOf, USABLE_SNAPSHOT_STATUSES } from '../services/tokenMetrics/freshness.js';
import { latestCompletedRunByWallet } from '../services/walletPositions/latestRuns.js';

/** Read-only research-database summary for the dashboard Overview page. */
export function registerOverviewRoute(app: FastifyInstance, prisma: PrismaClient) {
  app.get('/api/overview', async () => {
    const [
      walletsTotal,
      walletsEnabled,
      walletsDev,
      syncedWallets,
      storedEvents,
      tokensTotal,
      tokensDev,
      nonDevTokens,
      latestUsable,
      latestAny,
      lastRun,
      lastSuccessfulRun,
    ] = await Promise.all([
      prisma.trackedWallet.count(),
      prisma.trackedWallet.count({ where: { enabled: true } }),
      prisma.trackedWallet.count({ where: { source: 'dev-seed' } }),
      prisma.walletSyncState.count(),
      prisma.walletEvent.count(),
      prisma.token.count(),
      prisma.token.count({ where: { source: 'dev-seed' } }),
      prisma.token.findMany({
        where: { source: { not: 'dev-seed' } },
        select: { id: true },
      }),
      prisma.tokenMarketSnapshot.findMany({
        where: { status: { in: [...USABLE_SNAPSHOT_STATUSES] } },
        orderBy: [{ tokenId: 'asc' }, { observedAt: 'desc' }],
        distinct: ['tokenId'],
        select: { tokenId: true, observedAt: true, status: true },
      }),
      prisma.tokenMarketSnapshot.findMany({
        orderBy: [{ tokenId: 'asc' }, { fetchedAt: 'desc' }, { createdAt: 'desc' }],
        distinct: ['tokenId'],
        select: { tokenId: true, status: true },
      }),
      prisma.tokenMarketRefreshRun.findFirst({ orderBy: { startedAt: 'desc' } }),
      prisma.tokenMarketRefreshRun.findFirst({
        where: { status: { in: ['COMPLETED', 'PARTIAL'] } },
        orderBy: { startedAt: 'desc' },
      }),
    ]);

    // Market counts consider non-development tokens only.
    const nonDevIds = new Set(nonDevTokens.map((t) => t.id));
    const now = new Date();
    let fresh = 0;
    let aging = 0;
    let stale = 0;
    const withSnapshotIds = new Set<string>();
    for (const snapshot of latestUsable) {
      if (!nonDevIds.has(snapshot.tokenId)) continue;
      withSnapshotIds.add(snapshot.tokenId);
      const { freshness } = freshnessOf(snapshot.observedAt, now);
      if (freshness === 'FRESH') fresh += 1;
      else if (freshness === 'AGING') aging += 1;
      else if (freshness === 'STALE') stale += 1;
    }
    const partialLatest = latestAny.filter(
      (s) => nonDevIds.has(s.tokenId) && s.status === 'PARTIAL',
    ).length;

    // --- Phase 1D-B2: historical candles + entry outcomes (read-only) ---
    const [
      tokensWithCandles,
      totalCandles,
      earliestCandle,
      latestCandle,
      lastBackfillRun,
      eligibleBuys,
      outcomeGroups,
    ] = await Promise.all([
      prisma.tokenMarketCandle.findMany({ distinct: ['tokenId'], select: { tokenId: true } }),
      prisma.tokenMarketCandle.count(),
      prisma.tokenMarketCandle.findFirst({ orderBy: { openTime: 'asc' }, select: { openTime: true } }),
      prisma.tokenMarketCandle.findFirst({ orderBy: { openTime: 'desc' }, select: { openTime: true } }),
      prisma.historicalMarketBackfillRun.findFirst({ orderBy: { startedAt: 'desc' } }),
      prisma.walletEvent.count({
        where: { eventType: 'BUY', confidence: { in: ['CONFIRMED', 'LIKELY'] }, tokenId: { not: null } },
      }),
      prisma.walletEntryOutcome.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);
    const outcomeCount = (status: string) =>
      outcomeGroups.find((g) => g.status === status)?._count._all ?? 0;
    const buysWithComplete = outcomeCount('COMPLETE');
    const buysWithPartial = outcomeCount('PARTIAL');
    const buysWithAnyOutcome = outcomeGroups.reduce((sum, g) => sum + g._count._all, 0);
    const latestRuns = await latestCompletedRunByWallet(prisma);
    const currentRunIds = [...new Set(latestRuns.values())];
    const currentPositionWhere = { reconstructionRunId: { in: currentRunIds } };
    const [totalPositions, closedPositions, openPositions, incompletePositions, currentPositions, latestPositionRun] = await Promise.all([
      prisma.walletPosition.count({ where: currentPositionWhere }), prisma.walletPosition.count({ where: { ...currentPositionWhere, status: 'CLOSED' } }),
      prisma.walletPosition.count({ where: { ...currentPositionWhere, status: 'OPEN' } }),
      prisma.walletPosition.count({ where: { ...currentPositionWhere, status: { in: ['PARTIAL','INCOMPLETE_HISTORY','UNKNOWN_BASIS','UNMATCHED_SELL'] } } }),
      prisma.walletPosition.findMany({ where: currentPositionWhere, select: { id: true } }),
      prisma.walletPositionReconstructionRun.findFirst({ orderBy: { startedAt: 'desc' } }),
    ]);
    const totalMatches = await prisma.walletTradeMatch.count({ where: { positionId: { in: currentPositions.map((p) => p.id) } } });

    return {
      wallets: { total: walletsTotal, enabled: walletsEnabled, dev: walletsDev },
      activity: { syncedWallets, storedEvents },
      tokens: { total: tokensTotal, dev: tokensDev },
      market: {
        nonDevTokens: nonDevIds.size,
        withSnapshots: withSnapshotIds.size,
        neverRefreshed: nonDevIds.size - withSnapshotIds.size,
        fresh,
        aging,
        stale,
        partialLatest,
        lastSuccessfulRefreshAt:
          lastSuccessfulRun?.completedAt?.toISOString() ?? null,
        lastRunStatus: lastRun?.status ?? null,
      },
      historical: {
        tokensWithCandles: tokensWithCandles.length,
        totalCandles,
        earliestCandle: earliestCandle?.openTime.toISOString() ?? null,
        latestCandle: latestCandle?.openTime.toISOString() ?? null,
        lastBackfillStatus: lastBackfillRun?.status ?? null,
        lastBackfillAt: lastBackfillRun?.completedAt?.toISOString() ?? null,
        eligibleBuyEvents: eligibleBuys,
        buysWithCompleteOutcome: buysWithComplete,
        buysWithPartialOutcome: buysWithPartial,
        buysWithoutOutcome: Math.max(0, eligibleBuys - buysWithAnyOutcome),
      },
      positions: {
        walletsReconstructed: latestRuns.size, totalPositions, closedPositions,
        openPositions, incompletePositions, totalMatches, profilesGenerated: latestRuns.size,
        latestRunStatus: latestPositionRun?.status ?? null,
      },
    };
  });
}
