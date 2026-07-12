import type { PrismaClient } from '@prisma/client';

export interface ResolvedPair {
  pairAddress: string;
  source: string;
}

/**
 * Resolves the pair to use for a token's historical series: the pair from the
 * token's most recent usable (COMPLETE/PARTIAL) market snapshot. Returns null
 * when the token has no snapshot with a pair — callers must then produce a
 * clear "pair required" result rather than guessing an unrelated pool.
 *
 * Historical pair identity is preserved by storing the resolved pairAddress on
 * every candle and outcome; if the token's selected pair later changes, older
 * candles keep their original pairAddress.
 */
export async function resolveTokenPair(
  prisma: PrismaClient,
  tokenId: string,
): Promise<ResolvedPair | null> {
  const snapshot = await prisma.tokenMarketSnapshot.findFirst({
    where: {
      tokenId,
      status: { in: ['COMPLETE', 'PARTIAL'] },
      pairAddress: { not: null },
    },
    orderBy: [{ observedAt: 'desc' }, { createdAt: 'desc' }],
    select: { pairAddress: true, source: true },
  });
  if (!snapshot?.pairAddress) return null;
  return { pairAddress: snapshot.pairAddress, source: snapshot.source };
}
