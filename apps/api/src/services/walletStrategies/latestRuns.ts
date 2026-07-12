import type { PrismaClient } from '@prisma/client';

/**
 * Latest COMPLETED strategy fingerprint per wallet.
 *
 * Normal APIs and UI read only through this map: partial/failed runs are never
 * shown, historical runs stay in the database untouched, and fingerprints from
 * different runs are never combined.
 */
export async function latestFingerprintByWallet(prisma: PrismaClient) {
  const fingerprints = await prisma.walletStrategyFingerprint.findMany({
    where: { run: { status: 'COMPLETED', completedAt: { not: null } } },
    include: { run: { select: { id: true, completedAt: true } } },
    orderBy: [
      { run: { completedAt: 'desc' } },
      { run: { id: 'desc' } },
      { calculatedAt: 'desc' },
      { id: 'desc' },
    ],
  });
  const latest = new Map<string, string>();
  for (const fingerprint of fingerprints) {
    if (!latest.has(fingerprint.trackedWalletId)) {
      latest.set(fingerprint.trackedWalletId, fingerprint.id);
    }
  }
  return latest;
}
