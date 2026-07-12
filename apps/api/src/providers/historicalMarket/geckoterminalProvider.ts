import { HistoricalProviderError } from './errors.js';
import type { HistoricalMarketProvider } from './historicalMarketProvider.js';
import type {
  CandleInterval,
  HistoricalCandle,
  HistoricalLookupParams,
  HistoricalLookupResult,
} from './types.js';

/**
 * GeckoTerminal historical OHLCV provider.
 *
 * Official documentation (accessed 2026-07-12):
 *   https://www.geckoterminal.com/dex-api  and
 *   https://api.geckoterminal.com/api/v2  (public API guide:
 *   https://apiguide.geckoterminal.com/).
 *   Endpoint: GET /api/v2/networks/{network}/pools/{pool_address}/ohlcv/{timeframe}
 *   Query: aggregate, before_timestamp, limit (max 1000), currency=usd, token=base.
 *   Rate limit: 30 requests/minute for the free public API — NO API key required.
 *   Response: data.attributes.ohlcv_list = [ [unixSec, open, high, low, close, volumeUsd], ... ]
 *   ordered newest-first. Timestamps are UTC seconds and mark the candle OPEN.
 *   Periods with no trades are OMITTED (gaps are not zero-filled).
 *
 * No credential exists; if a keyed tier is ever adopted, the key must stay
 * inside this closure (backend-only), never a VITE_ variable.
 */

const NETWORK = 'solana';
const PAGE_LIMIT = 1000; // provider max per call
const DEFAULT_MAX_PAGES = 10; // bounded paging (≤10k candles per backfill token)

interface IntervalSpec {
  timeframe: 'minute' | 'hour';
  aggregate: number;
}

const INTERVAL_MAP: Record<CandleInterval, IntervalSpec> = {
  '1m': { timeframe: 'minute', aggregate: 1 },
  '5m': { timeframe: 'minute', aggregate: 5 },
  '15m': { timeframe: 'minute', aggregate: 15 },
  '1h': { timeframe: 'hour', aggregate: 1 },
};

export interface GeckoterminalProviderOptions {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  maxPages?: number;
}

function toDecimalString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function toOhlc(value: unknown): string | null {
  const s = toDecimalString(value);
  if (s === null) return null;
  // OHLC must be a positive finite number.
  return Number(s) > 0 ? s : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterMs(res: Response): number | null {
  const header = res.headers.get('retry-after');
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30_000);
  return null;
}

export function createGeckoterminalProvider(
  options: GeckoterminalProviderOptions = {},
): HistoricalMarketProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl ?? 'https://api.geckoterminal.com/api/v2';
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxRetries = options.maxRetries ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 750;
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;

  async function fetchPage(
    pairAddress: string,
    spec: IntervalSpec,
    beforeTimestamp: number,
  ): Promise<unknown> {
    const params = new URLSearchParams({
      aggregate: String(spec.aggregate),
      before_timestamp: String(beforeTimestamp),
      limit: String(PAGE_LIMIT),
      currency: 'usd',
      token: 'base',
    });
    const url = `${baseUrl}/networks/${NETWORK}/pools/${pairAddress}/ohlcv/${spec.timeframe}?${params.toString()}`;

    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await fetchImpl(url, {
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        const isTimeout = err instanceof Error && err.name === 'TimeoutError';
        if (attempt < maxRetries) {
          await sleep(retryDelayMs * (attempt + 1));
          continue;
        }
        throw new HistoricalProviderError(
          isTimeout ? 'timeout' : 'network_error',
          isTimeout
            ? 'historical market provider timed out'
            : 'network error contacting historical market provider',
          true,
        );
      }

      if (res.status === 429) {
        if (attempt < maxRetries) {
          await sleep(retryAfterMs(res) ?? retryDelayMs * (attempt + 1));
          continue;
        }
        throw new HistoricalProviderError(
          'rate_limited',
          'historical market provider rate limit reached',
          true,
        );
      }
      if (res.status >= 500) {
        if (attempt < maxRetries) {
          await sleep(retryDelayMs * (attempt + 1));
          continue;
        }
        throw new HistoricalProviderError('provider_error', 'historical market provider error', true);
      }
      if (res.status === 404) {
        throw new HistoricalProviderError('not_found', 'pair not found at historical provider', false);
      }
      if (!res.ok) {
        throw new HistoricalProviderError(
          'bad_request',
          `historical market provider rejected the request (status ${res.status})`,
          false,
        );
      }

      try {
        return await res.json();
      } catch {
        throw new HistoricalProviderError(
          'malformed_response',
          'historical market provider returned an unreadable response',
          false,
        );
      }
    }
  }

  function parsePage(data: unknown): HistoricalCandle[] {
    const list = (data as { data?: { attributes?: { ohlcv_list?: unknown } } })?.data?.attributes
      ?.ohlcv_list;
    if (!Array.isArray(list)) {
      throw new HistoricalProviderError(
        'malformed_response',
        'historical market provider returned an unexpected shape',
        false,
      );
    }
    const candles: HistoricalCandle[] = [];
    for (const row of list) {
      if (!Array.isArray(row) || row.length < 5) continue;
      const openTimeSec = typeof row[0] === 'number' && Number.isFinite(row[0]) ? row[0] : null;
      const open = toOhlc(row[1]);
      const high = toOhlc(row[2]);
      const low = toOhlc(row[3]);
      const close = toOhlc(row[4]);
      if (openTimeSec === null || !open || !high || !low || !close) continue;
      const volRaw = toDecimalString(row[5]);
      // Negative volume is invalid → treated as unknown (null), never zero.
      const volumeUsd = volRaw !== null && Number(volRaw) >= 0 ? volRaw : null;
      candles.push({ openTimeSec, open, high, low, close, volumeUsd });
    }
    return candles;
  }

  async function fetchCandles(params: HistoricalLookupParams): Promise<HistoricalLookupResult> {
    const spec = INTERVAL_MAP[params.interval];
    if (!spec) {
      throw new HistoricalProviderError('bad_request', 'unsupported interval', false);
    }

    const collected: HistoricalCandle[] = [];
    const seen = new Set<number>();
    // Page backwards from just after the requested end until we pass the start.
    let before = params.endSec + 1;
    for (let page = 0; page < maxPages; page++) {
      const data = await fetchPage(params.pairAddress, spec, before);
      const candles = parsePage(data);
      if (candles.length === 0) break;

      let oldest = before;
      for (const candle of candles) {
        if (candle.openTimeSec < oldest) oldest = candle.openTimeSec;
        if (
          candle.openTimeSec >= params.startSec &&
          candle.openTimeSec <= params.endSec &&
          !seen.has(candle.openTimeSec)
        ) {
          seen.add(candle.openTimeSec);
          collected.push(candle);
        }
      }
      // Stop once the page reaches back past the requested start.
      if (oldest <= params.startSec || oldest >= before) break;
      before = oldest;
    }

    return {
      provider: 'geckoterminal',
      chainId: params.chainId,
      pairAddress: params.pairAddress,
      interval: params.interval,
      fetchedAt: Date.now(),
      candles: collected,
    };
  }

  return {
    name: 'geckoterminal',
    // GeckoTerminal's public OHLCV endpoint needs no credential.
    isConfigured: () => true,
    supportedIntervals: () => Object.keys(INTERVAL_MAP),
    fetchCandles,
  };
}
