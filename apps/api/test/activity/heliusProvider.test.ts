import { describe, expect, it } from 'vitest';
import { syntheticAddress } from '@memecoin-lab/shared';
import { createHeliusProvider } from '../../src/providers/solana/heliusProvider.js';
import { ProviderError } from '../../src/providers/solana/types.js';

const FAKE_KEY = 'FAKE-ACTIVITY-KEY-0000';
const ADDRESS = syntheticAddress(70);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('heliusProvider', () => {
  it('reports unconfigured and throws not_configured without touching the network', async () => {
    let called = false;
    const provider = createHeliusProvider({
      apiKey: undefined,
      cluster: 'mainnet-beta',
      fetchImpl: async () => {
        called = true;
        return jsonResponse([]);
      },
    });
    expect(provider.isConfigured()).toBe(false);
    await expect(provider.getWalletTransactions(ADDRESS)).rejects.toMatchObject({
      code: 'not_configured',
    });
    expect(called).toBe(false);
  });

  it('requests the address endpoint with before/limit and maps the response', async () => {
    const seen: string[] = [];
    const provider = createHeliusProvider({
      apiKey: FAKE_KEY,
      cluster: 'mainnet-beta',
      fetchImpl: async (input) => {
        seen.push(String(input));
        return jsonResponse([
          {
            signature: 'sig-1',
            slot: 42,
            timestamp: 1_750_000_000,
            type: 'SWAP',
            source: 'JUPITER',
            transactionError: null,
            tokenTransfers: [
              { mint: 'MintA', fromUserAccount: 'X', toUserAccount: 'Y', tokenAmount: 12.5 },
              { mint: '', fromUserAccount: 'X', toUserAccount: 'Y', tokenAmount: 1 }, // dropped
            ],
            nativeTransfers: [{ fromUserAccount: 'X', toUserAccount: 'Y', amount: 1000 }],
          },
          { signature: 'sig-2', transactionError: { err: 'failed' } },
          { notASignature: true }, // dropped
        ]);
      },
    });

    const txs = await provider.getWalletTransactions(ADDRESS, { before: 'cursor-sig', limit: 50 });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain(`/v0/addresses/${ADDRESS}/transactions`);
    expect(seen[0]).toContain('before=cursor-sig');
    expect(seen[0]).toContain('limit=50');

    expect(txs).toHaveLength(2);
    expect(txs[0]).toMatchObject({
      signature: 'sig-1',
      slot: 42,
      timestamp: 1_750_000_000,
      type: 'SWAP',
      source: 'JUPITER',
      failed: false,
    });
    expect(txs[0].tokenTransfers).toEqual([
      { mint: 'MintA', fromUserAccount: 'X', toUserAccount: 'Y', tokenAmount: 12.5 },
    ]);
    expect(txs[0].nativeTransfers).toEqual([
      { fromUserAccount: 'X', toUserAccount: 'Y', lamports: 1000 },
    ]);
    expect(txs[1]).toMatchObject({ signature: 'sig-2', failed: true });
  });

  it('retries rate limits and eventually succeeds', async () => {
    let attempts = 0;
    const provider = createHeliusProvider({
      apiKey: FAKE_KEY,
      cluster: 'mainnet-beta',
      retryDelayMs: 1,
      fetchImpl: async () => {
        attempts += 1;
        return attempts < 3 ? jsonResponse({}, 429) : jsonResponse([]);
      },
    });
    await expect(provider.getWalletTransactions(ADDRESS)).resolves.toEqual([]);
    expect(attempts).toBe(3);
  });

  it('throws sanitized ProviderErrors that never contain the API key', async () => {
    const provider = createHeliusProvider({
      apiKey: FAKE_KEY,
      cluster: 'mainnet-beta',
      maxRetries: 1,
      retryDelayMs: 1,
      fetchImpl: async () => {
        throw new Error(`connect ETIMEDOUT https://api.helius.xyz/?api-key=${FAKE_KEY}`);
      },
    });
    const error = await provider.getWalletTransactions(ADDRESS).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    const message = String((error as Error).message) + String((error as Error).stack ?? '');
    expect(message).not.toContain(FAKE_KEY);
    expect(message.toLowerCase()).not.toContain('helius.xyz');
    expect((error as ProviderError).code).toBe('provider_error');
  });

  it('gives up after retries on persistent 429s with a rate_limited code', async () => {
    const provider = createHeliusProvider({
      apiKey: FAKE_KEY,
      cluster: 'mainnet-beta',
      maxRetries: 2,
      retryDelayMs: 1,
      fetchImpl: async () => jsonResponse({}, 429),
    });
    await expect(provider.getWalletTransactions(ADDRESS)).rejects.toMatchObject({
      code: 'rate_limited',
    });
  });
});
