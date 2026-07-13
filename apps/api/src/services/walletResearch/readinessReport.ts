/**
 * Read-only wallet research-readiness report.
 *
 * Built for the BN Main identification audit, but deliberately generic: it
 * reports factual database state for any set of tracked wallets. It never
 * synchronizes, reconstructs, analyzes, mutates a tracked-wallet record, or
 * infers a relationship, ownership, or "best" candidate — it only describes
 * what is already stored.
 *
 * Missing values are reported as `null`, never coerced to `0`: "no record
 * exists" and "a record exists with the value zero" are different facts and
 * must never be conflated.
 */
import type { PrismaClient } from '@prisma/client';
import { DECODER_VERSION } from '@memecoin-lab/shared';
import {
  isFingerprintCurrent,
  isQualityCurrent,
  isReconstructionCurrent,
  latestCompletedFingerprintForWallet,
  latestCompletedQualityForWallet,
  latestCompletedReconstructionForWallet,
  reconstructionCoverage,
} from './currentness.js';

/**
 * MISSING     — no record of this type exists for the wallet at all.
 * RUNNING     — the most recent run touching this wallet has not finished.
 * FAILED      — the most recent run touching this wallet ended in failure.
 * STALE       — a completed record exists, but it no longer covers the
 *               wallet's current stored data (see the `currentness` rules).
 * CURRENT     — a completed record exists and still represents the current
 *               stored data.
 */
export type RecordState = 'MISSING' | 'RUNNING' | 'FAILED' | 'STALE' | 'CURRENT';

export interface WalletReadinessReport {
  walletId: string;
  address: string;
  label: string | null;
  group: string | null;
  groups: string[];
  source: string;
  enabled: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;

  sync: {
    everSynced: boolean;
    status: string | null;
    backfillComplete: boolean | null;
    totalTransactions: number | null;
    totalEventsReported: number | null;
    lastSyncAt: string | null;
    lastError: string | null;
  };

  events: {
    storedEventCount: number;
    earliest: string | null;
    latest: string | null;
    buyCount: number;
    sellCount: number;
    transferInCount: number;
    transferOutCount: number;
    /** BUY/SELL events a reconstruction would exclude: legacy decoder or unknown/missing confidence. */
    excludedUnsupportedCount: number;
  };

  reconstruction: {
    state: RecordState;
    runId: string | null;
    runStatus: string | null;
    profileStatus: string | null;
    completeHistory: boolean | null;
    positionCount: number | null;
    closedCount: number | null;
    openCount: number | null;
    partialCount: number | null;
    unmatchedSellCount: number | null;
    coveredEventCount: number | null;
    warningCodes: string[];
  };

  quality: {
    state: RecordState;
    metricSetId: string | null;
    runStatus: string | null;
    setStatus: string | null;
    eligibleCount: number | null;
    excludedCount: number | null;
    warningCodes: string[];
  };

  fingerprint: {
    state: RecordState;
    fingerprintId: string | null;
    runStatus: string | null;
    fingerprintStatus: string | null;
    eligibleCycleCount: number | null;
    excludedCycleCount: number | null;
    warningCodes: string[];
  };
}

