/**
 * Read-only BN wallet readiness audit — currentness helpers, the readiness
 * report builder, and the exact-label grouping/comparison logic. All wallets
 * are synthetic (`syntheticAddress`); nothing here touches a real address.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { syntheticAddress } from '@memecoin-lab/shared';
import { buildTestApp, resetDb, type TestApp } from '../helpers.js';
import { seedWallet, resetIds } from '../strategies/fixtures.js';
import {
  isFingerprintCurrent,
  isQualityCurrent,
  isReconstructionCurrent,
  latestCompletedReconstructionForWallet,
  reconstructionCoverage,
} from '../../src/services/walletResearch/currentness.js';
import { buildWalletReadinessReports } from '../../src/services/walletResearch/readinessReport.js';
import { findBnLabeledWallets, narrativeFor, toComparisonRow } from '../../src/services/walletResearch/bnAudit.js';

let ctx: TestApp;
beforeEach(async () => {
  ctx = await buildTestApp();
  await resetDb(ctx.prisma);
  resetIds();
});

async function tableCounts() {
  const [wallets, events, syncStates, reconRuns, qualityRuns, fingerprintRuns] = await Promise.all([
    ctx.prisma.trackedWallet.count(),
    ctx.prisma.walletEvent.count(),
    ctx.prisma.walletSyncState.count(),
    ctx.prisma.walletPositionReconstructionRun.count(),
    ctx.prisma.walletQualityAnalysisRun.count(),
    ctx.prisma.walletStrategyFingerprintRun.count(),
  ]);
  return { wallets, events, syncStates, reconRuns, qualityRuns, fingerprintRuns };
}

describe('currentness helpers (shared with one-click preparation)', () => {
  it('treats a reconstruction as current only when covered events equal stored events', () => {
    expect(isReconstructionCurrent(5, 5)).toBe(true);
    expect(isReconstructionCurrent(4, 5)).toBe(false);
    expect(isReconstructionCurrent(0, 0)).toBe(true);
  });

  it('treats quality as current only when its reconstructionRunId matches the current one', () => {
    expect(isQualityCurrent({ reconstructionRunId: 'run-1' }, 'run-1')).toBe(true);
    expect(isQualityCurrent({ reconstructionRunId: 'run-1' }, 'run-2')).toBe(false);
    expect(isQualityCurrent(null, 'run-1')).toBe(false);
    expect(isQualityCurrent({ reconstructionRunId: 'run-1' }, null)).toBe(false);
  });

  it('treats a fingerprint as current only when both reconstruction and quality IDs match', () => {
    const fp = { reconstructionRunId: 'run-1', qualityMetricSetId: 'q-1' };
    expect(isFingerprintCurrent(fp, 'run-1', 'q-1')).toBe(true);
    expect(isFingerprintCurrent(fp, 'run-1', 'q-2')).toBe(false);
    expect(isFingerprintCurrent(fp, 'run-2', 'q-1')).toBe(false);
    expect(isFingerprintCurrent({ reconstructionRunId: 'run-1', qualityMetricSetId: null }, 'run-1', null)).toBe(true);
  });

  it('sums included + excluded event counts for reconstruction coverage', async () => {
    const { wallet } = await seedWallet(ctx.prisma, {
      seed: 90_001,
      cycles: [{ buys: [{ at: 0, sol: 0.2, tokens: 100 }], sells: [{ at: 600, sol: 0.3, tokens: 100 }] }],
    });
    const run = await latestCompletedReconstructionForWallet(ctx.prisma, wallet.id);
    expect(run).not.toBeNull();
    const covered = await reconstructionCoverage(ctx.prisma, wallet.id, run!.reconstructionRunId);
    expect(covered).toBe(2); // one buy + one sell event, both included
  });
});

describe('buildWalletReadinessReports — states and missing-vs-zero', () => {
  it('reports MISSING for a wallet that was never synced, never zero', async () => {
    // seedWallet always creates a WalletSyncState row, so a genuinely
    // never-synced wallet must be created directly (no sync state at all).
    const wallet = await ctx.prisma.trackedWallet.create({
      data: { address: syntheticAddress(90_100), label: 'bn', source: 'import:json' },
    });
    const [report] = await buildWalletReadinessReports(ctx.prisma, [wallet.id]);
    expect(report.sync.everSynced).toBe(false);
    expect(report.sync.totalTransactions).toBeNull(); // not zero — no record exists
    expect(report.events.storedEventCount).toBe(0); // zero is correct here: the events table genuinely has none
    expect(report.events.earliest).toBeNull();
    expect(report.reconstruction.state).toBe('MISSING');
    expect(report.reconstruction.positionCount).toBeNull(); // not zero — no reconstruction record exists
    expect(report.quality.state).toBe('MISSING');
    expect(report.fingerprint.state).toBe('MISSING');
  });

  it('reports CURRENT when a completed reconstruction covers every stored event', async () => {
    const { wallet } = await seedWallet(ctx.prisma, {
      seed: 90_200,
      completeHistory: true,
      cycles: [{ buys: [{ at: 0, sol: 0.2, tokens: 100 }], sells: [{ at: 600, sol: 0.3, tokens: 100 }] }],
    });
    const [report] = await buildWalletReadinessReports(ctx.prisma, [wallet.id]);
    expect(report.reconstruction.state).toBe('CURRENT');
    expect(report.reconstruction.coveredEventCount).toBe(2);
    expect(report.events.storedEventCount).toBe(2);
    expect(report.reconstruction.positionCount).toBe(1);
    expect(report.reconstruction.closedCount).toBe(1);
  });

  it('reports STALE when new events exist after the latest completed reconstruction', async () => {
    const { wallet, token, run } = await seedWallet(ctx.prisma, {
      seed: 90_300,
      cycles: [{ buys: [{ at: 0, sol: 0.2, tokens: 100 }], sells: [{ at: 600, sol: 0.3, tokens: 100 }] }],
    });
    // A new event arrives after the reconstruction that covered only 2 events.
    await ctx.prisma.walletEvent.create({
      data: {
        dedupeKey: `${wallet.id}:extra`,
        walletId: wallet.id,
        tokenId: token.id,
        signature: 'extra-sig',
        eventType: 'BUY',
        tokenAmount: 50,
        quoteMint: 'SOL',
        quoteAmount: 0.1,
        blockTime: new Date('2026-05-01T01:00:00Z'),
        confidence: 'CONFIRMED',
        decoderVersion: 2,
      },
    });
    const [report] = await buildWalletReadinessReports(ctx.prisma, [wallet.id]);
    expect(report.reconstruction.state).toBe('STALE');
    expect(report.reconstruction.runId).toBe(run!.id); // the stale run is still reported, not hidden
    expect(report.events.storedEventCount).toBe(3);
    expect(report.reconstruction.coveredEventCount).toBe(2);
  });

  it('reports quality and fingerprint as MISSING even when reconstruction is CURRENT', async () => {
    const { wallet } = await seedWallet(ctx.prisma, {
      seed: 90_400,
      cycles: [{ buys: [{ at: 0, sol: 0.2, tokens: 100 }] }],
    });
    const [report] = await buildWalletReadinessReports(ctx.prisma, [wallet.id]);
    expect(report.reconstruction.state).toBe('CURRENT');
    expect(report.quality.state).toBe('MISSING');
    expect(report.quality.eligibleCount).toBeNull();
    expect(report.fingerprint.state).toBe('MISSING');
    expect(report.fingerprint.eligibleCycleCount).toBeNull();
  });

  it('reports quality as STALE once reconstruction is refreshed to a new run', async () => {
    const { wallet } = await seedWallet(ctx.prisma, {
      seed: 90_500,
      cycles: [{ buys: [{ at: 0, sol: 0.2, tokens: 100 }], sells: [{ at: 600, sol: 0.3, tokens: 100 }] }],
    });
    const firstRun = await latestCompletedReconstructionForWallet(ctx.prisma, wallet.id);
    await ctx.prisma.walletQualityAnalysisRun.create({
      data: { id: 'quality-run-1', status: 'COMPLETED', completedAt: new Date('2026-05-02T01:00:00Z') },
    });
    await ctx.prisma.walletQualityMetricSet.create({
      data: {
        id: 'quality-set-1',
        analysisRunId: 'quality-run-1',
        reconstructionRunId: firstRun!.reconstructionRunId,
        trackedWalletId: wallet.id,
        status: 'COMPLETE',
        confidence: 'LOW',
        sampleSizeTier: 'VERY_SMALL',
        eligibleClosedCount: 1,
        excludedCount: 0,
      },
    });
    const beforeReport = (await buildWalletReadinessReports(ctx.prisma, [wallet.id]))[0];
    expect(beforeReport.quality.state).toBe('CURRENT');
    expect(beforeReport.quality.eligibleCount).toBe(1);

    // A newer completed reconstruction run supersedes the one the quality set references.
    const newerRun = await ctx.prisma.walletPositionReconstructionRun.create({
      data: { status: 'COMPLETED', completedAt: new Date('2026-05-03T00:00:00Z') },
    });
    await ctx.prisma.walletBehaviorProfile.create({
      data: { reconstructionRunId: newerRun.id, trackedWalletId: wallet.id, status: 'PARTIAL', confidence: 'LOW', completeHistory: false },
    });
    await ctx.prisma.walletPosition.create({
      data: {
        reconstructionRunId: newerRun.id,
        trackedWalletId: wallet.id,
        tokenId: (await ctx.prisma.token.findFirstOrThrow()).id,
        cycleNumber: 1,
        status: 'OPEN',
        confidence: 'HIGH',
        includedEventCount: 2,
        excludedEventCount: 0,
        warningCodes: '[]',
      },
    });
    const afterReport = (await buildWalletReadinessReports(ctx.prisma, [wallet.id]))[0];
    expect(afterReport.reconstruction.runId).toBe(newerRun.id);
    expect(afterReport.quality.state).toBe('STALE'); // still points at the old reconstruction run
  });

  it('never mutates any tracked-wallet or research record', async () => {
    const { wallet } = await seedWallet(ctx.prisma, {
      seed: 90_600,
      cycles: [{ buys: [{ at: 0, sol: 0.2, tokens: 100 }] }],
    });
    const before = await tableCounts();
    const beforeWallet = await ctx.prisma.trackedWallet.findUniqueOrThrow({ where: { id: wallet.id } });

    await buildWalletReadinessReports(ctx.prisma, [wallet.id]);

    const after = await tableCounts();
    const afterWallet = await ctx.prisma.trackedWallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(after).toEqual(before);
    expect(afterWallet).toEqual(beforeWallet);
  });
});

describe('findBnLabeledWallets — exact grouping', () => {
  it('returns every wallet labeled exactly "bn" and keeps "bn trezor" out of that group', async () => {
    await ctx.prisma.trackedWallet.createMany({
      data: [
        { address: syntheticAddress(91_001), label: 'bn', source: 'import:json' },
        { address: syntheticAddress(91_002), label: 'bn', source: 'import:json' },
        { address: syntheticAddress(91_003), label: 'bn trezor', source: 'import:json' },
      ],
    });
    const groups = await findBnLabeledWallets(ctx.prisma);
    expect(groups.exactBn).toHaveLength(2);
    expect(groups.exactBn.every((w) => w.label === 'bn')).toBe(true);
    expect(groups.exactBn.some((w) => w.label === 'bn trezor')).toBe(false);
    expect(groups.containsBn.some((w) => w.label === 'bn trezor')).toBe(true);
  });

  it('keeps case-insensitive-only variants separate from the exact-"bn" group', async () => {
    await ctx.prisma.trackedWallet.createMany({
      data: [
        { address: syntheticAddress(91_101), label: 'bn', source: 'import:json' },
        { address: syntheticAddress(91_102), label: 'BN', source: 'import:json' },
        { address: syntheticAddress(91_103), label: 'Bn', source: 'import:json' },
      ],
    });
    const groups = await findBnLabeledWallets(ctx.prisma);
    expect(groups.exactBn).toHaveLength(1);
    expect(groups.exactBn[0].label).toBe('bn');
    expect(groups.caseInsensitiveExact.map((w) => w.label).sort()).toEqual(['BN', 'Bn']);
  });

  it('distinguishes multiple identical "bn" labels by their full address', async () => {
    await ctx.prisma.trackedWallet.createMany({
      data: [
        { address: syntheticAddress(91_201), label: 'bn', source: 'import:json' },
        { address: syntheticAddress(91_202), label: 'bn', source: 'import:json' },
        { address: syntheticAddress(91_203), label: 'bn', source: 'import:json' },
      ],
    });
    const groups = await findBnLabeledWallets(ctx.prisma);
    const addresses = groups.exactBn.map((w) => w.address);
    expect(new Set(addresses).size).toBe(3); // every candidate has a distinct address
  });

  it('excludes development wallets even when labeled exactly "bn"', async () => {
    await ctx.prisma.trackedWallet.createMany({
      data: [
        { address: syntheticAddress(91_301), label: 'bn', source: 'import:json' },
        { address: syntheticAddress(91_302), label: 'bn', source: 'dev-seed' },
      ],
    });
    const groups = await findBnLabeledWallets(ctx.prisma);
    expect(groups.exactBn).toHaveLength(1);
    expect(groups.exactBn[0].source).not.toBe('dev-seed');
  });

  it('never mutates any wallet record while searching', async () => {
    await ctx.prisma.trackedWallet.create({
      data: { address: syntheticAddress(91_401), label: 'bn', source: 'import:json' },
    });
    const before = await ctx.prisma.trackedWallet.findMany();
    await findBnLabeledWallets(ctx.prisma);
    const after = await ctx.prisma.trackedWallet.findMany();
    expect(after).toEqual(before);
  });
});

describe('BN comparison rows and narrative — no ranking, no ownership inference', () => {
  it('always reports the fixed "Unconfirmed" main-wallet confirmation text', async () => {
    const { wallet } = await seedWallet(ctx.prisma, {
      seed: 92_001,
      label: 'bn',
      completeHistory: true,
      cycles: [{ buys: [{ at: 0, sol: 0.2, tokens: 100 }], sells: [{ at: 600, sol: 0.3, tokens: 100 }] }],
    });
    const [report] = await buildWalletReadinessReports(ctx.prisma, [wallet.id]);
    const row = toComparisonRow(report);
    expect(row.mainWalletConfirmation).toBe('Unconfirmed — user must verify exact address');
    expect(row.address).toBe(wallet.address); // distinguishable by full address
  });

  it('never uses ranking, "best", "most likely", or ownership-inference language', async () => {
    const a = await seedWallet(ctx.prisma, {
      seed: 92_101,
      label: 'bn',
      completeHistory: true,
      cycles: [{ buys: [{ at: 0, sol: 0.2, tokens: 100 }], sells: [{ at: 600, sol: 0.3, tokens: 100 }] }],
    });
    const b = await seedWallet(ctx.prisma, { seed: 92_102, label: 'bn', withReconstruction: false });
    const reports = await buildWalletReadinessReports(ctx.prisma, [a.wallet.id, b.wallet.id]);
    const text = reports
      .flatMap((r) => {
        const { known, missing, next } = narrativeFor(r);
        return [...known, ...missing, ...next, JSON.stringify(toComparisonRow(r))];
      })
      .join('\n');
    expect(text).not.toMatch(/most likely|probably bn main|appears to be bn main|best candidate|top candidate/i);
    expect(text).not.toMatch(/confirmed same owner|shared owner|insider|coordinated/i);
    // Every mention of "BN Main" must be part of the mandated confirmation
    // phrasing ("confirm whether...", "do not use...without confirmation") —
    // never an assertive claim that a specific wallet IS BN Main.
    const declares = text.match(/\bbn main\b/gi) ?? [];
    for (const line of text.split('\n')) {
      if (/\bbn main\b/i.test(line)) {
        expect(line).toMatch(/confirm whether|do not use as bn main without confirmation/i);
      }
    }
    expect(declares.length).toBeGreaterThan(0); // sanity: the mandated phrasing is actually present
  });

  it('states what is missing without inventing values, and gives a non-prescriptive next step', async () => {
    const wallet = await ctx.prisma.trackedWallet.create({
      data: { address: syntheticAddress(92_201), label: 'bn', source: 'import:json' },
    });
    const [report] = await buildWalletReadinessReports(ctx.prisma, [wallet.id]);
    const { known, missing, next } = narrativeFor(report);
    expect(known.some((line) => line.includes('never been synchronized'))).toBe(true);
    expect(missing).toContain('No synchronization has ever been run for this wallet.');
    expect(next).toContain('Confirm whether this exact address is BN Main.');
    expect(next).toContain('Do not use as BN Main without confirmation.');
  });
});

describe('audit end-to-end: no database mutation', () => {
  it('running the full exact-bn discovery + report pipeline never creates a sync, reconstruction, quality or fingerprint run', async () => {
    await seedWallet(ctx.prisma, { seed: 93_001, label: 'bn', withReconstruction: false });
    await seedWallet(ctx.prisma, {
      seed: 93_002,
      label: 'bn',
      cycles: [{ buys: [{ at: 0, sol: 0.2, tokens: 100 }] }],
    });
    await ctx.prisma.trackedWallet.create({
      data: { address: syntheticAddress(93_003), label: 'bn trezor', source: 'import:json' },
    });

    const before = await tableCounts();
    const groups = await findBnLabeledWallets(ctx.prisma);
    await buildWalletReadinessReports(
      ctx.prisma,
      groups.exactBn.map((w) => w.id),
    );
    const after = await tableCounts();

    expect(after.syncStates).toBe(before.syncStates);
    expect(after.reconRuns).toBe(before.reconRuns);
    expect(after.qualityRuns).toBe(before.qualityRuns);
    expect(after.fingerprintRuns).toBe(before.fingerprintRuns);
    expect(after.events).toBe(before.events);
    expect(after.wallets).toBe(before.wallets);
  });
});
