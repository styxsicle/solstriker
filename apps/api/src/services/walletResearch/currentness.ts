/**
 * Shared, read-only "is this record still current" rules.
 *
 * Extracted from the one-click preparation feature
 * (`services/focusWallets/prepareWallets.ts`) so every caller — preparation,
 * the BN wallet audit, and any future read-only reporting — uses the exact
 * same definition of "current" instead of reimplementing it inconsistently.
 * Nothing here writes to the database.
 */
import type { PrismaClient } from '@prisma/client';

/** Latest completed reconstruction (behavior profile) for one wallet, if any. */
export async function latestCompletedReconstructionForWallet(prisma: PrismaClient, walletId: string) {
  return prisma.walletBehaviorProfile.findFirst({
    where: { trackedWalletId: walletId, reconstructionRun: { status: 'COMPLETED', completedAt: { not: null } } },
    orderBy: [
      { reconstructionRun: { completedAt: 'desc' } },
      { reconstructionRun: { id: 'desc' } },
      { calculatedAt: 'desc' },
      { id: 'desc' },
    ],
  });
}

/** Latest completed quality metric set for one wallet, if any. */
export async function latestCompletedQualityForWallet(prisma: PrismaClient, walletId: string) {
  return prisma.walletQualityMetricSet.findFirst({
    where: { trackedWalletId: walletId, analysisRun: { status: 'COMPLETED', completedAt: { not: null } } },
    orderBy: [
      { analysisRun: { completedAt: 'desc' } },
      { analysisRun: { id: 'desc' } },
      { calculatedAt: 'desc' },
      { id: 'desc' },
    ],
  });
}

/** Latest completed strategy fingerprint for one wallet, if any. */
export async function latestCompletedFingerprintForWallet(prisma: PrismaClient, walletId: string) {
  return prisma.walletStrategyFingerprint.findFirst({
    where: { trackedWalletId: walletId, run: { status: 'COMPLETED', completedAt: { not: null } } },
    orderBy: [{ run: { completedAt: 'desc' } }, { run: { id: 'desc' } }, { calculatedAt: 'desc' }, { id: 'desc' }],
  });
}

/**
 * A reconstruction is current only when the latest completed run's combined
 * included + excluded event coverage matches the wallet's current stored-event
 * count — i.e. it already accounts for every event currently on record.
 */
export async function reconstructionCoverage(
  prisma: PrismaClient,
  walletId: string,
  reconstructionRunId: string,
): Promise<number> {
  const agg = await prisma.walletPosition.aggregate({
    where: { trackedWalletId: walletId, reconstructionRunId },
    _sum: { includedEventCount: true, excludedEventCount: true },
  });
  return (agg._sum.includedEventCount ?? 0) + (agg._sum.excludedEventCount ?? 0);
}

export function isReconstructionCurrent(coveredEventCount: number, storedEventCount: number): boolean {
  return coveredEventCount === storedEventCount;
}

export function isQualityCurrent(
  qualitySet: { reconstructionRunId: string } | null,
  currentReconstructionRunId: string | null,
): boolean {
  return qualitySet !== null && currentReconstructionRunId !== null && qualitySet.reconstructionRunId === currentReconstructionRunId;
}

export function isFingerprintCurrent(
  fingerprint: { reconstructionRunId: string; qualityMetricSetId: string | null } | null,
  currentReconstructionRunId: string | null,
  currentQualityMetricSetId: string | null,
): boolean {
  return (
    fingerprint !== null &&
    currentReconstructionRunId !== null &&
    fingerprint.reconstructionRunId === currentReconstructionRunId &&
    (fingerprint.qualityMetricSetId ?? null) === currentQualityMetricSetId
  );
}
