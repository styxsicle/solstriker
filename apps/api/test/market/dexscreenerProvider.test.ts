import { describe, expect, it } from 'vitest';
import {
  createDexscreenerProvider,
  mapRawDexscreenerPair,
} from '../../src/providers/market/dexscreenerProvider.js';
import { createMarketDataProvider } from '../../src/providers/market/providerFactory.js';
import { MarketProviderError } from '../../src/providers/market/errors.js';
import { MEME_MINT, MEME_MINT_2, rawDexPair } from './fixtures.js';

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('mapRawDexscreenerPair', () => {
  it('preserves exact decimal strings and separates marketCap from fdv', () => {
    const pair = mapRawDexscreenerPair(rawDexPair());
    expect(pair).not.toBeNull();
    expect(pair!.priceUsd).toBe('0.000004089');
    expect(pair!.priceNative).toBe('0.00000005243');
    expect(pair!.marketCapUsd).toBe('363418575');
    expect(pair!.fdvUsd).toBe('400000000');
    expect(pair!.liquidityUsd).toBe('122349.87');
    expect(pair!.volumeUsd.h24).toBe('260503.7');
    expect(pair!.txns.h24).toEqual({ buys: 3322, sells: 5608 });
    expect(pair!.priceChangePct.h1).toBe('-0.37');
    expect(pair!.pairCreatedAt).toBe(1671980424000);
    expect(pair!.observedAt).toBeNull();
  });

  it('drops pairs missing chainId, pairAddress, or base mint', () => {
    expect(mapRawDexscreenerPair(rawDexPair({ chainId: undefined }))).toBeNull();
    expect(mapRawDexscreenerPair(rawDexPair({ pairAddress: '' }))).toBeNull();
    expect(mapRawDexscreenerPair(rawDexPair({ baseToken: { address: '' } }))).toBeNull();
    expect(mapRawDexscreenerPair(null)).toBeNull();
    expect(mapRawDexscreenerPair('not an object')).toBeNull();
  });

  it('coerces malformed numeric fields to null instead of NaN or zero', () => {
    const pair = mapRawDexscreenerPair(
      rawDexPair({
        priceUsd: 'not-a-number',
        liquidity: { usd: null },
        marketCap: undefined,
        fdv: 'abc',
        volume: { h24: 'xyz', h6: null, h1: 5, m5: undefined },
        txns: { h24: { buys: -3, sells: 1.5 }, h1: { buys: null, sells: 2 } },
      }),
    );
    expect(pair!.priceUsd).toBeNull();
    expect(pair!.liquidityUsd).toBeNull();
    expect(pair!.marketCapUsd).toBeNull();
    expect(pair!.fdvUsd).toBeNull();
    expect(pair!.volumeUsd.h24).toBeNull();
    expect(pair!.volumeUsd.h1).toBe('5');
    expect(pair!.txns.h24.buys).toBeNull(); // negative rejected
    expect(pair!.txns.h24.sells).toBeNull(); // non-integer rejected
    expect(pair!.txns.h1.buys).toBeNull();
    expect(pair!.txns.h1.sells).toBe(2);
  });
});

