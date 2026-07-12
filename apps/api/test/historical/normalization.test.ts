import { describe, expect, it } from 'vitest';
import { countGaps, normalizeCandles } from '../../src/services/historicalMarket/normalization.js';
import type { HistoricalCandle } from '../../src/providers/historicalMarket/types.js';
import { makeMinuteSeries, BASE_TS } from './fixtures.js';

describe('candle normalization', () => {
  it('sorts ascending, computes closeTime, and preserves exact decimals', () => {
    const raw: HistoricalCandle[] = [
      { openTimeSec: BASE_TS + 60, open: '2', high: '3', low: '1.5', close: '2.5', volumeUsd: '10' },
      { openTimeSec: BASE_TS, open: '1', high: '2', low: '0.9', close: '2', volumeUsd: null },
    ];
    const { candles } = normalizeCandles(raw, '1m');
    expect(candles.map((c) => c.openTimeSec)).toEqual([BASE_TS, BASE_TS + 60]);
    expect(candles[0].closeTimeSec).toBe(BASE_TS + 60);
    expect(candles[0].open).toBe('1');
    expect(candles[0].volumeUsd).toBeNull(); // unknown volume stays null
  });

  it('rejects candles violating OHLC invariants and non-positive values', () => {
    const raw: HistoricalCandle[] = [
      { openTimeSec: BASE_TS, open: '1', high: '0.5', low: '0.9', close: '1', volumeUsd: '1' }, // high < open
      { openTimeSec: BASE_TS + 60, open: '1', high: '2', low: '1.5', close: '1', volumeUsd: '1' }, // low > close
      { openTimeSec: BASE_TS + 120, open: '0', high: '1', low: '0', close: '1', volumeUsd: '1' }, // non-positive
      { openTimeSec: BASE_TS + 180, open: '1', high: '2', low: '0.5', close: '1.5', volumeUsd: '1' }, // valid
    ];
    const { candles, rejected } = normalizeCandles(raw, '1m');
    expect(candles).toHaveLength(1);
    expect(candles[0].openTimeSec).toBe(BASE_TS + 180);
    expect(rejected).toBe(3);
  });

  it('deduplicates duplicate timestamps (first occurrence wins)', () => {
    const raw: HistoricalCandle[] = [
      { openTimeSec: BASE_TS, open: '1', high: '2', low: '0.9', close: '2', volumeUsd: '10' },
      { openTimeSec: BASE_TS, open: '9', high: '9', low: '9', close: '9', volumeUsd: '99' },
    ];
    const { candles } = normalizeCandles(raw, '1m');
    expect(candles).toHaveLength(1);
    expect(candles[0].open).toBe('1');
  });

  it('detects interior gaps between candles', () => {
    // Candles at t0, t1, t3, t4 → one missing slot at t2.
    const series = makeMinuteSeries(BASE_TS, 5);
    const withGap = series.filter((_, i) => i !== 2);
    const { candles } = normalizeCandles(withGap, '1m');
    expect(countGaps(candles, '1m')).toBe(1);
  });

  it('reports zero gaps for a contiguous series', () => {
    const { candles } = normalizeCandles(makeMinuteSeries(BASE_TS, 10), '1m');
    expect(countGaps(candles, '1m')).toBe(0);
  });
});
