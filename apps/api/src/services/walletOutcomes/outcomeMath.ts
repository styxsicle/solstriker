/**
 * Deterministic post-entry outcome math from stored candles. Pure functions,
 * no DB, no look-ahead beyond the provided candles.
 *
 * FORMULAS (all documented; percentages in whole-percent units):
 *
 *   entry price      = open of the FIRST candle whose openTime >= entryTime
 *                      (method CANDLE_OPEN). This is strictly post-entry — the
 *                      wallet may have executed before this candle opened, so it
 *                      is an APPROXIMATION, not the wallet's fill.
 *   entry delay      = entryCandleOpenTime - entryTime (seconds, ≥ 0).
 *   window price (W) = close of the candle covering (entryTime + W), i.e. the
 *                      candle with openTime ≤ target < closeTime. Missing (gap
 *                      or beyond coverage) → null (never forward-filled).
 *   return(W) %      = (windowPrice - entryPrice) / entryPrice * 100.
 *   maxPrice(H)      = max(high) over candles with openTime in
 *                      [entryCandleOpenTime, entryTime + H].
 *   minPrice(H)      = min(low) over the same candles.
 *   maxReturn(H) %   = (maxPrice - entryPrice) / entryPrice * 100.
 *   maxDrawdown(H) % = (minPrice - entryPrice) / entryPrice * 100  (≤ 0; the
 *                      worst observed decline from entry).
 *   timeToMax(H)     = openTime(candle achieving maxPrice) - entryTime (seconds).
 *
 * Fees, priority fees, price impact, slippage, and exit rules are intentionally
 * excluded — these are raw market observations, not achievable fills.
 */

export interface CandleRow {
  openTimeSec: number;
  closeTimeSec: number;
  open: string;
  high: string;
  low: string;
  close: string;
}

export const WINDOW_SECONDS = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '1h': 3600,
  '4h': 14400,
  '24h': 86400,
} as const;

export type WindowLabel = keyof typeof WINDOW_SECONDS;
export const WINDOW_LABELS = Object.keys(WINDOW_SECONDS) as WindowLabel[];

/** Fixed-precision percentage string (avoids float noise in stored decimals). */
function pct(numerator: number, denominator: number): string | null {
  if (!(denominator > 0)) return null;
  const value = (numerator / denominator) * 100;
  if (!Number.isFinite(value)) return null;
  return value.toFixed(6);
}

export interface EntrySelection {
  entryPriceUsd: string;
  entryCandleOpenTimeSec: number;
  entryDelaySeconds: number;
}

/**
 * First candle with openTime >= entryTime. Candles must be ascending by
 * openTime. Returns null when no candle starts at/after entry (no coverage).
 */
export function selectEntryCandle(
  candles: CandleRow[],
  entryTimeSec: number,
): EntrySelection | null {
  for (const candle of candles) {
    if (candle.openTimeSec >= entryTimeSec) {
      return {
        entryPriceUsd: candle.open,
        entryCandleOpenTimeSec: candle.openTimeSec,
        entryDelaySeconds: candle.openTimeSec - entryTimeSec,
      };
    }
  }
  return null;
}

/** Close of the candle covering targetSec (openTime ≤ target < closeTime). */
export function priceAt(candles: CandleRow[], targetSec: number): string | null {
  for (const candle of candles) {
    if (candle.openTimeSec <= targetSec && targetSec < candle.closeTimeSec) {
      return candle.close;
    }
  }
  return null;
}

export interface WindowResult {
  price: string | null;
  returnPct: string | null;
}

export function windowResult(
  candles: CandleRow[],
  entryTimeSec: number,
  entryPrice: number,
  windowSec: number,
): WindowResult {
  const price = priceAt(candles, entryTimeSec + windowSec);
  return {
    price,
    returnPct: price !== null ? pct(Number(price) - entryPrice, entryPrice) : null,
  };
}

export interface HorizonExtremes {
  maxPriceUsd: string | null;
  minPriceUsd: string | null;
  maxReturnPct: string | null;
  maxDrawdownPct: string | null;
  timeToMaxSeconds: number | null;
  /** True when candle coverage reaches the full horizon end. */
  fullyCovered: boolean;
}

export function horizonExtremes(
  candles: CandleRow[],
  entryTimeSec: number,
  entryCandleOpenTimeSec: number,
  entryPrice: number,
  horizonSec: number,
): HorizonExtremes {
  const horizonEnd = entryTimeSec + horizonSec;
  const inRange = candles.filter(
    (c) => c.openTimeSec >= entryCandleOpenTimeSec && c.openTimeSec <= horizonEnd,
  );
  if (inRange.length === 0) {
    return {
      maxPriceUsd: null,
      minPriceUsd: null,
      maxReturnPct: null,
      maxDrawdownPct: null,
      timeToMaxSeconds: null,
      fullyCovered: false,
    };
  }

  let maxHigh = -Infinity;
  let maxHighCandle = inRange[0];
  let minLow = Infinity;
  for (const c of inRange) {
    const high = Number(c.high);
    const low = Number(c.low);
    if (high > maxHigh) {
      maxHigh = high;
      maxHighCandle = c;
    }
    if (low < minLow) minLow = low;
  }

  // Fully covered when a candle reaches to/after the horizon end.
  const lastOpen = inRange[inRange.length - 1].openTimeSec;
  const lastClose = inRange[inRange.length - 1].closeTimeSec;
  const fullyCovered = lastClose >= horizonEnd || lastOpen >= horizonEnd;

  return {
    maxPriceUsd: String(maxHigh),
    minPriceUsd: String(minLow),
    maxReturnPct: pct(maxHigh - entryPrice, entryPrice),
    maxDrawdownPct: pct(minLow - entryPrice, entryPrice),
    timeToMaxSeconds: Math.max(0, maxHighCandle.openTimeSec - entryTimeSec),
    fullyCovered,
  };
}