describe('createDexscreenerProvider — request behavior', () => {
  it('is configured (public endpoint needs no key) and maps a batch response', async () => {
    let seenUrl = '';
    const provider = createDexscreenerProvider({
      fetchImpl: async (input) => {
        seenUrl = String(input);
        return jsonResponse([rawDexPair()]);
      },
    });
    expect(provider.isConfigured()).toBe(true);
    const result = await provider.lookupTokens([MEME_MINT]);
    expect(seenUrl).toContain('/tokens/v1/solana/');
    expect(seenUrl).toContain(MEME_MINT);
    expect(result.candidatesByMint.get(MEME_MINT)).toHaveLength(1);
  });

  it('attributes a pair to a requested mint appearing as the quote token', async () => {
    const provider = createDexscreenerProvider({
      fetchImpl: async () =>
        jsonResponse([
          rawDexPair({
            baseToken: { address: MEME_MINT_2, name: 'Other', symbol: 'OTH' },
            quoteToken: { address: MEME_MINT, name: 'Meme', symbol: 'MEME' },
          }),
        ]),
    });
    const result = await provider.lookupTokens([MEME_MINT]);
    expect(result.candidatesByMint.get(MEME_MINT)).toHaveLength(1);
  });

  it('returns an empty candidate list for a mint with no pairs (not found)', async () => {
    const provider = createDexscreenerProvider({ fetchImpl: async () => jsonResponse([]) });
    const result = await provider.lookupTokens([MEME_MINT]);
    expect(result.candidatesByMint.get(MEME_MINT)).toEqual([]);
  });

  it('throws malformed_response for non-array JSON', async () => {
    const provider = createDexscreenerProvider({
      fetchImpl: async () => jsonResponse({ unexpected: true }),
    });
    await expect(provider.lookupTokens([MEME_MINT])).rejects.toMatchObject({
      code: 'malformed_response',
    });
  });

  it('throws malformed_response for invalid JSON body', async () => {
    const provider = createDexscreenerProvider({
      fetchImpl: async () =>
        new Response('<<not json>>', { status: 200, headers: { 'content-type': 'text/html' } }),
    });
    await expect(provider.lookupTokens([MEME_MINT])).rejects.toMatchObject({
      code: 'malformed_response',
    });
  });

  it('retries HTTP 429 and eventually succeeds', async () => {
    let attempts = 0;
    const provider = createDexscreenerProvider({
      retryDelayMs: 1,
      fetchImpl: async () => {
        attempts += 1;
        return attempts < 3 ? jsonResponse({}, 429) : jsonResponse([rawDexPair()]);
      },
    });
    const result = await provider.lookupTokens([MEME_MINT]);
    expect(attempts).toBe(3);
    expect(result.candidatesByMint.get(MEME_MINT)).toHaveLength(1);
  });

  it('respects Retry-After on 429 before retrying', async () => {
    const delays: number[] = [];
    let attempts = 0;
    const realSetTimeout = globalThis.setTimeout;
    // Capture requested delays without actually waiting.
    (globalThis as { setTimeout: typeof setTimeout }).setTimeout = ((
      fn: () => void,
      ms?: number,
    ) => {
      delays.push(ms ?? 0);
      return realSetTimeout(fn, 0);
    }) as typeof setTimeout;
    try {
      const provider = createDexscreenerProvider({
        retryDelayMs: 5000,
        fetchImpl: async () => {
          attempts += 1;
          return attempts < 2
            ? jsonResponse({}, 429, { 'retry-after': '2' })
            : jsonResponse([rawDexPair()]);
        },
      });
      await provider.lookupTokens([MEME_MINT]);
    } finally {
      (globalThis as { setTimeout: typeof setTimeout }).setTimeout = realSetTimeout;
    }
    expect(delays[0]).toBe(2000); // Retry-After (2s) used, not the 5s default
  });

  it('gives up on persistent 429 with a retryable rate_limited error', async () => {
    const provider = createDexscreenerProvider({
      maxRetries: 2,
      retryDelayMs: 1,
      fetchImpl: async () => jsonResponse({}, 429),
    });
    const error = await provider.lookupTokens([MEME_MINT]).catch((e) => e);
    expect(error).toBeInstanceOf(MarketProviderError);
    expect(error.code).toBe('rate_limited');
    expect(error.retryable).toBe(true);
  });

  it('retries HTTP 500 then fails with a provider_error', async () => {
    let attempts = 0;
    const provider = createDexscreenerProvider({
      maxRetries: 2,
      retryDelayMs: 1,
      fetchImpl: async () => {
        attempts += 1;
        return jsonResponse({}, 500);
      },
    });
    await expect(provider.lookupTokens([MEME_MINT])).rejects.toMatchObject({
      code: 'provider_error',
    });
    expect(attempts).toBe(3); // 1 initial + 2 retries
  });

  it('does NOT retry a permanent HTTP 400', async () => {
    let attempts = 0;
    const provider = createDexscreenerProvider({
      maxRetries: 3,
      retryDelayMs: 1,
      fetchImpl: async () => {
        attempts += 1;
        return jsonResponse({}, 400);
      },
    });
    const error = await provider.lookupTokens([MEME_MINT]).catch((e) => e);
    expect(error.code).toBe('bad_request');
    expect(error.retryable).toBe(false);
    expect(attempts).toBe(1); // no retries for permanent client errors
  });

  it('maps AbortError/timeouts to a retryable timeout error', async () => {
    const provider = createDexscreenerProvider({
      maxRetries: 1,
      retryDelayMs: 1,
      fetchImpl: async () => {
        const err = new Error('timed out');
        err.name = 'TimeoutError';
        throw err;
      },
    });
    const error = await provider.lookupTokens([MEME_MINT]).catch((e) => e);
    expect(error.code).toBe('timeout');
    expect(error.retryable).toBe(true);
  });

  it('maps generic network failures to a retryable network_error', async () => {
    const provider = createDexscreenerProvider({
      maxRetries: 1,
      retryDelayMs: 1,
      fetchImpl: async () => {
        throw new Error('ECONNRESET');
      },
    });
    await expect(provider.lookupTokens([MEME_MINT])).rejects.toMatchObject({
      code: 'network_error',
    });
  });

  it('never includes the request URL in the thrown error message', async () => {
    const provider = createDexscreenerProvider({
      maxRetries: 0,
      retryDelayMs: 1,
      fetchImpl: async () => {
        throw new Error('connect failed https://api.dexscreener.com/tokens/v1/solana/secret');
      },
    });
    const error = await provider.lookupTokens([MEME_MINT]).catch((e) => e);
    expect(String(error.message)).not.toContain('dexscreener.com');
    expect(String(error.message)).not.toContain(MEME_MINT);
  });
});

describe('createMarketDataProvider factory', () => {
  it('returns a configured DexScreener provider by default', () => {
    expect(createMarketDataProvider(undefined).name).toBe('dexscreener');
    expect(createMarketDataProvider('dexscreener').isConfigured()).toBe(true);
    expect(createMarketDataProvider('DexScreener').name).toBe('dexscreener');
  });

  it('returns an unconfigured provider for "none" that never fetches', async () => {
    const provider = createMarketDataProvider('none');
    expect(provider.isConfigured()).toBe(false);
    await expect(provider.lookupTokens([MEME_MINT])).rejects.toMatchObject({
      code: 'not_configured',
    });
  });

  it('returns an unconfigured provider for unknown names', () => {
    expect(createMarketDataProvider('some-future-provider').isConfigured()).toBe(false);
  });
});
