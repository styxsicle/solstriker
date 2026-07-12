import { describe, expect, it } from 'vitest';
import {
  horizonExtremes,
  priceAt,
  selectEntryCandle,
  windowResult,
  type CandleRow,
} from '../../src/services/walletOutcomes/outcomeMath.js';

// Build simple minute candles with explicit OHLC.
function candle(openSec: number, o: number, h: number, l: number, c: number): CandleRow {
  return {
    openTimeSec: openSec,
    closeTimeSec: openSec + 60,
    open: String(o),
    high: String(h),
    low: String(l),
    close: String(c),
  };
}

const T0 = 1_783_000_000;

describe('entry candle selection', () => {
  it('selects the first candle at or after the entry time (post-entry, no look-ahead)', () => {
    const candles = [candle(T0 - 60, 9, 9, 9, 9), candle(T0 + 30, 10, 11, 9, 10.5), candle(T0 + 90, 10.5, 12, 10, 11)];
    const entry = selectEntryCandle(candles, T0);
    expect(entry).not.toBeNull();
    expect(entry!.entryPriceUsd).toBe('10'); // open of the T0+30 candle, not the pre-entry one
    expect(entry!.entryCandleOpenTimeSec).toBe(T0 + 30);
    expect(entry!.entryDelaySeconds).toBe(30);
  });

  it('returns null when no candle starts at or after entry', () => {
    expect(selectEntryCandle([candle(T0 - 120, 1, 1, 1, 1)], T0)).toBeNull();
  });
});

describe('window price and return', () => {
  const candles = [
    candle(T0, 10, 10, 10, 10),
    candle(T0 + 60, 10, 12, 10, 11), // +1m .. +2m
    candle(T0 + 300, 11, 15, 11, 12), // covers +5m target (T0+300)
  ];

  it('uses the close of the candle covering entry+window', () => {
    const r = windowResult(candles, T0, 10, 300);
    expect(r.price).toBe('12'); // close of the T0+300 candle
    expect(r.returnPct).toBe('20.000000'); // (12-10)/10*100
  });

  it('returns null for a window with no covering candle (gap/beyond coverage)', () => {
    expect(priceAt(candles, T0 + 100000)).toBeNull();
    const r = windowResult(candles, T0, 10, 100000);
    expect(r.price).toBeNull();
    expect(r.returnPct).toBeNull();
  });
});

describe('horizon extremes (max/min/drawdown/timeToMax)', () => {
  it('computes max, min, returns, drawdown and time to max over the horizon', () => {
    const entryOpen = T0;
    const candles = [
      candle(T0, 10, 12, 9, 11), // high 12
      candle(T0 + 60, 11, 20, 8, 9), // high 20 (max), low 8 (min)
      candle(T0 + 120, 9, 10, 9, 9),
    ];
    const h = horizonExtremes(candles, T0, entryOpen, 10, 3600);
    expect(h.maxPriceUsd).toBe('20');
    expect(h.minPriceUsd).toBe('8');
    expect(h.maxReturnPct).toBe('100.000000'); // (20-10)/10*100
    expect(h.maxDrawdownPct).toBe('-20.000000'); // (8-10)/10*100
    expect(h.timeToMaxSeconds).toBe(60); // candle achieving max opened at T0+60
  });

  it('marks not fully covered when candles do not reach the horizon end', () => {
    const candles = [candle(T0, 10, 12, 9, 11)];
    const h = horizonExtremes(candles, T0, T0, 10, 86400);
    expect(h.fullyCovered).toBe(false);
    expect(h.maxPriceUsd).toBe('12'); // still computed over observed candles
  });
});
