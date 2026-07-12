/**
 * Phase 2C-A — deterministic strategy-fingerprint calculation.
 *
 * Describes HOW a wallet's observed position cycles were entered, sized,
 * managed and exited, using only synchronized, reconstructable evidence from a
 * single completed reconstruction run. It does not measure profitability or
 * skill, does not establish who controls a wallet, and never recommends that
 * the observed behavior be copied.
 *
 * All financial values are exact decimal strings. Unknown values are null,
 * never zero. Every metric names the eligible sample it was computed from.
 */
import { Decimal } from 'decimal.js';
import type { WalletEvent, WalletPosition } from '@prisma/client';
import { D, exact, pct, quantile } from '../walletPositions/math.js';
import {
  DESCRIPTOR_THRESHOLDS as T,
  STRATEGY_DESCRIPTORS as DESC,
  type DescriptorEvidence,
  type StrategyDescriptor,
} from './descriptors.js';
import {
  MULTI_LEG_THRESHOLD,
  SMALL_CYCLE_THRESHOLD,
  STRATEGY_WARNINGS as W,
  VERY_SMALL_CYCLE_THRESHOLD,
} from './warnings.js';

export const STRATEGY_CALCULATION_VERSION = 1;

/** One reconstructed cycle plus the wallet events the reconstruction included in it. */
export interface CycleInput {
  position: WalletPosition;
  events: WalletEvent[];
}

/** Neutral, evenly-defined time buckets — no bucket implies a good or bad duration. */
export const TIME_BUCKETS = [
  'Under 1 minute',
  '1–5 minutes',
  '5–15 minutes',
  '15–30 minutes',
  '30–60 minutes',
  '1–4 hours',
  '4–24 hours',
  'Over 24 hours',
  'Unknown/open',
] as const;

export function timeBucket(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return 'Unknown/open';
  if (seconds < 60) return 'Under 1 minute';
  if (seconds < 300) return '1–5 minutes';
  if (seconds < 900) return '5–15 minutes';
  if (seconds < 1800) return '15–30 minutes';
  if (seconds < 3600) return '30–60 minutes';
  if (seconds < 14400) return '1–4 hours';
  if (seconds < 86400) return '4–24 hours';
  return 'Over 24 hours';
}

export const SIZE_BUCKETS = [
  'Under 0.05 SOL',
  '0.05–0.10 SOL',
  '0.10–0.25 SOL',
  '0.25–0.50 SOL',
  '0.50–1.00 SOL',
  'Over 1.00 SOL',
  'Unknown',
] as const;

export function sizeBucket(value: Decimal | null): string {
  if (value === null) return 'Unknown';
  if (value.lt('0.05')) return 'Under 0.05 SOL';
  if (value.lt('0.1')) return '0.05–0.10 SOL';
  if (value.lt('0.25')) return '0.10–0.25 SOL';
  if (value.lt('0.5')) return '0.25–0.50 SOL';
  if (value.lt(1)) return '0.50–1.00 SOL';
  return 'Over 1.00 SOL';
}

export const FEE_BUCKETS = [
  'Under 1%',
  '1–2%',
  '2–5%',
  '5–10%',
  'Over 10%',
  'Unknown',
] as const;

export function feeBucket(burdenPct: Decimal | null): string {
  if (burdenPct === null) return 'Unknown';
  if (burdenPct.lt(1)) return 'Under 1%';
  if (burdenPct.lt(2)) return '1–2%';
  if (burdenPct.lt(5)) return '2–5%';
  if (burdenPct.lte(10)) return '5–10%';
  return 'Over 10%';
}

/**
 * Known attributable fees of one event: network + platform/router + tip.
 *
 * The priority fee is deliberately NOT added: `networkFeeSol` already contains
 * the base-plus-priority total, and `priorityFeeSol` is only the identifiable
 * portion above the base fee — adding it would double-count. Token-account rent
 * is also excluded, matching the existing accounting policy: rent is a
 * refundable deposit, not a permanent trading loss.
 *
 * Returns null when any component is unknown — fees are never assumed to be zero.
 */
export function knownEventFees(event: WalletEvent): Decimal | null {
  const parts = [event.networkFeeSol, event.platformFeeSol, event.tipSol];
  if (parts.some((value) => value === null)) return null;
  return parts.reduce<Decimal>((total, value) => total.plus(D((value as number).toString())), D(0));
}

function quote(event: WalletEvent): Decimal | null {
  const value = event.quoteAmount;
  if (value === null || !Number.isFinite(value) || value <= 0) return null;
  return D(value.toString());
}
function tokens(event: WalletEvent): Decimal | null {
  const value = event.tokenAmount;
  if (value === null || !Number.isFinite(value) || value <= 0) return null;
  return D(value.toString());
}
function seconds(from: Date, to: Date) {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 1000));
}
function median(values: Decimal[]) {
  return quantile(values, 0.5);
}
function mean(values: Decimal[]) {
  return values.length ? values.reduce((a, b) => a.plus(b), D(0)).div(values.length) : null;
}
function ratePct(numerator: number, denominator: number) {
  return denominator ? pct(D(numerator), D(denominator)) : null;
}

