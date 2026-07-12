/**
 * One-click Focus Wallet Preparation — orchestrates existing sync,
 * reconstruction, quality-analysis and strategy-fingerprint services in
 * order. All wallets and transactions are synthetic; the activity provider is
 * always the in-memory FakeProvider — no real network call is ever made.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { syntheticAddress } from '@memecoin-lab/shared';
import type { PrismaClient } from '@prisma/client';
import { buildTestApp, resetDb, type TestApp } from '../helpers.js';
import { FakeProvider, nextSignature, swapBuyTx, swapSellTx } from '../activity/fixtures.js';
import type { SolanaTransaction } from '../../src/providers/solana/types.js';
import { releasePrepareLock, tryAcquirePrepareLock } from '../../src/services/focusWallets/prepareLock.js';
import {
  releaseReconstructionLock,
  tryAcquireReconstructionLock,
} from '../../src/services/walletPositions/reconstructWallets.js';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await buildTestApp({ activityProvider: new FakeProvider({}), syncOptions: { pauseMs: 0 } });
  await resetDb(ctx.prisma);
});

async function createWallet(prisma: PrismaClient, seed: number, opts: Partial<{ label: string; source: string }> = {}) {
  return prisma.trackedWallet.create({
    data: { address: syntheticAddress(seed), label: opts.label ?? null, source: opts.source ?? 'activity' },
  });
}

/** One clean buy-then-sell cycle, newest-first (matches provider paging convention). */
function oneCycleHistory(wallet: string, mint: string): SolanaTransaction[] {
  return [
    swapSellTx(wallet, mint, { signature: nextSignature('sell'), timestamp: 1_750_100_600, solAmount: 0.3, tokenAmount: 100 }),
    swapBuyTx(wallet, mint, { signature: nextSignature('buy'), timestamp: 1_750_100_000, solAmount: 0.2, tokenAmount: 100 }),
  ];
}

const prepare = (payload: unknown) =>
  ctx.app.inject({ method: 'POST', url: '/api/focus-wallets/prepare', payload });

