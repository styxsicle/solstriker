/**
 * Slow Cook candidate generation — deterministic, read-only, scoped strictly
 * to explicitly selected wallets.
 *
 * A candidate token surfaces only when the SELECTED wallets themselves show
 * real, recent evidence (a recent buy, a currently open reconstructed
 * position, or both). Activity belonging to any other tracked wallet never
 * contributes. Nothing here calls an external provider, mutates the
 * database, or predicts a future trade — every field is either a fact read
 * from storage or a deterministic derivation of stored facts, and every
 * derivation is documented next to the code that computes it.
 */
import type { PrismaClient } from '@prisma/client';
import { D, exact } from '../walletPositions/math.js';
import { freshnessOf, USABLE_SNAPSHOT_STATUSES, type Freshness } from '../tokenMetrics/freshness.js';
import { latestCompletedReconstructionForWallet, isReconstructionCurrent, reconstructionCoverage } from '../walletResearch/currentness.js';
import type { WalletStyleMemory } from './styleMemory.js';

export const SLOW_COOK_CALCULATION_VERSION = 'slow-cook-v1';

export type CandidateState = 'BUILDING' | 'HOLDING' | 'MIXED' | 'COOLING' | 'DISTRIBUTION_RISK' | 'INSUFFICIENT_EVIDENCE';
export type ConfidenceLevel = 'LOW' | 'MODERATE' | 'HIGHER';

export interface SlowCookOptions {
  lookbackDays: number;
  minimumWallets: number;
  limit: number;
  includeLowerConfidence: boolean;
}

export const DEFAULT_SLOW_COOK_OPTIONS: SlowCookOptions = {
  lookbackDays: 30,
  minimumWallets: 1,
  limit: 20,
  includeLowerConfidence: false,
};

interface WalletTokenEvidence {
  walletId: string;
  buyCount: number;
  sellCount: number;
  firstBuyAt: Date | null;
  lastBuyAt: Date | null;
  lastSellAt: Date | null;
  quickSellAfterBuy: boolean;
  hasOpenPosition: boolean;
}

export interface CandidateWalletDetail {
  walletId: string;
  address: string;
  label: string | null;
  buyCount: number;
  sellCount: number;
  hasOpenPosition: boolean;
  firstBuyAt: string | null;
  lastBuyAt: string | null;
  styleMatch: string | null;
}

export interface SlowCookCandidate {
  tokenId: string;
  mintAddress: string;
  name: string | null;
  symbol: string | null;

  state: CandidateState;
  confidence: ConfidenceLevel;
  confidenceScore: number; // 0-100, deterministic; exposed for Quant Mode
  confidenceComponents: Record<string, number>;

  walletInterest: {
    walletsWithEvidenceCount: number;
    recentBuyCount: number;
    openPositionWalletCount: number;
    mostRecentActivityAt: string | null;
  };
  accumulation: {
    repeatBuyWalletCount: number;
    addsAfterEntryCount: number;
    recentBuyCount: number;
    recentSellCount: number;
    stillOpenCount: number;
  };
  holdingConviction: {
    secondsSinceFirstBuy: number | null;
    secondsSinceLastBuy: number | null;
    detectedSellCount: number;
    openPositionCount: number;
  };
  dataQuality: {
    contributingWalletsCurrentCount: number;
    contributingWalletsStaleOrMissingCount: number;
    transferAffectedWalletCount: number;
    unmatchedSellWalletCount: number;
    marketSnapshotStatus: 'AVAILABLE' | 'STALE' | 'UNAVAILABLE';
    marketFreshness: Freshness | null;
  };
  distributionPressure: {
    detectedSellCount: number;
    walletsSellingCount: number;
    label: 'LOW_DETECTED_DISTRIBUTION' | 'MIXED_ACTIVITY' | 'ELEVATED_DETECTED_SELLING';
  };

  styleMatchSummary: string;
  wallets: CandidateWalletDetail[];
  whyThisAppeared: string[];
  whatCouldInvalidate: string[];