/** One cycle reduced to the structural facts the fingerprint is built from. */
export interface CycleShape {
  tokenId: string;
  openedAt: Date | null;
  closedAt: Date | null;
  /** A cycle is eligible when it has at least one buy with a known SOL cost. */
  eligible: boolean;
  buyCount: number;
  sellCount: number;
  firstBuySol: Decimal | null;
  cycleCostSol: Decimal | null;
  firstBuySharePct: Decimal | null;
  largestBuySharePct: Decimal | null;
  largestBuyIsFirst: boolean;
  sizeIncreasedLater: boolean;
  firstToSecondBuySeconds: number | null;
  laterBuyGapSeconds: number[];
  /** Observed token inventory immediately before the first known sell. */
  inventoryBeforeFirstSell: Decimal | null;
  firstSellInventoryPct: Decimal | null;
  largestSellInventoryPct: Decimal | null;
  remainingAfterFirstSellPct: Decimal | null;
  partialFirstExit: boolean;
  firstBuyToFirstSellSeconds: number | null;
  lastBuyToFirstSellSeconds: number | null;
  firstSellToFinalSellSeconds: number | null;
  durationSeconds: number | null;
  fullyClosed: boolean;
  stillOpen: boolean;
  venue: string;
  router: string;
  buyFees: (Decimal | null)[];
  sellFees: (Decimal | null)[];
  cycleFeesSol: Decimal | null;
  feeBurdenPct: Decimal | null;
  legs: number;
  rawResultSol: Decimal | null;
  transferAffected: boolean;
  unmatchedSell: boolean;
  unknownBasis: boolean;
  mixedConfidence: boolean;
}