describe('one-click focus wallet preparation — pipeline order', () => {
  it('runs sync → reconstruction → quality → fingerprint in order for one wallet with real evidence', async () => {
    const wallet = await createWallet(ctx.prisma, 50_001, { label: 'bn trezor' });
    const mint = syntheticAddress(50_002);
    const fake = new FakeProvider({ [wallet.address]: oneCycleHistory(wallet.address, mint) });
    ctx = await buildTestApp({ activityProvider: fake, syncOptions: { pauseMs: 0 } });

    const response = await prepare({ walletIds: [wallet.id] });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.requestedWallets).toBe(1);
    expect(body.processedWallets).toBe(1);
    expect(body.failures).toBe(0);

    const result = body.results[0];
    expect(result.walletId).toBe(wallet.id);
    expect(result.label).toBe('bn trezor');
    expect(result.storedEventCountBefore).toBe(0);
    expect(result.storedEventCountAfter).toBeGreaterThan(0);

    // Stage order: sync must complete before reconstruction, which must
    // complete before quality and fingerprint (both depend only on reconstruction).
    expect(result.sync.status).toBe('COMPLETED');
    expect(result.sync.eventsCreated).toBeGreaterThan(0);
    expect(result.reconstruction.status).toBe('COMPLETED');
    expect(result.reconstruction.reconstructionRunId).toBeTruthy();
    expect(result.reconstruction.positionsCreated).toBeGreaterThan(0);
    expect(result.quality.status).toBe('COMPLETED');
    expect(result.quality.qualityMetricSetId).toBeTruthy();
    expect(result.fingerprint.status).toBe('COMPLETED');
    expect(result.fingerprint.fingerprintId).toBeTruthy();
    expect(result.fingerprint.eligibleCycleCount).toBe(1);
    expect(result.sanitizedError).toBeNull();

    // The underlying records were genuinely created by the reused services.
    expect(await ctx.prisma.walletPositionReconstructionRun.count()).toBe(1);
    expect(await ctx.prisma.walletQualityAnalysisRun.count()).toBe(1);
    expect(await ctx.prisma.walletStrategyFingerprintRun.count()).toBe(1);
  });

  it('processes multiple wallets sequentially, preserving request order', async () => {
    const a = await createWallet(ctx.prisma, 50_101, { label: 'bn trezor' });
    const b = await createWallet(ctx.prisma, 50_102, { label: 'bn new' });
    const mintA = syntheticAddress(50_103);
    const mintB = syntheticAddress(50_104);
    const fake = new FakeProvider({
      [a.address]: oneCycleHistory(a.address, mintA),
      [b.address]: oneCycleHistory(b.address, mintB),
    });
    ctx = await buildTestApp({ activityProvider: fake, syncOptions: { pauseMs: 0 } });

    const body = (await prepare({ walletIds: [a.id, b.id] })).json();
    expect(body.processedWallets).toBe(2);
    expect(body.results.map((r: { walletId: string }) => r.walletId)).toEqual([a.id, b.id]);
    expect(body.results.every((r: { sync: { status: string } }) => r.sync.status === 'COMPLETED')).toBe(true);

    // Sequential, not interleaved: every call for wallet A's address precedes
    // every call for wallet B's address in the provider's call log.
    const addresses = fake.calls.map((c) => c.address);
    const lastA = addresses.lastIndexOf(a.address);
    const firstB = addresses.indexOf(b.address);
    expect(lastA).toBeLessThan(firstB);
  });

  it('rejects empty selection, more than five wallets, duplicates and development wallets', async () => {
    expect((await prepare({ walletIds: [] })).statusCode).toBe(400);
    const many = await Promise.all(
      Array.from({ length: 6 }, (_, i) => createWallet(ctx.prisma, 50_200 + i)),
    );
    expect((await prepare({ walletIds: many.map((w) => w.id) })).statusCode).toBe(400);

    const wallet = await createWallet(ctx.prisma, 50_300);
    expect((await prepare({ walletIds: [wallet.id, wallet.id] })).json().error).toBe('duplicate_selection');
    expect((await prepare({ walletIds: ['missing'] })).json().error).toBe('unknown_wallet');

    const dev = await createWallet(ctx.prisma, 50_301, { source: 'dev-seed' });
    expect((await prepare({ walletIds: [dev.id] })).json().error).toBe('dev_wallet_excluded');
  });

  it('accepts exactly five wallets', async () => {
    const wallets = await Promise.all(
      Array.from({ length: 5 }, (_, i) => createWallet(ctx.prisma, 50_400 + i)),
    );
    const response = await prepare({ walletIds: wallets.map((w) => w.id) });
    expect(response.statusCode).toBe(200);
    expect(response.json().processedWallets).toBe(5);
  });
});

