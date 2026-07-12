/**
 * Strategy-fingerprint APIs: bounded analysis, run isolation, latest-completed
 * reads, and the deliberate absence of any ranking or ownership endpoint.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { syntheticAddress } from '@memecoin-lab/shared';
import { buildTestApp, resetDb, type TestApp } from '../helpers.js';
import {
  releaseStrategyLock,
  tryAcquireStrategyLock,
} from '../../src/services/walletStrategies/analyzeStrategies.js';
import { resetIds, seedWallet, type CycleSpec } from './fixtures.js';

let ctx: TestApp;
beforeEach(async () => {
  ctx = await buildTestApp();
  await resetDb(ctx.prisma);
  resetIds();
  releaseStrategyLock();
});

const CYCLES: CycleSpec[] = [
  { buys: [{ at: 0, sol: 0.2, tokens: 100 }], sells: [{ at: 600, sol: 0.3, tokens: 100 }] },
  {
    buys: [
      { at: 5000, sol: 0.2, tokens: 100 },
      { at: 5074, sol: 0.1, tokens: 50 },
    ],
    sells: [{ at: 6000, sol: 0.4, tokens: 150 }],
  },
];

const analyze = (walletIds: string[]) =>
  ctx.app.inject({ method: 'POST', url: '/api/wallet-strategies/analyze', payload: { walletIds } });

describe('strategy analysis', () => {
  it('calculates a fingerprint with patterns from an existing reconstruction', async () => {
    const { wallet } = await seedWallet(ctx.prisma, { seed: 30_000, cycles: CYCLES, completeHistory: true });
    const response = await analyze([wallet.id]);
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({
      status: 'COMPLETED',
      requestedWallets: 1,
      processedWallets: 1,
      fingerprintsCreated: 1,
      eligibleCycles: 2,
      excludedCycles: 0,
      failures: 0,
      calculationVersion: 1,
    });
    expect(body.patternsCreated).toBeGreaterThan(0);

    const fingerprint = (
      await ctx.app.inject({ method: 'GET', url: `/api/wallet-strategies/${wallet.id}` })
    ).json();
    expect(fingerprint.eligibleCycleCount).toBe(2);
    expect(fingerprint.medianBuysPerCycle).toBe('1.5');
    expect(fingerprint.medianFirstToSecondBuySeconds).toBe('74');
    expect(fingerprint.medianFirstBuySol).toBe('0.2');
    expect(fingerprint.warningCodes).toContain('NO_QUALITY_ANALYSIS');
    expect(fingerprint.patterns.length).toBeGreaterThan(0);
    expect(fingerprint.descriptorEvidence[0]).toHaveProperty('formula');
  });

  it('never analyzes automatically and requires a completed reconstruction', async () => {
    const { wallet } = await seedWallet(ctx.prisma, { seed: 30_100, withReconstruction: false });
    const body = (await analyze([wallet.id])).json();
    expect(body.status).toBe('FAILED');
    expect(body.failures).toBe(1);
    expect(body.results[0]).toMatchObject({ status: 'error', error: 'reconstruction_required' });
    expect(body.results[0].warningCodes).toContain('NO_COMPLETED_RECONSTRUCTION');
    // No reconstruction, quality analysis or sync was triggered on its behalf.
    expect(await ctx.prisma.walletPositionReconstructionRun.count()).toBe(0);
    expect(await ctx.prisma.walletQualityAnalysisRun.count()).toBe(0);
    expect(await ctx.prisma.walletEvent.count()).toBe(0);
  });

  it('isolates per-wallet failures so one wallet cannot abort the others', async () => {
    const ok = await seedWallet(ctx.prisma, { seed: 30_200, cycles: CYCLES });
    const broken = await seedWallet(ctx.prisma, { seed: 30_300, withReconstruction: false });
    const body = (await analyze([ok.wallet.id, broken.wallet.id])).json();
    expect(body.status).toBe('PARTIAL');
    expect(body.processedWallets).toBe(1);
    expect(body.failures).toBe(1);
    expect(body.results.map((r: { status: string }) => r.status)).toEqual(['ok', 'error']);
    expect(await ctx.prisma.walletStrategyFingerprint.count()).toBe(1);
  });

  it('uses the latest completed reconstruction only and never combines runs', async () => {
    const { wallet, token } = await seedWallet(ctx.prisma, {
      seed: 30_400,
      cycles: CYCLES,
      reconstructionRunId: 'older-run',
      reconstructionCompletedAt: new Date('2026-05-02T00:00:00Z'),
    });

    // A newer completed run with a single, different cycle for the same wallet.
    const newer = await ctx.prisma.walletPositionReconstructionRun.create({
      data: { id: 'newer-run', status: 'COMPLETED', completedAt: new Date('2026-06-01T00:00:00Z') },
    });
    await ctx.prisma.walletBehaviorProfile.create({
      data: {
        reconstructionRunId: newer.id,
        trackedWalletId: wallet.id,
        status: 'COMPLETE',
        confidence: 'HIGH',
        completeHistory: true,
      },
    });
    const event = await ctx.prisma.walletEvent.findFirstOrThrow({ where: { eventType: 'BUY' } });
    await ctx.prisma.walletPosition.create({
      data: {
        reconstructionRunId: newer.id,
        trackedWalletId: wallet.id,
        tokenId: token.id,
        cycleNumber: 1,
        status: 'OPEN',
        confidence: 'HIGH',
        openedAt: new Date('2026-05-01T00:00:00Z'),
        openTokenAmount: '100',
        knownCostBasisSol: '0.2',
        includedEventIdsJson: JSON.stringify([event.id]),
        warningCodes: '[]',
      },
    });

    const body = (await analyze([wallet.id])).json();
    expect(body.results[0].reconstructionRunId).toBe('newer-run');
    expect(body.eligibleCycles).toBe(1); // only the newer run's single cycle
    const fingerprint = (
      await ctx.app.inject({ method: 'GET', url: `/api/wallet-strategies/${wallet.id}` })
    ).json();
    expect(fingerprint.reconstructionRunId).toBe('newer-run');
    expect(fingerprint.completeHistory).toBe(true);
  });

  it('links the latest completed quality metric set when one exists', async () => {
    const { wallet } = await seedWallet(ctx.prisma, { seed: 30_500, cycles: CYCLES });
    await ctx.app.inject({
      method: 'POST',
      url: '/api/wallet-quality/analyze',
      payload: { walletIds: [wallet.id] },
    });
    const latestQuality = await ctx.prisma.walletQualityMetricSet.findFirstOrThrow();

    const body = (await analyze([wallet.id])).json();
    expect(body.results[0].qualityMetricSetId).toBe(latestQuality.id);
    const fingerprint = (
      await ctx.app.inject({ method: 'GET', url: `/api/wallet-strategies/${wallet.id}` })
    ).json();
    expect(fingerprint.qualityMetricSetId).toBe(latestQuality.id);
    expect(fingerprint.warningCodes).not.toContain('NO_QUALITY_ANALYSIS');
  });

  it('is idempotent, retains historical runs and reads only the latest completed one', async () => {
    const { wallet } = await seedWallet(ctx.prisma, { seed: 30_600, cycles: CYCLES });
    const first = (await analyze([wallet.id])).json();
    const second = (await analyze([wallet.id])).json();

    // Same inputs, same numbers — and the earlier run is preserved, not overwritten.
    expect(second.eligibleCycles).toBe(first.eligibleCycles);
    expect(second.patternsCreated).toBe(first.patternsCreated);
    expect(await ctx.prisma.walletStrategyFingerprintRun.count()).toBe(2);
    expect(await ctx.prisma.walletStrategyFingerprint.count()).toBe(2);

    const list = (await ctx.app.inject({ method: 'GET', url: '/api/wallet-strategies' })).json();
    expect(list.total).toBe(1); // only the latest completed fingerprint is visible
    expect(list.items[0].runId).toBe(second.runId);

    const olderRun = (
      await ctx.app.inject({ method: 'GET', url: `/api/wallet-strategy-runs/${first.runId}` })
    ).json();
    expect(olderRun.id).toBe(first.runId);
    expect(olderRun.status).toBe('COMPLETED');
    expect(olderRun.calculationVersion).toBe(1);
  });

  it('rejects empty, duplicate, oversized, unknown and development selections', async () => {
    const { wallet } = await seedWallet(ctx.prisma, { seed: 30_700, cycles: CYCLES });
    expect((await analyze([])).statusCode).toBe(400);
    expect((await analyze(Array.from({ length: 11 }, (_, i) => `w${i}`))).statusCode).toBe(400);
    expect((await analyze([wallet.id, wallet.id])).json().error).toBe('duplicate_selection');
    expect((await analyze(['missing'])).json().error).toBe('unknown_wallet');
    const dev = await ctx.prisma.trackedWallet.create({
      data: { address: syntheticAddress(30_800), source: 'dev-seed' },
    });
    expect((await analyze([dev.id])).json().error).toBe('dev_wallet_excluded');
  });

  it('rejects a concurrent analysis and always releases the lock', async () => {
    const { wallet } = await seedWallet(ctx.prisma, { seed: 30_900, cycles: CYCLES });
    expect(tryAcquireStrategyLock()).toBe(true);
    const conflict = await analyze([wallet.id]);
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error).toBe('analysis_in_progress');
    releaseStrategyLock();

    // An internal failure must be sanitized and must not strand the lock.
    // (The spy is not restored: mockRestore() would permanently remove Prisma's
    // proxy-generated delegate method, so the assertion below uses a fresh client.)
    vi.spyOn(ctx.prisma.walletStrategyFingerprintRun, 'create').mockRejectedValue(
      new Error('internal failure with /secret/path'),
    );
    const failed = await analyze([wallet.id]);
    expect(failed.statusCode).toBe(500);
    expect(failed.json().error).toBe('strategy_analysis_failed');
    expect(JSON.stringify(failed.json())).not.toContain('/secret/path'); // sanitized
    vi.restoreAllMocks();

    // The analysis lock is module-level, so a fresh app proves the `finally`
    // released it even though the previous request threw.
    const fresh = await buildTestApp();
    const after = await fresh.app.inject({
      method: 'POST',
      url: '/api/wallet-strategies/analyze',
      payload: { walletIds: [wallet.id] },
    });
    expect(after.statusCode).toBe(200);
  });
});

describe('strategy read APIs', () => {
  it('paginates, filters patterns and returns clear 404s', async () => {
    const a = await seedWallet(ctx.prisma, { seed: 31_000, cycles: CYCLES });
    const b = await seedWallet(ctx.prisma, { seed: 31_100, cycles: CYCLES });
    await analyze([a.wallet.id, b.wallet.id]);

    const page = (
      await ctx.app.inject({ method: 'GET', url: '/api/wallet-strategies?page=1&pageSize=1' })
    ).json();
    expect(page.total).toBe(2);
    expect(page.items).toHaveLength(1);

    const entry = (
      await ctx.app.inject({
        method: 'GET',
        url: `/api/wallet-strategies/${a.wallet.id}/patterns?patternType=ENTRY_COUNT`,
      })
    ).json();
    expect(entry.items.length).toBeGreaterThan(0);
    expect(entry.items.every((p: { patternType: string }) => p.patternType === 'ENTRY_COUNT')).toBe(true);
    expect(entry.items[0].percentage).toBe('50'); // one of two cycles used a single buy

    expect(
      (await ctx.app.inject({ method: 'GET', url: '/api/wallet-strategies/missing' })).statusCode,
    ).toBe(404);
    expect(
      (await ctx.app.inject({ method: 'GET', url: '/api/wallet-strategies/missing/patterns' })).statusCode,
    ).toBe(404);
    expect(
      (await ctx.app.inject({ method: 'GET', url: '/api/wallet-strategy-runs/missing' })).statusCode,
    ).toBe(404);
  });

  it('exposes no ranking, leaderboard, top-wallet or ownership-inference endpoint', async () => {
    const { wallet } = await seedWallet(ctx.prisma, { seed: 31_200, cycles: CYCLES });
    await analyze([wallet.id]);
    for (const url of [
      '/api/wallet-strategies/rankings',
      '/api/wallet-strategies/leaderboard',
      '/api/wallet-strategies/top',
      '/api/wallet-strategies/best',
      '/api/focus-cohorts/ownership',
      '/api/wallet-strategies/related-owners',
    ]) {
      expect((await ctx.app.inject({ method: 'GET', url })).statusCode).toBe(404);
    }
  });

  it('summarizes focus research on the overview without naming a best wallet', async () => {
    const { wallet } = await seedWallet(ctx.prisma, { seed: 31_300, cycles: CYCLES });
    await ctx.app.inject({
      method: 'POST',
      url: '/api/focus-cohorts',
      payload: { name: 'Overview cohort', members: [{ trackedWalletId: wallet.id, role: 'PRIMARY' }] },
    });
    await analyze([wallet.id]);

    const overview = (await ctx.app.inject({ method: 'GET', url: '/api/overview' })).json();
    expect(overview.focus).toMatchObject({
      cohorts: 1,
      cohortMembers: 1,
      walletsWithFingerprints: 1,
      latestRunStatus: 'COMPLETED',
      insufficientEvidenceFingerprints: 0,
      incompleteHistoryFingerprints: 1,
    });
    const keys = Object.keys(overview.focus).join(' ');
    expect(keys).not.toMatch(/best|top|profitable|recommended|rank/i);
  });
});