export function shapeCycle({ position, events }: CycleInput): CycleShape {
  const timed = events.filter((e) => e.blockTime !== null);
  const ordered = [...timed].sort(
    (a, b) =>
      (a.blockTime as Date).getTime() - (b.blockTime as Date).getTime() ||
      (a.slot ?? 0) - (b.slot ?? 0) ||
      a.id.localeCompare(b.id),
  );
  const buys = ordered.filter((e) => e.eventType === 'BUY' && quote(e) !== null);
  const sells = ordered.filter((e) => e.eventType === 'SELL' && quote(e) !== null);
  const buyCosts = buys.map((e) => quote(e) as Decimal);
  const cycleCostSol = buyCosts.length ? buyCosts.reduce((a, b) => a.plus(b), D(0)) : null;
  const firstBuySol = buyCosts[0] ?? null;
  const largestBuy = buyCosts.length ? Decimal.max(...buyCosts) : null;

  const buyTime = (index: number) => buys[index]?.blockTime as Date | undefined;
  const firstSellTime = sells[0]?.blockTime as Date | undefined;

  // Observed inventory that existed immediately before the first known sell.
  const inventoryBeforeFirstSell = firstSellTime
    ? buys
        .filter((e) => (e.blockTime as Date).getTime() <= firstSellTime.getTime())
        .reduce<Decimal | null>((total, e) => {
          const amount = tokens(e);
          if (amount === null || total === null) return total;
          return total.plus(amount);
        }, D(0))
    : null;
  const usableInventory =
    inventoryBeforeFirstSell !== null && inventoryBeforeFirstSell.gt(0)
      ? inventoryBeforeFirstSell
      : null;

  const sellAmounts = sells.map((e) => tokens(e));
  const firstSellAmount = sellAmounts[0] ?? null;
  const knownSellAmounts = sellAmounts.filter((v): v is Decimal => v !== null);
  const largestSellAmount = knownSellAmounts.length ? Decimal.max(...knownSellAmounts) : null;

  const firstSellInventoryPct =
    usableInventory && firstSellAmount
      ? Decimal.min(firstSellAmount.div(usableInventory).mul(100), D(100))
      : null;
  const largestSellInventoryPct =
    usableInventory && largestSellAmount
      ? Decimal.min(largestSellAmount.div(usableInventory).mul(100), D(100))
      : null;
  const remainingAfterFirstSellPct = firstSellInventoryPct
    ? Decimal.max(D(100).minus(firstSellInventoryPct), D(0))
    : null;

  // The last buy that happened at or before the first sell.
  const lastBuyBeforeFirstSell = firstSellTime
    ? [...buys].reverse().find((e) => (e.blockTime as Date).getTime() <= firstSellTime.getTime())
    : undefined;

  const laterBuyGapSeconds: number[] = [];
  for (let i = 2; i < buys.length; i += 1) {
    const previous = buyTime(i - 1);
    const current = buyTime(i);
    if (previous && current) laterBuyGapSeconds.push(seconds(previous, current));
  }

  const buyFees = buys.map(knownEventFees);
  const sellFees = sells.map(knownEventFees);
  const allFees = [...buyFees, ...sellFees];
  const cycleFeesSol = allFees.some((f) => f === null)
    ? null
    : allFees.reduce<Decimal>((total, f) => total.plus(f as Decimal), D(0));
  const feeBurdenPct =
    cycleFeesSol !== null && cycleCostSol !== null && cycleCostSol.gt(0)
      ? cycleFeesSol.div(cycleCostSol).mul(100)
      : null;

  const confidences = new Set(ordered.map((e) => e.confidence).filter((c) => c !== null));
  const openTokens = D(position.openTokenAmount ?? 0);

  return {
    tokenId: position.tokenId,
    openedAt: position.openedAt,
    closedAt: position.closedAt,
    eligible: buys.length > 0 && cycleCostSol !== null && cycleCostSol.gt(0),
    buyCount: buys.length,
    sellCount: sells.length,
    firstBuySol,
    cycleCostSol,
    firstBuySharePct:
      firstBuySol && cycleCostSol?.gt(0) ? firstBuySol.div(cycleCostSol).mul(100) : null,
    largestBuySharePct:
      largestBuy && cycleCostSol?.gt(0) ? largestBuy.div(cycleCostSol).mul(100) : null,
    largestBuyIsFirst: Boolean(largestBuy && firstBuySol && firstBuySol.equals(largestBuy)),
    sizeIncreasedLater: buyCosts.slice(1).some((cost) => firstBuySol !== null && cost.gt(firstBuySol)),
    firstToSecondBuySeconds:
      buyTime(0) && buyTime(1) ? seconds(buyTime(0) as Date, buyTime(1) as Date) : null,
    laterBuyGapSeconds,
    inventoryBeforeFirstSell,
    firstSellInventoryPct,
    largestSellInventoryPct,
    remainingAfterFirstSellPct,
    partialFirstExit: Boolean(
      usableInventory && firstSellAmount && firstSellAmount.lt(usableInventory),
    ),
    firstBuyToFirstSellSeconds:
      buyTime(0) && firstSellTime ? seconds(buyTime(0) as Date, firstSellTime) : null,
    lastBuyToFirstSellSeconds:
      lastBuyBeforeFirstSell?.blockTime && firstSellTime
        ? seconds(lastBuyBeforeFirstSell.blockTime, firstSellTime)
        : null,
    firstSellToFinalSellSeconds:
      sells.length >= 2 && firstSellTime
        ? seconds(firstSellTime, sells[sells.length - 1].blockTime as Date)
        : null,
    durationSeconds: position.holdingDurationSeconds,
    // Closure is judged from OBSERVED INVENTORY, not the position's status
    // label: when a wallet's backfill is incomplete every position is stamped
    // INCOMPLETE_HISTORY, so a cycle whose inventory was entirely sold would
    // otherwise be miscounted as one the wallet "left open".
    fullyClosed: sells.length > 0 && !openTokens.gt(0),
    stillOpen: openTokens.gt(0),
    venue: buys[0]?.venue ?? 'Unknown',
    router: buys[0]?.source ?? 'Unknown',
    buyFees,
    sellFees,
    cycleFeesSol,
    feeBurdenPct,
    legs: buys.length + sells.length,
    rawResultSol: position.rawRealizedPnlSol === null ? null : D(position.rawRealizedPnlSol),
    transferAffected:
      D(position.transferInAmount ?? 0).gt(0) || D(position.transferOutAmount ?? 0).gt(0),
    unmatchedSell: D(position.unmatchedSellAmount ?? 0).gt(0),
    unknownBasis: D(position.unknownBasisAmount ?? 0).gt(0),
    mixedConfidence: confidences.size > 1,
  };
}

/** Greatest number of eligible cycles observed open at the same time. */
export function maxConcurrent(cycles: CycleShape[]) {
  const points = cycles.flatMap((c) =>
    c.openedAt
      ? [
          [c.openedAt.getTime(), 1] as const,
          [c.closedAt?.getTime() ?? Number.MAX_SAFE_INTEGER, -1] as const,
        ]
      : [],
  );
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let current = 0;
  let max = 0;
  for (const [, delta] of points) {
    current += delta;
    max = Math.max(max, current);
  }
  return max;
}

/** Concurrency observed at each cycle opening — the typical, not the peak, load. */
export function concurrencyAtOpenings(cycles: CycleShape[]): Decimal[] {
  const open = cycles.filter((c) => c.openedAt);
  return open.map((c) => {
    const at = (c.openedAt as Date).getTime();
    const count = open.filter(
      (other) =>
        (other.openedAt as Date).getTime() <= at &&
        (other.closedAt?.getTime() ?? Number.MAX_SAFE_INTEGER) >= at,
    ).length;
    return D(count);
  });
}