describe('one-click focus wallet preparation — stage skipping', () => {
  it('skips every stage when all evidence is already current', async () => {
    const wallet = await createWallet(ctx.prisma, 50_500, { label: 'bn trezor' });
    const mint = syntheticAddress(50_501);
    const fake = new FakeProvider({ [wallet.address]: oneCycleHistory(wallet.address, mint) });
    ctx = await buildTestApp({ activityProvider: fake, syncOptions: { pauseMs: 0 } });

    const first = (await prepare({ walletIds: [wallet.id] })).json();
    expect(first.results[0].sync.status).toBe('COMPLETED');
    expect(first.results[0].reconstruction.status).toBe('COMPLETED');
    expect(first.results[0].quality.status).toBe('COMPLETED');
    expect(first.results[0].fingerprint.status).toBe('COMPLETED');

    const [runsBefore, qualityBefore, fingerprintsBefore] = await Promise.all([
      ctx.prisma.walletPositionReconstructionRun.count(),
      ctx.prisma.walletQualityAnalysisRun.count(),
      ctx.prisma.walletStrategyFingerprintRun.count(),
    ]);

    const second = (await prepare({ walletIds: [wallet.id] })).json();
    const result = second.results[0];
    expect(result.sync.status).toBe('SKIPPED');
    expect(result.sync.reason).toBe('already_current');
    expect(result.reconstruction.status).toBe('SKIPPED');
    expect(result.reconstruction.reason).toBe('reconstruction_current');
    expect(result.quality.status).toBe('SKIPPED');
    expect(result.quality.reason).toBe('quality_current');
    expect(result.fingerprint.status).toBe('SKIPPED');
    expect(result.fingerprint.reason).toBe('fingerprint_current');

    // No new audit runs were created for any stage.
    expect(await ctx.prisma.walletPositionReconstructionRun.count()).toBe(runsBefore);
    expect(await ctx.prisma.walletQualityAnalysisRun.count()).toBe(qualityBefore);
    expect(await ctx.prisma.walletStrategyFingerprintRun.count()).toBe(fingerprintsBefore);
  });

  it('re-runs every stage when forceRefresh is true, even though evidence was current', async () => {
    const wallet = await createWallet(ctx.prisma, 50_600);
    const mint = syntheticAddress(50_601);
    const fake = new FakeProvider({ [wallet.address]: oneCycleHistory(wallet.address, mint) });
    ctx = await buildTestApp({ activityProvider: fake, syncOptions: { pauseMs: 0 } });

    await prepare({ walletIds: [wallet.id] });
    const result = (await prepare({ walletIds: [wallet.id], forceRefresh: true })).json().results[0];

    expect(result.sync.status).toBe('COMPLETED'); // forceRefresh bypasses "already current"
    expect(result.reconstruction.status).toBe('COMPLETED');
    expect(result.quality.status).toBe('COMPLETED');
    expect(result.fingerprint.status).toBe('COMPLETED');
    expect(await ctx.prisma.walletPositionReconstructionRun.count()).toBe(2);
    expect(await ctx.prisma.walletQualityAnalysisRun.count()).toBe(2);
    expect(await ctx.prisma.walletStrategyFingerprintRun.count()).toBe(2);
  });

  it('re-syncs when continueHistoricalSync is set, even though backfill was already complete', async () => {
    const wallet = await createWallet(ctx.prisma, 50_700);
    const mint = syntheticAddress(50_701);
    const fake = new FakeProvider({ [wallet.address]: oneCycleHistory(wallet.address, mint) });
    ctx = await buildTestApp({ activityProvider: fake, syncOptions: { pauseMs: 0 } });

    await prepare({ walletIds: [wallet.id] });
    const result = (await prepare({ walletIds: [wallet.id], continueHistoricalSync: true })).json().results[0];
    expect(result.sync.status).toBe('COMPLETED');
    expect(result.sync.reason).toBeNull();
  });

  it('picks up new activity and reconstructs again when the user asks to continue syncing', async () => {
    const wallet = await createWallet(ctx.prisma, 50_800);
    const mint = syntheticAddress(50_801);
    const fake = new FakeProvider({ [wallet.address]: oneCycleHistory(wallet.address, mint) });
    ctx = await buildTestApp({ activityProvider: fake, syncOptions: { pauseMs: 0 } });
    await prepare({ walletIds: [wallet.id] });

    // New activity appears between prepare calls.
    fake.addNewest(wallet.address, [
      swapBuyTx(wallet.address, syntheticAddress(50_802), {
        signature: nextSignature('newbuy'),
        timestamp: 1_750_101_000,
        solAmount: 0.1,
        tokenAmount: 50,
      }),
    ]);

    // "Continue older history" is how the user tells prepare it's worth
    // checking again rather than trusting the already-current shortcut.
    const result = (await prepare({ walletIds: [wallet.id], continueHistoricalSync: true })).json().results[0];
    expect(result.sync.status).toBe('COMPLETED');
    expect(result.sync.eventsCreated).toBeGreaterThan(0);
    expect(result.reconstruction.status).toBe('COMPLETED'); // stale coverage forces a fresh run
    expect(await ctx.prisma.walletPositionReconstructionRun.count()).toBe(2);
  });
});

