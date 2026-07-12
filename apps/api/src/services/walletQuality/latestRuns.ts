import type { PrismaClient } from '@prisma/client';

export async function latestQualityMetricSetByWallet(prisma: PrismaClient) {
  const sets = await prisma.walletQualityMetricSet.findMany({
    where: { analysisRun: { status: 'COMPLETED', completedAt: { not: null } } },
    include: { analysisRun: { select: { completedAt: true, id: true } } },
    orderBy: [
      { analysisRun: { completedAt: 'desc' } },
      { analysisRun: { id: 'desc' } },
      { calculatedAt: 'desc' },
      { id: 'desc' },
    ],
  });
  const out = new Map<string, string>();
  for (const set of sets) if (!out.has(set.trackedWalletId)) out.set(set.trackedWalletId, set.id);
  return out;
}
