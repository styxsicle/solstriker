import type { CandleInterval } from '../../providers/historicalMarket/types.js';

/** Centralized interval durations (seconds). Single source of truth. */
export const INTERVAL_SECONDS: Record<CandleInterval, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
};

export const SUPPORTED_INTERVALS: CandleInterval[] = ['1m', '5m', '15m', '1h'];

export function isSupportedInterval(value: string): value is CandleInterval {
  return (SUPPORTED_INTERVALS as string[]).includes(value);
}

export function intervalSeconds(interval: CandleInterval): number {
  return INTERVAL_SECONDS[interval];
}

/**
 * Maximum historical window per backfill request, per interval. Bounds provider
 * paging (finer intervals cover less wall-clock time to stay within page caps).
 */
export const MAX_RANGE_SECONDS: Record<CandleInterval, number> = {
  '1m': 3 * 24 * 3600, // 3 days of 1-minute candles
  '5m': 14 * 24 * 3600, // 14 days
  '15m': 30 * 24 * 3600, // 30 days
  '1h': 180 * 24 * 3600, // 180 days
};