describe('one-click focus wallet preparation — dependency cascade', () => {
  it('never reconstructs, analyzes or fingerprints when sync fails', async () => {
    const wallet = await createWallet(ctx.prisma, 50_900);
    ctx = await buildTestApp({ activityProvider: new FakeProvider({}, false), syncOptions: { pauseMs: 0 } }); // unconfigured

    const result = (await prepare({ walletIds: [wallet.id] })).json().results[0];
    expect(result.sync.status).toBe('FAILED');
    expect(result.sync.reason).toBe('provider_not_configured');
    expect(result.reconstruction.status).toBe('NOT_STARTED');
    expect(result.reconstruction.reason).toBe('sync_failed');
    expect(result.quality.status).toBe('NOT_STARTED');
    expect(result.quality.reason).toBe('reconstruction_required');
    expect(result.fingerprint.status).toBe('NOT_STARTED');
    expect(result.fingerprint.reason).toBe('reconstruction_required');
    expect(result.sanitizedError).toBe('provider_not_configured');

    expect(await ctx.prisma.walletPositionReconstructionRun.count()).toBe(0);
    expect(await ctx.prisma.walletQualityAnalysisRun.count()).toBe(0);
    expect(await ctx.prisma.walletStrategyFingerprintRun.count()).toBe(0);
  });

  it('never runs quality or fingerprint when reconstruction fails', async () => {
    const wallet = await createWallet(ctx.prisma, 51_000);
    const mint = syntheticAddress(51_001);
    const fake = new FakeProvider({ [wallet.address]: oneCycleHistory(wallet.address, mint) });
    ctx = await buildTestApp({ activityProvider: fake, syncOptions: { pauseMs: 0 } });

    // Force a real reconstruction-stage failure via lock contention.
    expect(tryAcquireReconstructionLock()).toBe(true);
    const result = (await prepare({ walletIds: [wallet.id] })).json().results[0];
    releaseReconstructionLock();

    expect(result.sync.status).toBe('COMPLETED');
    expect(result.reconstruction.status).toBe('FAILED');
    expect(result.reconstruction.reason).toBe('reconstruction_in_progress');
    expect(result.quality.status).toBe('NOT_STARTED');
    expect(result.quality.reason).toBe('reconstruction_failed');
    expect(result.fingerprint.status).toBe('NOT_STARTED');
    expect(result.fingerprint.reason).toBe('reconstruction_failed');
    expect(result.sanitizedError).toBe('reconstruction_in_progress');
  });

  it('isolates a per-wallet reconstruction failure from a sibling wallet in the same request', async () => {
    const good = await createWallet(ctx.prisma, 51_100, { label: 'bn trezor' });
    const bad = await createWallet(ctx.prisma, 51_101, { label: 'bn new' });
    const mintGood = syntheticAddress(51_102);
    const mintBad = syntheticAddress(51_103);
    const fake = new FakeProvider({
      [good.address]: oneCycleHistory(good.address, mintGood),
      [bad.address]: oneCycleHistory(bad.address, mintBad),
    });
    ctx = await buildTestApp({ activityProvider: fake, syncOptions: { pauseMs: 0 } });

    // Reconstruction fails for BOTH wallets via lock contention (held for the
    // whole request). This still proves the required invariant: one wallet's
    // stage failure never aborts processing of the other selected wallet.
    expect(tryAcquireReconstructionLock()).toBe(true);
    const body = (await prepare({ walletIds: [good.id, bad.id] })).json();
    releaseReconstructionLock();

    expect(body.processedWallets).toBe(2); // both wallets were processed, not aborted
    expect(body.failures).toBe(2);
    expect(body.results[0].walletId).toBe(good.id);
    expect(body.results[0].reconstruction.status).toBe('FAILED');
    expect(body.results[1].walletId).toBe(bad.id);
    expect(body.results[1].reconstruction.status).toBe('FAILED');
    // Crucially, wallet B was still fully attempted after wallet A failed.
    expect(body.results[1].sync.status).toBe('COMPLETED');
  });
});

