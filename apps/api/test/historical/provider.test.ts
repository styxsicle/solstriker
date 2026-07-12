import { describe, expect, it } from 'vitest';
import { createGeckoterminalProvider } from '../../src/providers/historicalMarket/geckoterminalProvider.js';
import { createHistoricalMarketProvider } from '../../src/providers/historicalMarket/providerFactory.js';
import { HistoricalProviderError } from '../../src/providers/historicalMarket/errors.js';
import { PAIR_A, rawGeckoResponse } from './fixtures.js';

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

const params = {
  chainId: 'solana',
  pairAddress: PAIR_A,
  interval: '1m' as const,
  startSec: 1_783_000_000,
  endSec: 1_783_000_600,
};

describe('GeckoTerminal provider mapping', () => {
  it('maps [ts,o,h,l,c,v] rows to exact decimal strings within the range', async () => {
    const provider = createGeckoterminalProvider({
      fetchImpl: async (input) => {
        expect(String(input)).toContain(`/networks/solana/pools/${PAIR_A}/ohlcv/minute`);
        expect(String(input)).toContain('aggregate=1');
        return jsonResponse(
          rawGeckoResponse([
            [1_783_000_300, '0.000004089', '0.0000042', '0.0000040', '0.0000041', 123.45],
            [1_783_000_240, '0.000004000', '0.0000041', '0.0000039', '0.000004089', 50],
          ]),
        );
      },
    });
    const result = await provider.fetchCandles(params);
    expect(result.candles).toHaveLength(2);
    const c = result.candles.find((x) => x.openTimeSec === 1_783_000_300)!;
    expect(c.open).toBe('0.000004089'); // exact string preserved
    expect(c.high).toBe('0.0000042');
    expect(c.volumeUsd).toBe('123.45');
  });

  it('drops malformed rows and treats negative/invalid volume as null', async () => {
    const provider = createGeckoterminalProvider({
      fetchImpl: async () =>
        jsonResponse(
          rawGeckoResponse([
            [1_783_000_300, '0.01', '0.02', '0.005', '0.015', -5], // negative vol → null
            [1_783_000_240, 'abc', '1', '1', '1', 10], // malformed open → dropped
            ['nope', '1', '1', '1', '1', 1], // malformed ts → dropped
            [1_783_000_180, '1', '2', '0.5', '1.5'], // missing vol → null
          ]),
        ),
    });
    const result = await provider.fetchCandles({ ...params, startSec: 1_783_000_100 });
    expect(result.candles).toHaveLength(2);
    expect(result.candles.find((c) => c.openTimeSec === 1_783_000_300)!.volumeUsd).toBeNull();
    expect(result.candles.find((c) => c.openTimeSec === 1_783_000_180)!.volumeUsd).toBeNull();
  });

  it('returns empty candles for an empty ohlcv_list', async () => {
    const provider = createGeckoterminalProvider({
      fetchImpl: async () => jsonResponse(rawGeckoResponse([])),
    });
    expect((await provider.fetchCandles(params)).candles).toEqual([]);
  });

  it('throws malformed_response for an unexpected shape', async () => {
    const provider = createGeckoterminalProvider({
      fetchImpl: async () => jsonResponse({ data: { attributes: {} } }),
    });
    await expect(provider.fetchCandles(params)).rejects.toMatchObject({ code: 'malformed_response' });
  });

  it('maps 404 to a non-retryable not_found', async () => {
    const provider = createGeckoterminalProvider({
      maxRetries: 2,
      retryDelayMs: 1,
      fetchImpl: async () => jsonResponse({}, 404),
    });
    const err = await provider.fetchCandles(params).catch((e) => e);
    expect(err.code).toBe('not_found');
    expect(err.retryable).toBe(false);
  });

  it('retries 429 then succeeds, honoring Retry-After timing bounds', async () => {
    let attempts = 0;
    const provider = createGeckoterminalProvider({
      retryDelayMs: 1,
      fetchImpl: async () => {
        attempts += 1;
        return attempts < 3 ? jsonResponse({}, 429) : jsonResponse(rawGeckoResponse([]));
      },
    });
    await provider.fetchCandles(params);
    expect(attempts).toBe(3);
  });

  it('retries 500 then fails with retryable provider_error', async () => {
    let attempts = 0;
    const provider = createGeckoterminalProvider({
      maxRetries: 2,
      retryDelayMs: 1,
      fetchImpl: async () => {
        attempts += 1;
        return jsonResponse({}, 500);
      },
    });
    await expect(provider.fetchCandles(params)).rejects.toMatchObject({ code: 'provider_error' });
    expect(attempts).toBe(3);
  });

  it('does not retry a permanent 400', async () => {
    let attempts = 0;
    const provider = createGeckoterminalProvider({
      maxRetries: 3,
      retryDelayMs: 1,
      fetchImpl: async () => {
        attempts += 1;
        return jsonResponse({}, 400);
      },
    });
    const err = await provider.fetchCandles(params).catch((e) => e);
    expect(err.code).toBe('bad_request');
    expect(attempts).toBe(1);
  });

  it('maps timeouts to a retryable timeout error and never leaks the URL', async () => {
    const provider = createGeckoterminalProvider({
      maxRetries: 0,
      retryDelayMs: 1,
      fetchImpl: async () => {
        const e = new Error(`timeout https://api.geckoterminal.com/secret/${PAIR_A}`);
        e.name = 'TimeoutError';
        throw e;
      },
    });
    const err = await provider.fetchCandles(params).catch((e) => e);
    expect(err.code).toBe('timeout');
    expect(String(err.message)).not.toContain('geckoterminal.com');
    expect(String(err.message)).not.toContain(PAIR_A);
  });
});

describe('historical provider factory', () => {
  it('returns a configured GeckoTerminal provider by default', () => {
    expect(createHistoricalMarketProvider(undefined).name).toBe('geckoterminal');
    expect(createHistoricalMarketProvider('geckoterminal').isConfigured()).toBe(true);
  });

  it('returns an unconfigured provider for "none" that never fetches', async () => {
    const provider = createHistoricalMarketProvider('none');
    expect(provider.isConfigured()).toBe(false);
    await expect(
      provider.fetchCandles(params),
    ).rejects.toBeInstanceOf(HistoricalProviderError);
  });
});