function parseCodes(json: string | undefined | null): string[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function parseGroups(json: string | null, fallback: string | null): string[] {
  if (json) {
    try {
      const parsed: unknown = JSON.parse(json);
      if (Array.isArray(parsed)) {
        const groups = parsed.filter((g): g is string => typeof g === 'string' && g !== '');
        if (groups.length) return groups;
      }
    } catch {
      // fall through to the fallback below
    }
  }
  return fallback ? [fallback] : [];
}

/**
 * Builds one read-only readiness report per requested wallet. Never touches
 * any table other than via SELECT — no wallet, event, run, position, metric
 * set or fingerprint is created, updated or deleted.
 */
export async function buildWalletReadinessReports(
  prisma: PrismaClient,
  walletIds: string[],
): Promise<WalletReadinessReport[]> {
  const reports: WalletReadinessReport[] = [];

  for (const walletId of walletIds) {
    const wallet = await prisma.trackedWallet.findUnique({ where: { id: walletId } });
    if (!wallet) continue;

    const syncState = await prisma.walletSyncState.findUnique({ where: { walletId } });

    const [eventAgg, buyCount, sellCount, transferInCount, transferOutCount, excludedUnsupportedCount, storedEventCount] =
      await Promise.all([
        prisma.walletEvent.aggregate({
          where: { walletId },
          _min: { blockTime: true },
          _max: { blockTime: true },
        }),
        prisma.walletEvent.count({ where: { walletId, eventType: 'BUY' } }),
        prisma.walletEvent.count({ where: { walletId, eventType: 'SELL' } }),
        prisma.walletEvent.count({ where: { walletId, eventType: 'TOKEN_TRANSFER_IN' } }),
        prisma.walletEvent.count({ where: { walletId, eventType: 'TOKEN_TRANSFER_OUT' } }),
        prisma.walletEvent.count({
          where: {
            walletId,
            eventType: { in: ['BUY', 'SELL'] },
            OR: [{ decoderVersion: { lt: DECODER_VERSION } }, { confidence: null }, { confidence: 'UNKNOWN' }],
          },
        }),
        prisma.walletEvent.count({ where: { walletId } }),
      ]);

    // --- Reconstruction ---
    const [latestReconstructionRecord, completedReconstruction] = await Promise.all([
      prisma.walletBehaviorProfile.findFirst({
        where: { trackedWalletId: walletId },
        include: { reconstructionRun: true },
        orderBy: [{ reconstructionRun: { startedAt: 'desc' } }, { id: 'desc' }],
      }),
      latestCompletedReconstructionForWallet(prisma, walletId),
    ]);
    const coveredEventCount = completedReconstruction
      ? await reconstructionCoverage(prisma, walletId, completedReconstruction.reconstructionRunId)
      : null;
    const reconstructionCurrent =
      completedReconstruction !== null &&
      coveredEventCount !== null &&
      isReconstructionCurrent(coveredEventCount, storedEventCount);
    const currentReconstructionRunId = reconstructionCurrent ? completedReconstruction!.reconstructionRunId : null;

    let reconstructionState: RecordState = 'MISSING';
    if (reconstructionCurrent) reconstructionState = 'CURRENT';
    else if (latestReconstructionRecord?.reconstructionRun.status === 'RUNNING') reconstructionState = 'RUNNING';
    else if (latestReconstructionRecord?.reconstructionRun.status === 'FAILED') reconstructionState = 'FAILED';
    else if (completedReconstruction) reconstructionState = 'STALE';
    else if (latestReconstructionRecord) reconstructionState = 'FAILED'; // a run touched this wallet but never completed cleanly

    let positionCount: number | null = null;
    let closedCount: number | null = null;
    let openCount: number | null = null;
    let partialCount: number | null = null;
    let unmatchedSellCount: number | null = null;
    if (completedReconstruction) {
      const runId = completedReconstruction.reconstructionRunId;
      const [total, closed, open, unmatched] = await Promise.all([
        prisma.walletPosition.count({ where: { trackedWalletId: walletId, reconstructionRunId: runId } }),
        prisma.walletPosition.count({ where: { trackedWalletId: walletId, reconstructionRunId: runId, status: 'CLOSED' } }),
        prisma.walletPosition.count({ where: { trackedWalletId: walletId, reconstructionRunId: runId, status: 'OPEN' } }),
        prisma.walletPosition.count({ where: { trackedWalletId: walletId, reconstructionRunId: runId, status: 'UNMATCHED_SELL' } }),
      ]);
      positionCount = total;
      closedCount = closed;
      openCount = open;
      partialCount = total - closed - open;
      unmatchedSellCount = unmatched;
    }

    // --- Quality ---
    const [latestQualityRecord, completedQuality] = await Promise.all([
      prisma.walletQualityMetricSet.findFirst({
        where: { trackedWalletId: walletId },
        include: { analysisRun: true },
        orderBy: [{ analysisRun: { startedAt: 'desc' } }, { id: 'desc' }],
      }),
      latestCompletedQualityForWallet(prisma, walletId),
    ]);
    const qualityCurrent = isQualityCurrent(completedQuality, currentReconstructionRunId);
    const currentQualityMetricSetId = qualityCurrent ? completedQuality!.id : null;

    let qualityState: RecordState = 'MISSING';
    if (qualityCurrent) qualityState = 'CURRENT';
    else if (latestQualityRecord?.analysisRun.status === 'RUNNING') qualityState = 'RUNNING';
    else if (latestQualityRecord?.analysisRun.status === 'FAILED') qualityState = 'FAILED';
    else if (completedQuality) qualityState = 'STALE';
    else if (latestQualityRecord) qualityState = 'FAILED';

    // --- Fingerprint ---
    const [latestFingerprintRecord, completedFingerprint] = await Promise.all([
      prisma.walletStrategyFingerprint.findFirst({
        where: { trackedWalletId: walletId },
        include: { run: true },
        orderBy: [{ run: { startedAt: 'desc' } }, { id: 'desc' }],
      }),
      latestCompletedFingerprintForWallet(prisma, walletId),
    ]);
    const fingerprintCurrent = isFingerprintCurrent(
      completedFingerprint,
      currentReconstructionRunId,
      currentQualityMetricSetId,
    );

    let fingerprintState: RecordState = 'MISSING';
    if (fingerprintCurrent) fingerprintState = 'CURRENT';
    else if (latestFingerprintRecord?.run.status === 'RUNNING') fingerprintState = 'RUNNING';
    else if (latestFingerprintRecord?.run.status === 'FAILED') fingerprintState = 'FAILED';
    else if (completedFingerprint) fingerprintState = 'STALE';
    else if (latestFingerprintRecord) fingerprintState = 'FAILED';

    reports.push({
      walletId: wallet.id,
      address: wallet.address,
      label: wallet.label,
      group: wallet.group,
      groups: parseGroups(wallet.groupsJson, wallet.group),
      source: wallet.source,
      enabled: wallet.enabled,
      notes: wallet.notes,
      createdAt: wallet.createdAt.toISOString(),
      updatedAt: wallet.updatedAt.toISOString(),

      sync: {
        everSynced: syncState !== null,
        status: syncState?.status ?? null,
        backfillComplete: syncState?.backfillComplete ?? null,
        totalTransactions: syncState?.totalTransactions ?? null,
        totalEventsReported: syncState?.totalEvents ?? null,
        lastSyncAt: syncState?.lastSyncAt?.toISOString() ?? null,
        lastError: syncState?.lastError ?? null,
      },

      events: {
        storedEventCount,
        earliest: eventAgg._min.blockTime?.toISOString() ?? null,
        latest: eventAgg._max.blockTime?.toISOString() ?? null,
        buyCount,
        sellCount,
        transferInCount,
        transferOutCount,
        excludedUnsupportedCount,
      },

      reconstruction: {
        state: reconstructionState,
        runId: completedReconstruction?.reconstructionRunId ?? latestReconstructionRecord?.reconstructionRunId ?? null,
        runStatus: completedReconstruction ? 'COMPLETED' : (latestReconstructionRecord?.reconstructionRun.status ?? null),
        profileStatus: (completedReconstruction ?? latestReconstructionRecord)?.status ?? null,
        completeHistory: (completedReconstruction ?? latestReconstructionRecord)?.completeHistory ?? null,
        positionCount,
        closedCount,
        openCount,
        partialCount,
        unmatchedSellCount,
        coveredEventCount,
        warningCodes: parseCodes((completedReconstruction ?? latestReconstructionRecord)?.warningCodes),
      },

      quality: {
        state: qualityState,
        metricSetId: completedQuality?.id ?? latestQualityRecord?.id ?? null,
        runStatus: completedQuality ? 'COMPLETED' : (latestQualityRecord?.analysisRun.status ?? null),
        setStatus: (completedQuality ?? latestQualityRecord)?.status ?? null,
        eligibleCount: (completedQuality ?? latestQualityRecord)?.eligibleClosedCount ?? null,
        excludedCount: (completedQuality ?? latestQualityRecord)?.excludedCount ?? null,
        warningCodes: parseCodes((completedQuality ?? latestQualityRecord)?.warningCodes),
      },

      fingerprint: {
        state: fingerprintState,
        fingerprintId: completedFingerprint?.id ?? latestFingerprintRecord?.id ?? null,
        runStatus: completedFingerprint ? 'COMPLETED' : (latestFingerprintRecord?.run.status ?? null),
        fingerprintStatus: (completedFingerprint ?? latestFingerprintRecord)?.status ?? null,
        eligibleCycleCount: (completedFingerprint ?? latestFingerprintRecord)?.eligibleCycleCount ?? null,
        excludedCycleCount: (completedFingerprint ?? latestFingerprintRecord)?.excludedCycleCount ?? null,
        warningCodes: parseCodes((completedFingerprint ?? latestFingerprintRecord)?.warningCodes),
      },
    });
  }

  return reports;
}
