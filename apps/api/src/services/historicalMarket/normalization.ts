import type { CandleInterval, HistoricalCandle } from '../../providers/historicalMarket/types.js';
import { intervalSeconds } from './intervals.js';

/**
 * Validates and normalizes provider candles into storable rows.
 *
 * Rejects candles that violate OHLC invariants (high ≥ max(open,close,low),
 * low ≤ min(open,close,high)) or have non-finite/negative values. Deduplicates
 * by openTime (keeping the first occurrence). Sorts ascending by openTime.
 * Unknown volume stays null (never zero). Gaps are NOT filled here — missing
 * timestamps are simply absent, and detected separately by the backfill/gap
 * logic. No look-ahead or interpolation happens.
 */

export interface NormalizedCandle {
  openTimeSec: number;
  closeTimeSec: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volumeUsd: string | null;
}

export interface NormalizationResult {
  candles: NormalizedCandle[];
  rejected: number;
}

function n(value: string): number {
  return Number(value);
}

function isValidOhlc(c: HistoricalCandle): boolean {
  const o = n(c.open);
  const h = n(c.high);
  const l = n(c.low);
  const cl = n(c.close);
  if (![o, h, l, cl].every((v) => Number.isFinite(v) && v > 0)) return false;
  // high must be the max, low must be the min.
  if (h + 1e-30 < Math.max(o, cl, l)) return false;
  if (l - 1e-30 > Math.min(o, cl, h)) return false;
  if (c.volumeUsd !== null) {
    const v = n(c.volumeUsd);
    if (!Number.isFinite(v) || v < 0) return false;
  }
  return true;
}

export function normalizeCandles(
  candles: HistoricalCandle[],
  interval: CandleInterval,
): NormalizationResult {
  const durationSec = intervalSeconds(interval);
  const byOpen = new Map<number, NormalizedCandle>();
  let rejected = 0;

  for (const candle of candles) {
    if (!Number.isFinite(candle.openTimeSec) || candle.openTimeSec <= 0 || !isValidOhlc(candle)) {
      rejected += 1;
      continue;
    }
    // First occurrence wins for a given openTime (duplicate timestamps removed).
    if (byOpen.has(candle.openTimeSec)) continue;
    byOpen.set(candle.openTimeSec, {
      openTimeSec: candle.openTimeSec,
      closeTimeSec: candle.openTimeSec + durationSec,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volumeUsd: candle.volumeUsd,
    });
  }

  const sorted = [...byOpen.values()].sort((a, b) => a.openTimeSec - b.openTimeSec);
  return { candles: sorted, rejected };
}

/**
 * Counts missing candle slots (gaps) within [startSec, endSec] given the
 * normalized candles' openTimes. A gap is an interval-aligned slot inside the
 * observed coverage span that has no candle. Slots before the first or after
 * the last observed candle are not counted (that is missing coverage, reported
 * separately as coverage bounds), only interior holes.
 */
export function countGaps(
  candles: NormalizedCandle[],
  interval: CandleInterval,
): number {
  if (candles.length < 2) return 0;
  const step = intervalSeconds(interval);
  let gaps = 0;
  for (let i = 1; i < candles.length; i++) {
    const expected = candles[i - 1].openTimeSec + step;
    const actual = candles[i].openTimeSec;
    if (actual > expected) {
      gaps += Math.round((actual - expected) / step);
    }
  }
  return gaps;
}
