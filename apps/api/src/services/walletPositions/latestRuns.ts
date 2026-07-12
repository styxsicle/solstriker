import type { PrismaClient } from '@prisma/client';

/** Latest successfully completed reconstruction run per wallet. */
export async function latestCompletedRunByWallet(prisma: PrismaClient) {
  const profiles = await prisma.walletBehaviorProfile.findMany({
    where: { reconstructionRun: { status: 'COMPLETED', completedAt: { not: null } } },
    include: { reconstructionRun: { select: { id: true, completedAt: true } } },
    orderBy: [
      { reconstructionRun: { completedAt: 'desc' } },
      { reconstructionRun: { id: 'desc' } },
      { calculatedAt: 'desc' },
      { id: 'desc' },
    ],
  });
  const latest = new Map<string, string>();
  for (const profile of profiles) {
    if (!latest.has(profile.trackedWalletId)) {
      latest.set(profile.trackedWalletId, profile.reconstructionRunId);
    }
  }
  return latest;
}