export interface PatternRow {
  patternType: string;
  patternValue: string;
  sortOrder: number;
  totalCount: number;
  eligibleCount: number;
  excludedCount: number;
  percentage: string | null;
  medianSizeSol: string | null;
  medianDurationSeconds: string | null;
  medianRawResultSol: string | null;
  confidence: string;
  warningCodes: string[];
}

const PATTERN_MIN_SAMPLE = 5;

function patternRow(
  patternType: string,
  patternValue: string,
  sortOrder: number,
  group: CycleShape[],
  denominator: number,
  excluded = 0,
): PatternRow {
  const sizes = group.flatMap((c) => (c.cycleCostSol ? [c.cycleCostSol] : []));
  const durations = group.flatMap((c) =>
    c.durationSeconds === null ? [] : [D(c.durationSeconds)],
  );
  const results = group.flatMap((c) => (c.rawResultSol ? [c.rawResultSol] : []));
  return {
    patternType,
    patternValue,
    sortOrder,
    totalCount: group.length + excluded,
    eligibleCount: group.length,
    excludedCount: excluded,
    percentage: ratePct(group.length, denominator),
    medianSizeSol: exact(median(sizes)),
    medianDurationSeconds: exact(median(durations)),
    medianRawResultSol: exact(median(results)),
    confidence: group.length >= PATTERN_MIN_SAMPLE ? 'MEDIUM' : 'LOW',
    warningCodes: group.length < PATTERN_MIN_SAMPLE ? [W.VERY_SMALL_CYCLE_SAMPLE] : [],
  };
}

function bucketRows(
  patternType: string,
  buckets: readonly string[],
  cycles: CycleShape[],
  bucketOf: (cycle: CycleShape) => string | null,
  denominator: number,
): PatternRow[] {
  return buckets.flatMap((bucket, index) => {
    const group = cycles.filter((c) => bucketOf(c) === bucket);
    return group.length ? [patternRow(patternType, bucket, index, group, denominator)] : [];
  });
}

export interface FingerprintResult {
  fields: Record<string, string | number | boolean | null>;
  patterns: PatternRow[];
  descriptors: StrategyDescriptor[];
  evidence: DescriptorEvidence[];
  warnings: string[];
  eligibleCycleCount: number;
  excludedCycleCount: number;
}

/**
 * Calculate one wallet's strategy fingerprint from its reconstructed cycles.
 *
 * `hasQualityMetrics` only records whether a completed quality metric set was
 * available — quality analysis is never triggered from here.
 */
