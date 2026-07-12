import { MarketProviderError } from './errors.js';
import type { MarketDataProvider } from './marketDataProvider.js';
import type {
  MarketLookupResult,
  MarketPairCandidate,
  PairTxnCounts,
  WindowKey,
} from './types.js';

/**
 * DexScreener market-data provider.
 *
 * Official documentation (accessed 2026-07-11):
 *   https://docs.dexscreener.com/api/reference
 *   Endpoint: GET https://api.dexscreener.com/tokens/v1/{chainId}/{tokenAddresses}
 *   ("Get one or multiple pairs by token address", rate limit 300 requests/min,
 *   no authentication — securities: []). Up to 30 comma-separated addresses.
 *
 * No credential exists for this provider; if one is ever added, it must stay
 * inside this closure like the Helius key does.
 */

const MAX_MINTS_PER_CALL = 30;
const WINDOWS: WindowKey[] = ['m5', 'h1', 'h6', 'h24'];

export interface DexscreenerProviderOptions {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

/** Exact-string conversion: numbers → decimal strings, junk → null. */
function toDecimalString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function toCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function toMs(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

interface RawPair {
  chainId?: unknown;
  dexId?: unknown;
  pairAddress?: unknown;
  baseToken?: { address?: unknown; name?: unknown; symbol?: unknown };
  quoteToken?: { address?: unknown; name?: unknown; symbol?: unknown };
  priceNative?: unknown;
  priceUsd?: unknown;
  txns?: Partial<Record<WindowKey, { buys?: unknown; sells?: unknown }>>;
  volume?: Partial<Record<WindowKey, unknown>>;
  priceChange?: Partial<Record<WindowKey, unknown>>;
  liquidity?: { usd?: unknown };
  fdv?: unknown;
  marketCap?: unknown;
  pairCreatedAt?: unknown;
}

export function mapRawDexscreenerPair(raw: unknown): MarketPairCandidate | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const pair = raw as RawPair;
  const chainId = asString(pair.chainId);
  const pairAddress = asString(pair.pairAddress);
  const baseMint = asString(pair.baseToken?.address);
  if (!chainId || !pairAddress || !baseMint) return null;

  const volumeUsd = {} as Record<WindowKey, string | null>;
  const priceChangePct = {} as Record<WindowKey, string | null>;
  const txns = {} as Record<WindowKey, PairTxnCounts>;
  for (const window of WINDOWS) {
    volumeUsd[window] = toDecimalString(pair.volume?.[window]);
    priceChangePct[window] = toDecimalString(pair.priceChange?.[window]);
    txns[window] = {
      buys: toCount(pair.txns?.[window]?.buys),
      sells: toCount(pair.txns?.[window]?.sells),
    };
  }

  return {
    chainId,
    pairAddress,
    dex: asString(pair.dexId),
    baseMint,
    baseName: asString(pair.baseToken?.name),
    baseSymbol: asString(pair.baseToken?.symbol),
    quoteMint: asString(pair.quoteToken?.address),
    quoteSymbol: asString(pair.quoteToken?.symbol),
    priceUsd: toDecimalString(pair.priceUsd),
    priceNative: toDecimalString(pair.priceNative),
    // DexScreener reports marketCap and fdv separately; each is kept as-is
    // and never substituted for the other.
    marketCapUsd: toDecimalString(pair.marketCap),
    fdvUsd: toDecimalString(pair.fdv),
    liquidityUsd: toDecimalString(pair.liquidity?.usd),
    volumeUsd,
    txns,
    priceChangePct,
    pairCreatedAt: toMs(pair.pairCreatedAt),
    observedAt: null, // DexScreener exposes no per-response observation time
  };
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

export function createDexscreenerProvider(
  options: DexscreenerProviderOptions = {},
): MarketDataProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl ?? 'https://api.dexscreener.com';
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxRetries = options.maxRetries ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 750;

  async function fetchBatch(mints: string[]): Promise<unknown> {
    const url = `${baseUrl}/tokens/v1/solana/${mints.join(',')}`;
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
        throw new MarketProviderError(
          isTimeout ? 'timeout' : 'network_error',
          isTimeout
            ? 'market data provider timed out'
            : 'network error contacting market data provider',
          true,
        );
      }

      if (res.status === 429) {
        if (attempt < maxRetries) {
          await sleep(retryAfterMs(res) ?? retryDelayMs * (attempt + 1));
          continue;
        }
        throw new MarketProviderError(
          'rate_limited',
          'market data provider rate limit reached',
          true,
        );
      }
      if (res.status >= 500) {
        if (attempt < maxRetries) {
          await sleep(retryDelayMs * (attempt + 1));
          continue;
        }
        throw new MarketProviderError('provider_error', 'market data provider error', true);
      }
      // Permanent client errors are NOT retried.
      if (!res.ok) {
        throw new MarketProviderError(
          'bad_request',
          `market data provider rejected the request (status ${res.status})`,
          false,
        );
      }

      try {
        return await res.json();
      } catch {
        throw new MarketProviderError(
          'malformed_response',
          'market data provider returned an unreadable response',
          false,
        );
      }
    }
  }

  async function lookupTokens(mints: string[]): Promise<MarketLookupResult> {
    const unique = [...new Set(mints)];
    const candidatesByMint = new Map<string, MarketPairCandidate[]>();
    for (const mint of unique) candidatesByMint.set(mint, []);

    for (let i = 0; i < unique.length; i += MAX_MINTS_PER_CALL) {
      const batch = unique.slice(i, i + MAX_MINTS_PER_CALL);
      const data = await fetchBatch(batch);
      if (!Array.isArray(data)) {
        throw new MarketProviderError(
          'malformed_response',
          'market data provider returned an unexpected shape',
          false,
        );
      }
      const requested = new Set(batch);
      for (const raw of data) {
        const candidate = mapRawDexscreenerPair(raw);
        if (!candidate) continue;
        // Attribute the pair to whichever requested mint(s) it contains —
        // the token may appear as base or as quote.
        for (const mint of [candidate.baseMint, candidate.quoteMint]) {
          if (mint && requested.has(mint)) {
            candidatesByMint.get(mint)!.push(candidate);
          }
        }
      }
    }

    return { provider: 'dexscreener', fetchedAt: Date.now(), candidatesByMint };
  }

  return {
    name: 'dexscreener',
    // DexScreener's documented public API requires no credential.
    isConfigured: () => true,
    lookupTokens,
  };
}
