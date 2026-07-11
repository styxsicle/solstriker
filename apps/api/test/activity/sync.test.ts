import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { syntheticAddress } from '@memecoin-lab/shared';
import type { PrismaClient } from '@prisma/client';
import { releaseSyncLock, tryAcquireSyncLock } from '../../src/services/activity/syncLock.js';
import { buildTestApp, resetDb, type TestApp } from '../helpers.js';
import { FakeProvider, nextSignature, swapBuyTx, swapSellTx, solOnlyTx } from './fixtures.js';
import type { SolanaTransaction } from '../../src/providers/solana/types.js';

const WALLET_ADDR = syntheticAddress(80);
const MEME_A = syntheticAddress(81);
const MEME_B = syntheticAddress(82);

async function createWallet(prisma: PrismaClient, address = WALLET_ADDR, enabled = true) {
  return prisma.trackedWallet.create({
    data: { address, label: 'test wallet', enabled, source: 'manual' },
  });
}

/** Newest-first history: alternating buys/sells with descending timestamps. */
function makeHistory(wallet: string, count: number): SolanaTransaction[] {
  return Array.from({ length: count }, (_, i) => {
    const opts = { signature: nextSignature('hist'), timestamp: 1_750_100_000 - i * 60 };
    return i % 2 === 0
      ? swapBuyTx(wallet, MEME_A, { ...opts, tokenAmount: 1000 + i, solAmount: 0.5 })
      : swapSellTx(wallet, MEME_B, { ...opts, tokenAmount: 2000 + i, solAmount: 0.8 });
  });
}