export function calculateFingerprint(
  inputs: CycleInput[],
  options: { completeHistory: boolean; hasQualityMetrics: boolean },
): FingerprintResult {
  const all = inputs.map(shapeCycle);
  const cycles = all.filter((c) => c.eligible);
  const excluded = all.filter((c) => !c.eligible);
  const n = cycles.length;
  const warnings = new Set<string>();

  if (!options.completeHistory) warnings.add(W.INCOMPLETE_WALLET_HISTORY);
  if (!options.hasQualityMetrics) warnings.add(W.NO_QUALITY_ANALYSIS);
  if (n < VERY_SMALL_CYCLE_THRESHOLD) warnings.add(W.VERY_SMALL_CYCLE_SAMPLE);
  else if (n < SMALL_CYCLE_THRESHOLD) warnings.add(W.SMALL_CYCLE_SAMPLE);
  if (all.length && n / all.length < 0.5) warnings.add(W.LOW_ELIGIBLE_COVERAGE);
  if (all.some((c) => c.transferAffected)) warnings.add(W.TRANSFER_AFFECTED_CYCLES);
  if (all.some((c) => c.unmatchedSell)) warnings.add(W.UNMATCHED_SELLS_PRESENT);
  if (all.some((c) => c.unknownBasis)) warnings.add(W.UNKNOWN_BASIS);
  if (cycles.some((c) => c.cycleFeesSol === null)) warnings.add(W.MISSING_FEES);
  if (all.some((c) => c.mixedConfidence)) warnings.add(W.MIXED_EVENT_CONFIDENCE);

  // --- entry structure ---
  const buysPerCycle = cycles.map((c) => D(c.buyCount));
  const singleBuy = cycles.filter((c) => c.buyCount === 1);
  const twoBuy = cycles.filter((c) => c.buyCount === 2);
  const multiBuy = cycles.filter((c) => c.buyCount >= 3);
  const scaleIn = cycles.filter((c) => c.buyCount >= 2);
  const firstToSecond = cycles.flatMap((c) =>
    c.firstToSecondBuySeconds === null ? [] : [D(c.firstToSecondBuySeconds)],
  );
  const laterGaps = cycles.flatMap((c) => c.laterBuyGapSeconds.map((s) => D(s)));
  const firstBuySizes = cycles.flatMap((c) => (c.firstBuySol ? [c.firstBuySol] : []));
  const cycleCosts = cycles.flatMap((c) => (c.cycleCostSol ? [c.cycleCostSol] : []));
  const firstBuyShares = cycles.flatMap((c) => (c.firstBuySharePct ? [c.firstBuySharePct] : []));
  const largestBuyShares = cycles.flatMap((c) =>
    c.largestBuySharePct ? [c.largestBuySharePct] : [],
  );

  // --- exit structure ---
  const withSells = cycles.filter((c) => c.sellCount >= 1);
  const sellsPerCycle = withSells.map((c) => D(c.sellCount));
  const singleSell = withSells.filter((c) => c.sellCount === 1);
  const twoSell = withSells.filter((c) => c.sellCount === 2);
  const multiSell = withSells.filter((c) => c.sellCount >= 3);
  const scaleOut = withSells.filter((c) => c.sellCount >= 2);
  const firstBuyToFirstSell = withSells.flatMap((c) =>
    c.firstBuyToFirstSellSeconds === null ? [] : [D(c.firstBuyToFirstSellSeconds)],
  );
  const lastBuyToFirstSell = withSells.flatMap((c) =>
    c.lastBuyToFirstSellSeconds === null ? [] : [D(c.lastBuyToFirstSellSeconds)],
  );
  const firstSellPcts = withSells.flatMap((c) =>
    c.firstSellInventoryPct ? [c.firstSellInventoryPct] : [],
  );
  const largestSellPcts = withSells.flatMap((c) =>
    c.largestSellInventoryPct ? [c.largestSellInventoryPct] : [],
  );
  const remainingPcts = withSells.flatMap((c) =>
    c.remainingAfterFirstSellPct === null ? [] : [c.remainingAfterFirstSellPct],
  );
  const firstToFinalSell = withSells.flatMap((c) =>
    c.firstSellToFinalSellSeconds === null ? [] : [D(c.firstSellToFinalSellSeconds)],
  );
  const partialFirstExits = withSells.filter((c) => c.partialFirstExit);
  const fullyClosed = cycles.filter((c) => c.fullyClosed);
  const openCycles = cycles.filter((c) => c.stillOpen);

  // --- token repetition ---
  const byToken = new Map<string, CycleShape[]>();
  for (const c of cycles) byToken.set(c.tokenId, [...(byToken.get(c.tokenId) ?? []), c]);
  const repeatedTokens = [...byToken.values()].filter((group) => group.length > 1);
  const repeatedCycleCount = repeatedTokens.reduce((total, group) => total + group.length, 0);
  const tokenGaps = repeatedTokens.flatMap((group) => {
    const opens = group
      .flatMap((c) => (c.openedAt ? [c.openedAt.getTime()] : []))
      .sort((a, b) => a - b);
    return opens.slice(1).map((time, index) => D(Math.floor((time - opens[index]) / 1000)));
  });

  // --- fees ---
  const buyFees = cycles.flatMap((c) => c.buyFees.filter((f): f is Decimal => f !== null));
  const sellFees = cycles.flatMap((c) => c.sellFees.filter((f): f is Decimal => f !== null));
  const cycleFees = cycles.flatMap((c) => (c.cycleFeesSol ? [c.cycleFeesSol] : []));
  const burdens = cycles.flatMap((c) => (c.feeBurdenPct ? [c.feeBurdenPct] : []));
  const overBurden = (limit: number) => burdens.filter((b) => b.gt(limit)).length;
  const legs = cycles.map((c) => D(c.legs));
  const medianLegs = median(legs);
  if (medianLegs?.gte(MULTI_LEG_THRESHOLD)) warnings.add(W.MULTI_LEG_FEE_SENSITIVITY);

  // --- concurrency ---
  const concurrency = concurrencyAtOpenings(cycles);

  const medianBurden = median(burdens);
  const p25Cost = quantile(cycleCosts, 0.25);
  const p75Cost = quantile(cycleCosts, 0.75);

  const confidence: 'HIGH' | 'MEDIUM' | 'LOW' =
    n >= SMALL_CYCLE_THRESHOLD && options.completeHistory
      ? 'HIGH'
      : n >= VERY_SMALL_CYCLE_THRESHOLD
        ? 'MEDIUM'
        : 'LOW';

  // ---------------------------------------------------------------------
  // Descriptors — structural, evidence-backed, never evaluative.
  // ---------------------------------------------------------------------
  const evidence: DescriptorEvidence[] = [];
  const warningList = [...warnings].sort();
  const add = (
    code: StrategyDescriptor,
    formula: string,
    numerator: number | null,
    denominator: number | null,
    observed: Decimal | null,
    threshold: Decimal | number,
    sampleCount: number,
  ) => {
    evidence.push({
      code,
      formula,
      numerator,
      denominator,
      observed: exact(observed),
      threshold: D(threshold).toFixed(),
      sampleCount,
      confidence,
      warningCodes: warningList,
    });
  };

  const enoughCycles = n >= T.MIN_SAMPLE;
  if (!enoughCycles) {
    add(
      DESC.INSUFFICIENT_ENTRY_SAMPLE,
      'eligible cycle count is below the minimum sample required for structural descriptors',
      n,
      T.MIN_SAMPLE,
      D(n),
      T.MIN_SAMPLE,
      n,
    );
  } else {
    const singlePct = D(singleBuy.length).div(n).mul(100);
    const scaleInPct = D(scaleIn.length).div(n).mul(100);
    if (singlePct.gte(T.MOSTLY_PCT)) {
      add(
        DESC.MOSTLY_SINGLE_ENTRY,
        'cycles with exactly one buy ÷ eligible cycles × 100',
        singleBuy.length,
        n,
        singlePct,
        T.MOSTLY_PCT,
        n,
      );
    }
    if (scaleInPct.gte(T.FREQUENTLY_PCT)) {
      add(
        DESC.FREQUENTLY_SCALES_IN,
        'cycles with two or more buys (observed scale-in behavior) ÷ eligible cycles × 100',
        scaleIn.length,
        n,
        scaleInPct,
        T.FREQUENTLY_PCT,
        n,
      );
    }

    if (withSells.length >= T.MIN_SAMPLE) {
      const m = withSells.length;
      const singleSellPct = D(singleSell.length).div(m).mul(100);
      const scaleOutPct = D(scaleOut.length).div(m).mul(100);
      // "Left open" means observed inventory REMAINS after selling — not merely
      // that the reconstruction could not certify the cycle as closed.
      const leftOpen = withSells.filter((c) => c.stillOpen);
      const leftOpenPct = D(leftOpen.length).div(m).mul(100);
      if (singleSellPct.gte(T.MOSTLY_PCT)) {
        add(
          DESC.MOSTLY_SINGLE_EXIT,
          'cycles with exactly one sell ÷ eligible cycles with at least one sell × 100',
          singleSell.length,
          m,
          singleSellPct,
          T.MOSTLY_PCT,
          m,
        );
      }
      if (scaleOutPct.gte(T.FREQUENTLY_PCT)) {
        add(
          DESC.FREQUENTLY_SCALES_OUT,
          'cycles with two or more sells ÷ eligible cycles with at least one sell × 100',
          scaleOut.length,
          m,
          scaleOutPct,
          T.FREQUENTLY_PCT,
          m,
        );
      }
      if (leftOpenPct.gte(T.FREQUENTLY_PCT)) {
        add(
          DESC.OFTEN_LEAVES_INVENTORY_OPEN,
          'cycles with at least one sell that still show observed inventory ÷ eligible cycles with at least one sell × 100',
          leftOpen.length,
          m,
          leftOpenPct,
          T.FREQUENTLY_PCT,
          m,
        );
      }
    }

    const closedDurations = cycles.filter((c) => c.durationSeconds !== null);
    if (closedDurations.length >= T.MIN_SAMPLE) {
      const d = closedDurations.length;
      const short = closedDurations.filter(
        (c) => (c.durationSeconds as number) < T.SHORT_HOLD_SECONDS,
      );
      const long = closedDurations.filter(
        (c) => (c.durationSeconds as number) >= T.LONG_HOLD_SECONDS,
      );
      const shortPct = D(short.length).div(d).mul(100);
      const longPct = D(long.length).div(d).mul(100);
      if (shortPct.gte(T.MOSTLY_PCT)) {
        add(
          DESC.MOSTLY_SHORT_OBSERVED_HOLDS,
          `closed cycles held under ${T.SHORT_HOLD_SECONDS} seconds ÷ closed cycles × 100`,
          short.length,
          d,
          shortPct,
          T.MOSTLY_PCT,
          d,
        );
      } else if (longPct.gte(T.MOSTLY_PCT)) {
        add(
          DESC.MOSTLY_LONGER_OBSERVED_HOLDS,
          `closed cycles held at least ${T.LONG_HOLD_SECONDS} seconds ÷ closed cycles × 100`,
          long.length,
          d,
          longPct,
          T.MOSTLY_PCT,
          d,
        );
      } else {
        add(
          DESC.MIXED_HOLDING_DURATIONS,
          'no observed holding-duration group reached the "mostly" threshold',
          Math.max(short.length, long.length),
          d,
          Decimal.max(shortPct, longPct),
          T.MOSTLY_PCT,
          d,
        );
      }
    }

    const venues = new Map<string, number>();
    for (const c of cycles) venues.set(c.venue, (venues.get(c.venue) ?? 0) + 1);
    const topVenue = [...venues.values()].sort((a, b) => b - a)[0] ?? 0;
    const topVenuePct = D(topVenue).div(n).mul(100);
    if (topVenuePct.gte(T.VENUE_CONCENTRATED_PCT)) {
      add(
        DESC.VENUE_CONCENTRATED,
        'eligible cycles on the most-used observed venue ÷ eligible cycles × 100',
        topVenue,
        n,
        topVenuePct,
        T.VENUE_CONCENTRATED_PCT,
        n,
      );
    } else if (topVenuePct.lt(T.VENUE_DIVERSIFIED_PCT)) {
      add(
        DESC.VENUE_DIVERSIFIED,
        'eligible cycles on the most-used observed venue ÷ eligible cycles × 100 (below the diversified threshold)',
        topVenue,
        n,
        topVenuePct,
        T.VENUE_DIVERSIFIED_PCT,
        n,
      );
    }

    if (p25Cost?.gt(0) && p75Cost) {
      const spread = p75Cost.div(p25Cost);
      if (spread.lte(T.SIZE_CONCENTRATED_RATIO)) {
        add(
          DESC.POSITION_SIZES_CONCENTRATED,
          'P75 known cycle cost ÷ P25 known cycle cost',
          null,
          null,
          spread,
          T.SIZE_CONCENTRATED_RATIO,
          cycleCosts.length,
        );
      } else if (spread.gte(T.SIZE_VARIED_RATIO)) {
        add(
          DESC.POSITION_SIZES_VARIED,
          'P75 known cycle cost ÷ P25 known cycle cost',
          null,
          null,
          spread,
          T.SIZE_VARIED_RATIO,
          cycleCosts.length,
        );
      }
    }

    if (medianBurden?.gte(T.FEE_BURDEN_PCT)) {
      add(
        DESC.FEE_SENSITIVE_AT_SMALLER_BANKROLL,
        'median known cycle fees ÷ median known cycle cost × 100 — per-transaction costs stay the same when position size is scaled down, so the same structure costs a larger share of a smaller bankroll',
        null,
        burdens.length,
        medianBurden,
        T.FEE_BURDEN_PCT,
        burdens.length,
      );
    }
  }

  if (!options.completeHistory) {
    add(
      DESC.INCOMPLETE_HISTORY_SAMPLE,
      'the wallet backfill is not complete, so observed cycles may be missing earlier entries or later exits',
      null,
      null,
      null,
      0,
      n,
    );
  }
  const transferAffected = all.filter((c) => c.transferAffected);
  if (transferAffected.length) {
    add(
      DESC.TRANSFER_AFFECTED_SAMPLE,
      'reconstructed cycles affected by token transfers ÷ reconstructed cycles',
      transferAffected.length,
      all.length,
      D(transferAffected.length),
      0,
      all.length,
    );
  }

  // ---------------------------------------------------------------------
  // Pattern rows — factual distributions, stably ordered, never ranked.
  // ---------------------------------------------------------------------
  const patterns: PatternRow[] = [
    ...(n
      ? [
          patternRow('ENTRY_COUNT', '1 buy', 0, singleBuy, n),
          patternRow('ENTRY_COUNT', '2 buys', 1, twoBuy, n),
          patternRow('ENTRY_COUNT', '3 or more buys', 2, multiBuy, n),
          patternRow('EXIT_COUNT', 'No observed sell', 0, cycles.filter((c) => c.sellCount === 0), n),
          patternRow('EXIT_COUNT', '1 sell', 1, singleSell, n),
          patternRow('EXIT_COUNT', '2 sells', 2, twoSell, n),
          patternRow('EXIT_COUNT', '3 or more sells', 3, multiSell, n),
          patternRow('COMPLETENESS', 'Fully closed', 0, fullyClosed, n),
          patternRow('COMPLETENESS', 'Observed inventory still open', 1, openCycles, n),
          patternRow('COMPLETENESS', 'Transfer-affected', 2, all.filter((c) => c.transferAffected), n),
          patternRow('COMPLETENESS', 'Unmatched sell', 3, all.filter((c) => c.unmatchedSell), n),
          patternRow('TOKEN_REPETITION', 'Token traded once', 0, cycles.filter((c) => (byToken.get(c.tokenId)?.length ?? 0) === 1), n),
          patternRow('TOKEN_REPETITION', 'Token traded again', 1, cycles.filter((c) => (byToken.get(c.tokenId)?.length ?? 0) > 1), n),
        ].filter((row) => row.eligibleCount > 0)
      : []),
    ...bucketRows('ENTRY_TIMING', TIME_BUCKETS, scaleIn, (c) => timeBucket(c.firstToSecondBuySeconds), scaleIn.length),
    ...bucketRows('EXIT_TIMING', TIME_BUCKETS, withSells, (c) => timeBucket(c.firstBuyToFirstSellSeconds), withSells.length),
    ...bucketRows('HOLDING_DURATION', TIME_BUCKETS, cycles, (c) => timeBucket(c.durationSeconds), n),
    ...bucketRows('POSITION_SIZE', SIZE_BUCKETS, cycles, (c) => sizeBucket(c.cycleCostSol), n),
    ...bucketRows('FEE_BURDEN', FEE_BUCKETS, cycles, (c) => feeBucket(c.feeBurdenPct), n),
  ];

  const venueValues = [...new Set(cycles.map((c) => c.venue))].sort((a, b) => a.localeCompare(b));
  venueValues.forEach((venue, index) => {
    patterns.push(
      patternRow('VENUE', venue, index, cycles.filter((c) => c.venue === venue), n),
    );
  });
  const routerValues = [...new Set(cycles.map((c) => c.router))].sort((a, b) => a.localeCompare(b));
  routerValues.forEach((router, index) => {
    patterns.push(
      patternRow('ROUTER', router, index, cycles.filter((c) => c.router === router), n),
    );
  });

  const fields = {
    eligibleCycleCount: n,
    excludedCycleCount: excluded.length,
    eligibleBuyCount: cycles.reduce((total, c) => total + c.buyCount, 0),
    eligibleSellCount: cycles.reduce((total, c) => total + c.sellCount, 0),

    medianBuysPerCycle: exact(median(buysPerCycle)),
    meanBuysPerCycle: exact(mean(buysPerCycle)),
    p25BuysPerCycle: exact(quantile(buysPerCycle, 0.25)),
    p75BuysPerCycle: exact(quantile(buysPerCycle, 0.75)),
    singleBuyCycleCount: singleBuy.length,
    twoBuyCycleCount: twoBuy.length,
    multiBuyCycleCount: multiBuy.length,
    medianFirstToSecondBuySeconds: exact(median(firstToSecond)),
    medianLaterBuyGapSeconds: exact(median(laterGaps)),
    medianFirstBuySol: exact(median(firstBuySizes)),
    medianCycleCostSol: exact(median(cycleCosts)),
    p75CycleCostSol: exact(p75Cost),
    medianFirstBuySharePct: exact(median(firstBuyShares)),
    medianLargestBuySharePct: exact(median(largestBuyShares)),
    largestBuyFirstCycleCount: cycles.filter((c) => c.largestBuyIsFirst).length,
    increasingSizeCycleCount: cycles.filter((c) => c.sizeIncreasedLater).length,

    cyclesWithSellCount: withSells.length,
    medianSellsPerCycle: exact(median(sellsPerCycle)),
    singleSellCycleCount: singleSell.length,
    twoSellCycleCount: twoSell.length,
    multiSellCycleCount: multiSell.length,
    medianFirstBuyToFirstSellSeconds: exact(median(firstBuyToFirstSell)),
    medianLastBuyToFirstSellSeconds: exact(median(lastBuyToFirstSell)),
    medianFirstSellInventoryPct: exact(median(firstSellPcts)),
    medianLargestSellInventoryPct: exact(median(largestSellPcts)),
    medianRemainingAfterFirstSellPct: exact(median(remainingPcts)),
    medianFirstSellToFinalSellSeconds: exact(median(firstToFinalSell)),
    partialFirstExitCycleCount: partialFirstExits.length,
    fullyClosedCycleCount: fullyClosed.length,
    openCycleCount: openCycles.length,

    transferAffectedCycleCount: transferAffected.length,
    unmatchedSellCount: all.filter((c) => c.unmatchedSell).length,
    unknownBasisCycleCount: all.filter((c) => c.unknownBasis).length,
    missingFeeCycleCount: cycles.filter((c) => c.cycleFeesSol === null).length,
    eligibleCoveragePct: ratePct(n, all.length),
    feeCoveragePct: ratePct(cycleFees.length, n),
    completeHistory: options.completeHistory,

    distinctTokenCount: byToken.size,
    repeatedTokenCount: repeatedTokens.length,
    repeatedTokenCycleCount: repeatedCycleCount,
    maxCyclesPerToken: [...byToken.values()].reduce((max, g) => Math.max(max, g.length), 0),
    medianSecondsBetweenTokenCycles: exact(median(tokenGaps)),

    medianFeePerBuySol: exact(median(buyFees)),
    medianFeePerSellSol: exact(median(sellFees)),
    medianFeePerCycleSol: exact(median(cycleFees)),
    medianFeeBurdenPct: exact(medianBurden),
    p75FeeBurdenPct: exact(quantile(burdens, 0.75)),
    feeBurdenOver1PctCount: overBurden(1),
    feeBurdenOver2PctCount: overBurden(2),
    feeBurdenOver5PctCount: overBurden(5),
    feeBurdenOver10PctCount: overBurden(10),
    medianLegsPerCycle: exact(medianLegs),

    observedMaxConcurrentPositions: maxConcurrent(cycles),
    medianConcurrentPositions: exact(median(concurrency)),

    status: n > 0 ? 'COMPLETE' : 'INSUFFICIENT_EVIDENCE',
    confidence,
  };

  return {
    fields,
    patterns,
    descriptors: evidence.map((e) => e.code),
    evidence,
    warnings: warningList,
    eligibleCycleCount: n,
    excludedCycleCount: excluded.length,
  };
}