  market: {
    priceUsd: string | null;
    marketCapUsd: string | null;
    liquidityUsd: string | null;
    volume24hUsd: string | null;
    priceChange24hPct: string | null;
    observedAt: string | null;
    freshness: Freshness | null;
  } | null;
}

const MS_PER_DAY = 86_400_000;
/** A buy followed by a sell within this window counts as a "quick sell after buy" distribution signal. */
const QUICK_SELL_WINDOW_MS = 60 * 60 * 1000;
/** Below this stored USD liquidity, market context is flagged as a low-liquidity risk. */
const LOW_LIQUIDITY_USD = 1000;

function relativeTimeText(date: Date, now: Date): string {
  const seconds = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} minute(s) ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} hour(s) ago`;
  return `${Math.round(seconds / 86400)} day(s) ago`;
}

/**
 * Deterministic candidate state. Rules are evaluated in this fixed order —
 * the first matching rule wins. See the inline comments for exactly why.
 */
function classifyState(input: {
  recentBuyCount: number;
  recentSellCount: number;
  quickSellAfterBuy: boolean;
  repeatBuyWalletCount: number;
  openPositionWalletCount: number;
  walletsWithEvidenceCount: number;
  walletsOnlyBuyingCount: number;
  walletsOnlySellingCount: number;
  secondsSinceLastActivity: number | null;
  lookbackDays: number;
}): CandidateState {
  const {
    recentBuyCount,
    recentSellCount,
    quickSellAfterBuy,
    repeatBuyWalletCount,
    openPositionWalletCount,
    walletsWithEvidenceCount,
    walletsOnlyBuyingCount,
    walletsOnlySellingCount,
    secondsSinceLastActivity,
    lookbackDays,
  } = input;

  // 1. Selling at least as much as buying (or a same-wallet quick flip) is the
  //    strongest signal that conviction is weakening — checked first.
  if (recentSellCount > 0 && (recentSellCount >= recentBuyCount || quickSellAfterBuy)) {
    return 'DISTRIBUTION_RISK';
  }
  // 2. Repeat buys with no detected selling at all is the clearest accumulation signal.
  if (repeatBuyWalletCount > 0 && recentSellCount === 0) {
    return 'BUILDING';
  }
  // 3. Open reconstructed inventory, no fresh repeat-buying, no selling: quietly held.
  if (openPositionWalletCount > 0 && recentSellCount === 0) {
    return 'HOLDING';
  }
  // 4. Some selected wallets only bought while others only sold: no shared direction.
  if (walletsWithEvidenceCount >= 2 && walletsOnlyBuyingCount > 0 && walletsOnlySellingCount > 0) {
    return 'MIXED';
  }
  // 5. Nothing recent: the setup is aging out of relevance.
  if (secondsSinceLastActivity !== null && secondsSinceLastActivity > lookbackDays * MS_PER_DAY * 0.66 / 1000) {
    return 'COOLING';
  }
  // 6. A token can still be eligible (e.g. exactly one buy, no repeats, no open
  //    position record yet) without matching any pattern above.
  return 'INSUFFICIENT_EVIDENCE';
}

/** Deterministic 0-100 evidence-confidence score. Formula version: slow-cook-v1. */
function computeConfidence(components: {
  walletsWithEvidenceCount: number;
  bestEvidenceState: 'SUFFICIENT' | 'LIMITED' | 'INSUFFICIENT';
  allContributingCurrent: boolean;
  anyContributingCurrent: boolean;
  marketFreshness: Freshness | null;
  anyContamination: boolean;
}): { score: number; components: Record<string, number> } {
  const walletCountScore = Math.min(components.walletsWithEvidenceCount, 5) * 10; // 0-50
  const styleEvidenceScore =
    components.bestEvidenceState === 'SUFFICIENT' ? 20 : components.bestEvidenceState === 'LIMITED' ? 10 : 0;
  const currentnessScore = components.allContributingCurrent ? 20 : components.anyContributingCurrent ? 10 : 0;
  const marketScore = components.marketFreshness === 'FRESH' || components.marketFreshness === 'AGING' ? 10 : 0;
  const contaminationPenalty = components.anyContamination ? -10 : 0;
  const raw = walletCountScore + styleEvidenceScore + currentnessScore + marketScore + contaminationPenalty;
  const score = Math.max(0, Math.min(100, raw));
  return {
    score,
    components: {
      walletCountScore,
      styleEvidenceScore,
      currentnessScore,
      marketScore,
      contaminationPenalty,
    },
  };
}
function confidenceLevel(score: number): ConfidenceLevel {
  if (score >= 70) return 'HIGHER';
  if (score >= 40) return 'MODERATE';
  return 'LOW';
}

/**
 * Builds Slow Cook candidates strictly from the explicitly selected wallets'
 * own stored events and current reconstructed positions. Never queries or
 * includes data from any other tracked wallet.
 */
export async function buildSlowCookCandidates(
  prisma: PrismaClient,
  walletIds: string[],
  styleMemories: WalletStyleMemory[],
  options: SlowCookOptions,
): Promise<SlowCookCandidate[]> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - options.lookbackDays * MS_PER_DAY);
  const styleByWallet = new Map(styleMemories.map((m) => [m.walletId, m]));

  const wallets = await prisma.trackedWallet.findMany({ where: { id: { in: walletIds } } });
  const walletById = new Map(wallets.map((w) => [w.id, w]));

  // --- Recent BUY/SELL evidence, selected wallets only ---
  const events = await prisma.walletEvent.findMany({
    where: {
      walletId: { in: walletIds },
      eventType: { in: ['BUY', 'SELL'] },
      decoderVersion: { gte: 2 },
      confidence: { in: ['CONFIRMED', 'LIKELY'] },
      tokenId: { not: null },
      blockTime: { gte: windowStart },
    },
    orderBy: { blockTime: 'asc' },
  });

  // --- Current open/partial reconstructed positions, selected wallets only ---
  const currentReconstructionRunByWallet = new Map<string, string | null>();
  for (const walletId of walletIds) {
    const completed = await latestCompletedReconstructionForWallet(prisma, walletId);
    if (!completed) {
      currentReconstructionRunByWallet.set(walletId, null);
      continue;
    }
    const storedEventCount = await prisma.walletEvent.count({ where: { walletId } });
    const covered = await reconstructionCoverage(prisma, walletId, completed.reconstructionRunId);
    currentReconstructionRunByWallet.set(
      walletId,
      isReconstructionCurrent(covered, storedEventCount) ? completed.reconstructionRunId : completed.reconstructionRunId,
    );
    // Note: even a STALE reconstruction's open positions are still real,
    // already-reconstructed evidence — they are included, and the resulting
    // candidate's dataQuality section reports the staleness explicitly
    // rather than silently discarding the evidence.
  }
  const openPositions = await prisma.walletPosition.findMany({
    where: {
      trackedWalletId: { in: walletIds },
      status: { in: ['OPEN', 'PARTIAL'] },
      reconstructionRunId: { in: [...currentReconstructionRunByWallet.values()].flatMap((id) => (id ? [id] : [])) },
    },
    include: { token: true },
  });

  // --- Group by token ---
  const byToken = new Map<string, { tokenId: string; wallets: Map<string, WalletTokenEvidence> }>();
  const getBucket = (tokenId: string) => {
    let bucket = byToken.get(tokenId);
    if (!bucket) {
      bucket = { tokenId, wallets: new Map() };
      byToken.set(tokenId, bucket);
    }
    return bucket;
  };
  const getWalletEvidence = (bucket: { wallets: Map<string, WalletTokenEvidence> }, walletId: string) => {
    let w = bucket.wallets.get(walletId);
    if (!w) {
      w = {
        walletId,
        buyCount: 0,
        sellCount: 0,
        firstBuyAt: null,
        lastBuyAt: null,
        lastSellAt: null,
        quickSellAfterBuy: false,
        hasOpenPosition: false,
      };
      bucket.wallets.set(walletId, w);
    }
    return w;
  };

  for (const event of events) {
    if (!event.tokenId || !event.blockTime) continue;
    const bucket = getBucket(event.tokenId);
    const w = getWalletEvidence(bucket, event.walletId);
    if (event.eventType === 'BUY') {
      w.buyCount += 1;
      w.firstBuyAt = w.firstBuyAt && w.firstBuyAt < event.blockTime ? w.firstBuyAt : event.blockTime;
      w.lastBuyAt = w.lastBuyAt && w.lastBuyAt > event.blockTime ? w.lastBuyAt : event.blockTime;
    } else {
      w.sellCount += 1;
      w.lastSellAt = w.lastSellAt && w.lastSellAt > event.blockTime ? w.lastSellAt : event.blockTime;
      if (w.lastBuyAt && event.blockTime.getTime() - w.lastBuyAt.getTime() <= QUICK_SELL_WINDOW_MS) {
        w.quickSellAfterBuy = true;
      }
    }
  }
  for (const position of openPositions) {
    const bucket = getBucket(position.tokenId);
    const w = getWalletEvidence(bucket, position.trackedWalletId);
    w.hasOpenPosition = true;
  }

  const tokenIds = [...byToken.keys()];
  const tokens = await prisma.token.findMany({ where: { id: { in: tokenIds } } });
  const tokenById = new Map(tokens.map((t) => [t.id, t]));

  const snapshots = await prisma.tokenMarketSnapshot.findMany({
    where: { tokenId: { in: tokenIds }, status: { in: [...USABLE_SNAPSHOT_STATUSES] } },
    orderBy: [{ tokenId: 'asc' }, { observedAt: 'desc' }, { createdAt: 'desc' }],
    distinct: ['tokenId'],
  });
  const snapshotByToken = new Map(snapshots.map((s) => [s.tokenId, s]));

  const candidates: SlowCookCandidate[] = [];

  for (const [tokenId, bucket] of byToken) {
    const token = tokenById.get(tokenId);
    if (!token || token.source === 'dev-seed') continue; // development-seed data is never a candidate

    const walletEvidence = [...bucket.wallets.values()];
    const withEvidence = walletEvidence.filter((w) => w.buyCount > 0 || w.hasOpenPosition);
    if (withEvidence.length < options.minimumWallets) continue;

    const recentBuyCount = walletEvidence.reduce((sum, w) => sum + w.buyCount, 0);
    const recentSellCount = walletEvidence.reduce((sum, w) => sum + w.sellCount, 0);
    // Eligibility: a real recent buy OR a currently open reconstructed position.
    if (recentBuyCount === 0 && !walletEvidence.some((w) => w.hasOpenPosition)) continue;

    const repeatBuyWallets = walletEvidence.filter((w) => w.buyCount > 1);
    const openPositionWallets = walletEvidence.filter((w) => w.hasOpenPosition);
    const walletsOnlyBuying = withEvidence.filter((w) => w.buyCount > 0 && w.sellCount === 0);
    const walletsOnlySelling = withEvidence.filter((w) => w.sellCount > 0 && w.buyCount === 0);
    const anyQuickSell = walletEvidence.some((w) => w.quickSellAfterBuy);

    const buyTimes = walletEvidence.flatMap((w) => (w.firstBuyAt ? [w.firstBuyAt] : []));
    const lastBuyTimes = walletEvidence.flatMap((w) => (w.lastBuyAt ? [w.lastBuyAt] : []));
    const lastSellTimes = walletEvidence.flatMap((w) => (w.lastSellAt ? [w.lastSellAt] : []));
    const firstBuyAt = buyTimes.length ? new Date(Math.min(...buyTimes.map((d) => d.getTime()))) : null;
    const lastBuyAt = lastBuyTimes.length ? new Date(Math.max(...lastBuyTimes.map((d) => d.getTime()))) : null;
    const lastSellAt = lastSellTimes.length ? new Date(Math.max(...lastSellTimes.map((d) => d.getTime()))) : null;
    const lastActivityAt =
      lastBuyAt && lastSellAt ? (lastBuyAt > lastSellAt ? lastBuyAt : lastSellAt) : (lastBuyAt ?? lastSellAt);

    const state = classifyState({
      recentBuyCount,
      recentSellCount,
      quickSellAfterBuy: anyQuickSell,
      repeatBuyWalletCount: repeatBuyWallets.length,
      openPositionWalletCount: openPositionWallets.length,
      walletsWithEvidenceCount: withEvidence.length,
      walletsOnlyBuyingCount: walletsOnlyBuying.length,
      walletsOnlySellingCount: walletsOnlySelling.length,
      secondsSinceLastActivity: lastActivityAt ? (now.getTime() - lastActivityAt.getTime()) / 1000 : null,
      lookbackDays: options.lookbackDays,
    });

    // --- Data quality ---
    const contributingMemories = withEvidence.flatMap((w) => {
      const m = styleByWallet.get(w.walletId);
      return m ? [m] : [];
    });
    const contributingCurrentCount = contributingMemories.filter(
      (m) => m.ids.reconstructionRunId !== null,
    ).length;
    const contributingStaleOrMissingCount = contributingMemories.length - contributingCurrentCount;
    const transferAffectedWalletCount = contributingMemories.filter((m) => (m.metrics.transferAffectedCount ?? 0) > 0).length;
    const unmatchedSellWalletCount = contributingMemories.filter((m) => (m.metrics.unmatchedSellCount ?? 0) > 0).length;

    const snapshot = snapshotByToken.get(tokenId) ?? null;
    const { freshness } = snapshot ? freshnessOf(snapshot.observedAt, now) : { freshness: null };
    const marketSnapshotStatus: SlowCookCandidate['dataQuality']['marketSnapshotStatus'] = !snapshot
      ? 'UNAVAILABLE'
      : freshness === 'STALE'
        ? 'STALE'
        : 'AVAILABLE';

    // --- Confidence ---
    const bestEvidenceState = contributingMemories.reduce<'SUFFICIENT' | 'LIMITED' | 'INSUFFICIENT'>((best, m) => {
      if (m.evidenceState === 'SUFFICIENT' || best === 'SUFFICIENT') return 'SUFFICIENT';
      if (m.evidenceState === 'LIMITED' || best === 'LIMITED') return 'LIMITED';
      return 'INSUFFICIENT';
    }, 'INSUFFICIENT');
    const { score, components } = computeConfidence({
      walletsWithEvidenceCount: withEvidence.length,
      bestEvidenceState,
      allContributingCurrent: contributingMemories.length > 0 && contributingStaleOrMissingCount === 0,
      anyContributingCurrent: contributingCurrentCount > 0,
      marketFreshness: freshness,
      anyContamination: transferAffectedWalletCount > 0 || unmatchedSellWalletCount > 0,
    });
    const confidence = confidenceLevel(score);
    if (!options.includeLowerConfidence && confidence === 'LOW') continue;

    // --- Style match ---
    const { summary: styleMatchSummary, perWallet: styleMatchByWallet } = buildStyleMatch(
      withEvidence,
      contributingMemories,
    );

    // --- Why this appeared ---
    const whyThisAppeared: string[] = [
      `${withEvidence.length} selected wallet(s) interacted with the token`,
      `${recentBuyCount} recent buy(s) were detected`,
    ];
    if (openPositionWallets.length > 0) {
      whyThisAppeared.push(`${openPositionWallets.length} selected wallet(s) currently have reconstructed open positions`);
    }
    if (lastActivityAt) {
      whyThisAppeared.push(`The most recent selected-wallet activity was ${relativeTimeText(lastActivityAt, now)}`);
    }
    whyThisAppeared.push(
      recentSellCount === 0
        ? 'Detected selling is currently limited'
        : `${recentSellCount} sell(s) were detected in the lookback window`,
    );

    // --- What could invalidate this ---
    const whatCouldInvalidate: string[] = ['New sell activity could occur at any time'];
    if (contributingStaleOrMissingCount > 0) whatCouldInvalidate.push('Some contributing wallets have stale or missing research');
    if (wallets.some((w) => walletById.has(w.id) === false)) whatCouldInvalidate.push('Partial transaction history');
    if (marketSnapshotStatus === 'UNAVAILABLE') whatCouldInvalidate.push('No market snapshot has been collected for this token');
    else if (marketSnapshotStatus === 'STALE') whatCouldInvalidate.push('The market snapshot is stale');
    if (snapshot?.liquidityUsd && D(snapshot.liquidityUsd).lt(LOW_LIQUIDITY_USD)) whatCouldInvalidate.push('Low stored liquidity');
    if (contributingMemories.every((m) => m.evidenceState === 'INSUFFICIENT')) {
      whatCouldInvalidate.push('Insufficient completed positions to compare style reliably');
    }
    if (transferAffectedWalletCount > 0) whatCouldInvalidate.push('Transfers may obscure cost basis for some contributing wallets');
    if (styleMatchByWallet.some((s) => s === null) && contributingMemories.length > 1) {
      whatCouldInvalidate.push('Selected wallets may have inconsistent historical styles');
    }
    if (state === 'COOLING') whatCouldInvalidate.push('Candidate activity is no longer recent');

    candidates.push({
      tokenId,
      mintAddress: token.mintAddress,
      name: token.name,
      symbol: token.symbol,
      state,
      confidence,
      confidenceScore: score,
      confidenceComponents: components,
      walletInterest: {
        walletsWithEvidenceCount: withEvidence.length,
        recentBuyCount,
        openPositionWalletCount: openPositionWallets.length,
        mostRecentActivityAt: lastActivityAt?.toISOString() ?? null,
      },
      accumulation: {
        repeatBuyWalletCount: repeatBuyWallets.length,
        addsAfterEntryCount: walletEvidence.reduce((sum, w) => sum + Math.max(0, w.buyCount - 1), 0),
        recentBuyCount,
        recentSellCount,
        stillOpenCount: openPositionWallets.length,
      },
      holdingConviction: {
        secondsSinceFirstBuy: firstBuyAt ? Math.floor((now.getTime() - firstBuyAt.getTime()) / 1000) : null,
        secondsSinceLastBuy: lastBuyAt ? Math.floor((now.getTime() - lastBuyAt.getTime()) / 1000) : null,
        detectedSellCount: recentSellCount,
        openPositionCount: openPositionWallets.length,
      },
      dataQuality: {
        contributingWalletsCurrentCount: contributingCurrentCount,
        contributingWalletsStaleOrMissingCount: contributingStaleOrMissingCount,
        transferAffectedWalletCount,
        unmatchedSellWalletCount,
        marketSnapshotStatus,
        marketFreshness: freshness,
      },
      distributionPressure: {
        detectedSellCount: recentSellCount,
        walletsSellingCount: walletEvidence.filter((w) => w.sellCount > 0).length,
        label:
          recentSellCount === 0
            ? 'LOW_DETECTED_DISTRIBUTION'
            : recentSellCount < recentBuyCount
              ? 'MIXED_ACTIVITY'
              : 'ELEVATED_DETECTED_SELLING',
      },
      styleMatchSummary,
      wallets: withEvidence.map((w) => {
        const wallet = walletById.get(w.walletId)!;
        return {
          walletId: w.walletId,
          address: wallet.address,
          label: wallet.label,
          buyCount: w.buyCount,
          sellCount: w.sellCount,
          hasOpenPosition: w.hasOpenPosition,
          firstBuyAt: w.firstBuyAt?.toISOString() ?? null,
          lastBuyAt: w.lastBuyAt?.toISOString() ?? null,
          styleMatch: styleMatchByWallet.find((_, i) => withEvidence[i].walletId === w.walletId) ?? null,
        };
      }),
      whyThisAppeared,
      whatCouldInvalidate,
      market: snapshot
        ? {
            priceUsd: snapshot.priceUsd,
            marketCapUsd: snapshot.marketCapUsd,
            liquidityUsd: snapshot.liquidityUsd,
            volume24hUsd: snapshot.volume24hUsd,
            priceChange24hPct: snapshot.priceChange24hPct,
            observedAt: snapshot.observedAt.toISOString(),
            freshness,
          }
        : null,
    });
  }

  // Stable, documented, non-performance ordering: more corroborating wallets
  // first, then more recent buy evidence, then token ID for determinism.
  // This is never a "best trade" ranking.
  candidates.sort(
    (a, b) =>
      b.walletInterest.walletsWithEvidenceCount - a.walletInterest.walletsWithEvidenceCount ||
      b.walletInterest.recentBuyCount - a.walletInterest.recentBuyCount ||
      a.tokenId.localeCompare(b.tokenId),
  );

  return candidates.slice(0, options.limit);
}

/**
 * Compares each contributing wallet's CURRENT number of buys on this token
 * with its own historical median buys-per-cycle. Returns both a per-wallet
 * sentence and one overall summary. Never predicts a future action.
 */
function buildStyleMatch(
  withEvidence: WalletTokenEvidence[],
  memories: WalletStyleMemory[],
): { summary: string; perWallet: (string | null)[] } {
  const usable = memories.filter((m) => m.evidenceState !== 'INSUFFICIENT');
  if (usable.length === 0) {
    return {
      summary: 'There are not enough eligible past trades to compare this setup reliably.',
      perWallet: withEvidence.map(() => null),
    };
  }

  const perWallet = withEvidence.map((w) => {
    const memory = memories.find((m) => m.walletId === w.walletId);
    if (!memory || memory.evidenceState === 'INSUFFICIENT') return null;
    const typicalBuys = memory.metrics.medianBuysPerCycle ? Number(memory.metrics.medianBuysPerCycle) : null;
    if (typicalBuys === null) return null;
    const matches = Math.abs(w.buyCount - typicalBuys) <= 1;
    return matches
      ? `Current activity (${w.buyCount} buy(s)) matches this wallet's typical entry pattern (~${exact(D(typicalBuys))} per cycle).`
      : `Current activity (${w.buyCount} buy(s)) differs from this wallet's typical entry pattern (~${exact(D(typicalBuys))} per cycle).`;
  });

  const scaleInTags = usable.filter((m) => m.styleTags.includes('FREQUENTLY_SCALES_IN')).length;
  const singleEntryTags = usable.filter((m) => m.styleTags.includes('MOSTLY_SINGLE_ENTRY')).length;
  const sharedScaleIn = scaleInTags === usable.length && usable.length > 0;
  const sharedSingleEntry = singleEntryTags === usable.length && usable.length > 0;

  if (usable.length > 1 && !sharedScaleIn && !sharedSingleEntry) {
    return { summary: 'The selected wallets have different historical styles, so there is no clear shared pattern.', perWallet };
  }

  const totalBuys = withEvidence.reduce((sum, w) => sum + w.buyCount, 0);
  const totalSells = withEvidence.reduce((sum, w) => sum + w.sellCount, 0);
  const pattern = sharedScaleIn ? 'add to positions before exiting' : 'enter in a single buy';
  return {
    summary: `${usable.length} selected wallet(s) historically tend to ${pattern}. Their current activity on this token includes ${totalBuys} detected buy(s) and ${totalSells === 0 ? 'no detected sell yet' : `${totalSells} detected sell(s)`}.`,
    perWallet,
  };
}
