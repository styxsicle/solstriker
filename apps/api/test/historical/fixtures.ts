// Historical-market fixtures — synthetic pairs/mints only, never real data.
import type { HistoricalMarketProvider } from '../../src/providers/historicalMarket/historicalMarketProvider.js';
import type {
  HistoricalCandle,
  HistoricalLookupParams,
  HistoricalLookupResult,
} from '../../src/providers/historicalMarket/types.js';

export const PAIR_A = 'FAKEpairAAA1111111111111111111111111111111';

/** Base unix-second timestamp used across fixtures (UTC, minute-aligned). */
export const BASE_TS = 1_783_000_000 - (1_783_000_000 % 60);

/**
 * Build a contiguous minute-candle series of `count` candles from `startSec`,
 * with a simple deterministic price path. Each candle: open=close_prev,
 * close=open*(1+drift), high/low bracket them.
 */
export function makeMinuteSeries(
  startSec: number,
  count: number,
  opts: { startPrice?: number; drift?: number; volume?: number | null } = {},
): HistoricalCandle[] {
  const drift = opts.drift ?? 0.01;
  let price = opts.startPrice ?? 100;
  const out: HistoricalCandle[] = [];
  for (let i = 0; i < count; i++) {
    const open = price;
    const close = open * (1 + drift);
    const high = Math.max(open, close) * 1.005;
    const low = Math.min(open, close) * 0.995;
    out.push({
      openTimeSec: startSec + i * 60,
      open: String(open),
      high: String(high),
      low: String(low),
      close: String(close),
      volumeUsd: opts.volume === undefined ? '1000' : opts.volume === null ? null : String(opts.volume),
    });
    price = close;
  }
  return out;
}

/** Fake provider serving canned candles (or throwing). */
export class FakeHistoricalProvider implements HistoricalMarketProvider {
  readonly name = 'fake-historical';
  readonly calls: HistoricalLookupParams[] = [];

  constructor(
    private candles: HistoricalCandle[],
    private options: { configured?: boolean; failWith?: Error } = {},
  ) {}

  isConfigured(): boolean {
    return this.options.configured ?? true;
  }
  supportedIntervals(): readonly string[] {
    return ['1m', '5m', '15m', '1h'];
  }
  async fetchCandles(params: HistoricalLookupParams): Promise<HistoricalLookupResult> {
    this.calls.push(params);
    if (this.options.failWith) throw this.options.failWith;
    const inRange = this.candles.filter(
      (c) => c.openTimeSec >= params.startSec && c.openTimeSec <= params.endSec,
    );
    return {
      provider: this.name,
      chainId: params.chainId,
      pairAddress: params.pairAddress,
      interval: params.interval,
      fetchedAt: Date.now(),
      candles: inRange,
    };
  }
}

/** Raw GeckoTerminal-shaped OHLCV response for provider-mapping tests. */
export function rawGeckoResponse(rows: unknown[][]): Record<string, unknown> {
  return {
    data: {
      id: 'x',
      type: 'ohlcv_request_response',
      attributes: { ohlcv_list: rows },
    },
    meta: {
      base: { name: 'fixt', symbol: 'FIXT', address: 'baseMint' },
      quote: { name: 'Wrapped SOL', symbol: 'SOL', address: 'So11111111111111111111111111111111111111112' },
    },
  };
}