describe('POST /api/activity/sync', () => {
  const apps: TestApp[] = [];

  async function makeApp(provider?: FakeProvider) {
    const ctx = await buildTestApp({ activityProvider: provider });
    apps.push(ctx);
    return ctx;
  }

  beforeEach(async () => {
    const ctx = await buildTestApp();
    await resetDb(ctx.prisma);
    await ctx.app.close();
  });

  afterAll(async () => {
    for (const ctx of apps) await ctx.app.close();
  });

  it('returns 503 when no activity provider is configured', async () => {
    const ctx = await makeApp(); // default: unconfigured helius provider
    const wallet = await createWallet(ctx.prisma);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/activity/sync',
      payload: { walletIds: [wallet.id] },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('provider_not_configured');
  });

  it('rejects more than 10 wallets per request', async () => {
    const ctx = await makeApp(new FakeProvider({}));
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/activity/sync',
      payload: { walletIds: Array.from({ length: 11 }, (_, i) => `id-${i}`) },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('validation_error');
  });

  it('rejects unknown and disabled wallets', async () => {
    const ctx = await makeApp(new FakeProvider({}));
    const unknown = await ctx.app.inject({
      method: 'POST',
      url: '/api/activity/sync',
      payload: { walletIds: ['nope'] },
    });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json()).toMatchObject({ error: 'unknown_wallet', walletIds: ['nope'] });

    const disabled = await createWallet(ctx.prisma, syntheticAddress(83), false);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/activity/sync',
      payload: { walletIds: [disabled.id] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'wallet_disabled', walletIds: [disabled.id] });
  });

  it('backfills history, creating events, tokens, and sync state', async () => {
    const provider = new FakeProvider({
      [WALLET_ADDR]: [
        ...makeHistory(WALLET_ADDR, 5),
        solOnlyTx(WALLET_ADDR, { signature: nextSignature('noise') }),
      ],
    });
    const ctx = await makeApp(provider);
    const wallet = await createWallet(ctx.prisma);

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/activity/sync',
      payload: { walletIds: [wallet.id], maxTransactions: 100 },
    });
    expect(res.statusCode).toBe(200);
    const [result] = res.json().results;
    expect(result).toMatchObject({
      walletId: wallet.id,
      status: 'ok',
      transactionsProcessed: 6,
      eventsCreated: 5, // SOL-only tx yields no event
      duplicateEvents: 0,
      tokensDiscovered: 2,
      backfillComplete: true,
    });

    expect(await ctx.prisma.walletEvent.count()).toBe(5);
    const tokens = await ctx.prisma.token.findMany({ where: { source: 'activity' } });
    expect(tokens.map((t) => t.mintAddress).sort()).toEqual([MEME_A, MEME_B].sort());

    const status = await ctx.app.inject({ method: 'GET', url: '/api/activity/status' });
    const item = status.json().items[0];
    expect(item).toMatchObject({
      walletId: wallet.id,
      status: 'idle',
      backfillComplete: true,
      totalTransactions: 6,
      totalEvents: 5,
      lastError: null,
    });
  });

  it('caps per request and resumes backfill from the stored cursor', async () => {
    const history = makeHistory(WALLET_ADDR, 25);
    const provider = new FakeProvider({ [WALLET_ADDR]: history });
    const ctx = await makeApp(provider);
    const wallet = await createWallet(ctx.prisma);

    const first = await ctx.app.inject({
      method: 'POST',
      url: '/api/activity/sync',
      payload: { walletIds: [wallet.id], maxTransactions: 10 },
    });
    expect(first.json().results[0]).toMatchObject({
      transactionsProcessed: 10,
      backfillComplete: false,
    });

    const state = await ctx.prisma.walletSyncState.findUnique({ where: { walletId: wallet.id } });
    expect(state?.oldestSignature).toBe(history[9].signature);
    expect(state?.newestSignature).toBe(history[0].signature);

    const second = await ctx.app.inject({
      method: 'POST',
      url: '/api/activity/sync',
      payload: { walletIds: [wallet.id], maxTransactions: 10 },
    });
    expect(second.json().results[0]).toMatchObject({
      transactionsProcessed: 10,
      backfillComplete: false,
    });
    // Resumed strictly after the cursor: no overlap, no duplicates.
    expect(second.json().results[0].duplicateEvents).toBe(0);

    const third = await ctx.app.inject({
      method: 'POST',
      url: '/api/activity/sync',
      payload: { walletIds: [wallet.id], maxTransactions: 10 },
    });
    expect(third.json().results[0]).toMatchObject({
      transactionsProcessed: 5,
      backfillComplete: true,
    });

    expect(await ctx.prisma.walletEvent.count()).toBe(25);
  });

  it('after backfill, incremental sync ingests only new transactions', async () => {
    const provider = new FakeProvider({ [WALLET_ADDR]: makeHistory(WALLET_ADDR, 8) });
    const ctx = await makeApp(provider);
    const wallet = await createWallet(ctx.prisma);

    await ctx.app.inject({
      method: 'POST',
      url: '/api/activity/sync',
      payload: { walletIds: [wallet.id], maxTransactions: 100 },
    });

    // No new activity: nothing processed.
    const idle = await ctx.app.inject({
      method: 'POST',
      url: '/api/activity/sync',
      payload: { walletIds: [wallet.id], maxTransactions: 100 },
    });
    expect(idle.json().results[0]).toMatchObject({
      transactionsProcessed: 0,
      eventsCreated: 0,
      backfillComplete: true,
    });

    // Two new transactions appear at the tip.
    provider.addNewest(WALLET_ADDR, [
      swapBuyTx(WALLET_ADDR, MEME_A, {
        signature: nextSignature('new'),
        timestamp: 1_750_200_000,
      }),
      swapSellTx(WALLET_ADDR, MEME_A, {
        signature: nextSignature('new'),
        timestamp: 1_750_199_000,
      }),
    ]);

    const incremental = await ctx.app.inject({
      method: 'POST',
      url: '/api/activity/sync',
      payload: { walletIds: [wallet.id], maxTransactions: 100 },
    });
    expect(incremental.json().results[0]).toMatchObject({
      transactionsProcessed: 2,
      eventsCreated: 2,
      duplicateEvents: 0,
    });
    expect(await ctx.prisma.walletEvent.count()).toBe(10);
  });

  it('re-processing the same range is idempotent (duplicates, no new rows)', async () => {
    const provider = new FakeProvider({ [WALLET_ADDR]: makeHistory(WALLET_ADDR, 6) });
    const ctx = await makeApp(provider);
    const wallet = await createWallet(ctx.prisma);

    await ctx.app.inject({
      method: 'POST',
      url: '/api/activity/sync',
      payload: { walletIds: [wallet.id], maxTransactions: 100 },
    });
    expect(await ctx.prisma.walletEvent.count()).toBe(6);

    // Force a full re-scan of history by resetting the cursors.
    await ctx.prisma.walletSyncState.update({
      where: { walletId: wallet.id },
      data: { backfillComplete: false, oldestSignature: null, newestSignature: null },
    });
    const rescan = await ctx.app.inject({
      method: 'POST',
      url: '/api/activity/sync',
      payload: { walletIds: [wallet.id], maxTransactions: 100 },
    });
    expect(rescan.json().results[0]).toMatchObject({
      transactionsProcessed: 6,
      eventsCreated: 0,
      duplicateEvents: 6,
    });
    expect(await ctx.prisma.walletEvent.count()).toBe(6);
  });

  it('reports locked when a sync is already running for the wallet', async () => {
    const provider = new FakeProvider({ [WALLET_ADDR]: makeHistory(WALLET_ADDR, 2) });
    const ctx = await makeApp(provider);
    const wallet = await createWallet(ctx.prisma);

    expect(tryAcquireSyncLock(wallet.id)).toBe(true);
    try {
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/api/activity/sync',
        payload: { walletIds: [wallet.id] },
      });
      expect(res.json().results[0]).toMatchObject({ status: 'locked', error: 'sync_in_progress' });
      expect(await ctx.prisma.walletEvent.count()).toBe(0);
    } finally {
      releaseSyncLock(wallet.id);
    }
  });

  it('records sanitized error codes when the provider fails', async () => {
    const failing = new FakeProvider({});
    failing.getWalletTransactions = async () => {
      const { ProviderError } = await import('../../src/providers/solana/types.js');
      throw new ProviderError('rate_limited', 'rate limited by activity provider');
    };
    const ctx = await makeApp(failing);
    const wallet = await createWallet(ctx.prisma);

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/activity/sync',
      payload: { walletIds: [wallet.id] },
    });
    expect(res.json().results[0]).toMatchObject({ status: 'error', error: 'rate_limited' });

    const state = await ctx.prisma.walletSyncState.findUnique({ where: { walletId: wallet.id } });
    expect(state).toMatchObject({ status: 'error', lastError: 'rate_limited' });
  });
});