describe('one-click focus wallet preparation — concurrency and locking', () => {
  it('rejects a wallet that is already being prepared', async () => {
    const wallet = await createWallet(ctx.prisma, 51_200);
    expect(tryAcquirePrepareLock(wallet.id)).toBe(true);
    const response = await prepare({ walletIds: [wallet.id] });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe('wallet_prepare_in_progress');
    releasePrepareLock(wallet.id);

    // Lock released → a subsequent request succeeds.
    expect((await prepare({ walletIds: [wallet.id] })).statusCode).toBe(200);
  });

  it('releases the prepare lock after an unexpected internal failure', async () => {
    const wallet = await createWallet(ctx.prisma, 51_300);
    // mockRejectedValueOnce is consumed by the very first walletEvent.count()
    // call inside prepareOneWallet, well before the sync stage begins.
    vi.spyOn(ctx.prisma.walletEvent, 'count').mockRejectedValueOnce(new Error('unexpected db failure'));

    const failed = await prepare({ walletIds: [wallet.id] });
    expect(failed.statusCode).toBe(200); // isolated inside prepareFocusWallets, not a 500
    expect(failed.json().results[0].sanitizedError).toBe('unexpected_error');
    expect(failed.json().results[0].sync.status).toBe('FAILED');

    // The lock is a module-level Set, so a completely fresh (unmocked) app
    // sharing the same test database proves it was released in `finally`.
    // (vi.spyOn(...).mockRestore() on a Prisma delegate method does not
    // truly restore it — it leaves the proxy broken — so a fresh client,
    // not mockRestore, is the reliable way to verify the retry.)
    const fresh = await buildTestApp({ activityProvider: new FakeProvider({}), syncOptions: { pauseMs: 0 } });
    const retried = await fresh.app.inject({
      method: 'POST',
      url: '/api/focus-wallets/prepare',
      payload: { walletIds: [wallet.id] },
    });
    expect(retried.statusCode).toBe(200);
    expect(retried.json().results[0].sync.status).not.toBe('FAILED');
  });

  it('never exposes raw provider errors, paths or stack traces', async () => {
    const wallet = await createWallet(ctx.prisma, 51_400);
    class ThrowingProvider extends FakeProvider {
      isConfigured(): boolean {
        return true;
      }
      async getWalletTransactions(): Promise<SolanaTransaction[]> {
        throw new Error('leaked secret at /Users/real/.env with key sk-XXXX');
      }
    }
    ctx = await buildTestApp({ activityProvider: new ThrowingProvider({}), syncOptions: { pauseMs: 0 } });

    const result = (await prepare({ walletIds: [wallet.id] })).json().results[0];
    expect(result.sync.status).toBe('FAILED');
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('/Users/');
    expect(serialized).not.toContain('sk-XXXX');
    expect(serialized).not.toContain('.env');
  });
});

describe('one-click focus wallet preparation — database safety', () => {
  it('never deletes existing wallets, events, positions or runs', async () => {
    const wallet = await createWallet(ctx.prisma, 51_500);
    const mint = syntheticAddress(51_501);
    const fake = new FakeProvider({ [wallet.address]: oneCycleHistory(wallet.address, mint) });
    ctx = await buildTestApp({ activityProvider: fake, syncOptions: { pauseMs: 0 } });

    const otherWallet = await createWallet(ctx.prisma, 51_502);

    await prepare({ walletIds: [wallet.id] });

    expect(await ctx.prisma.trackedWallet.count()).toBe(2);
    expect(await ctx.prisma.trackedWallet.findUnique({ where: { id: otherWallet.id } })).not.toBeNull();
    expect(await ctx.prisma.walletEvent.count()).toBeGreaterThan(0);
  });

  it('never synchronizes wallets outside the explicit selection', async () => {
    const selected = await createWallet(ctx.prisma, 51_600);
    const untouched = await createWallet(ctx.prisma, 51_601);
    const mint = syntheticAddress(51_602);
    const fake = new FakeProvider({
      [selected.address]: oneCycleHistory(selected.address, mint),
      [untouched.address]: oneCycleHistory(untouched.address, mint),
    });
    ctx = await buildTestApp({ activityProvider: fake, syncOptions: { pauseMs: 0 } });

    await prepare({ walletIds: [selected.id] });
    expect(await ctx.prisma.walletEvent.count({ where: { walletId: untouched.id } })).toBe(0);
    expect(await ctx.prisma.walletSyncState.findUnique({ where: { walletId: untouched.id } })).toBeNull();
  });
});

describe('one-click focus wallet preparation — neutral language', () => {
  it('produces no ranking, copy-recommendation or trading language anywhere in the response', async () => {
    const wallet = await createWallet(ctx.prisma, 51_700, { label: 'bn trezor' });
    const mint = syntheticAddress(51_701);
    const fake = new FakeProvider({ [wallet.address]: oneCycleHistory(wallet.address, mint) });
    ctx = await buildTestApp({ activityProvider: fake, syncOptions: { pauseMs: 0 } });

    const body = JSON.stringify((await prepare({ walletIds: [wallet.id] })).json());
    expect(body).not.toMatch(/rank|leaderboard|best wallet|top wallet/i);
    expect(body).not.toMatch(/follow|copy trade|recommend/i);
    expect(body).not.toMatch(/insider|sniper|whale|cabal/i);
    expect(body).not.toMatch(/buy now|sell now|should (buy|sell|hold)/i);
  });
});
