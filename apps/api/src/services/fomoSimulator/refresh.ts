/**
 * FOMO Simulator V1 — position valuation refresh.
 *
 * Reads ONLY already-stored market snapshots — never calls a provider and
 * never runs in the background; the user triggers every refresh explicitly
 * (or implicitly by recording a HOLD call). Idempotent per snapshot: the
 * (positionId, snapshotId) unique constraint plus an observedAt comparison
 * guarantee at most one valuation row per snapshot, and prior valuation
 * history is never modified or deleted.
 */
import type { PaperPosition, PrismaClient } from '@prisma/client';
import { computeExitValue, computePl, type SimulationAssumptions } from './math.js';
import { executionEligibility, latestUsableSnapshotForToken } from './pricing.js';

export interface RefreshResult {
  position: PaperPosition;
  valuationCreated: boolean;
  /** Plain-language explanation when no valuation was created. */
  skippedReason: string | null;
}

export function assumptionsOf(position: PaperPosition): SimulationAssumptions {
  return {
    feeRatePct: position.feeRatePct,
    entrySlippagePct: position.entrySlippagePct,
    exitSlippagePct: position.exitSlippagePct,
  };
}

export async function refreshPositionValuation(
  prisma: PrismaClient,
  positionId: string,
  now = new Date(),
): Promise<RefreshResult | null> {
  const position = await prisma.paperPosition.findUnique({ where: { id: positionId } });
  if (!position) return null;
  if (position.status === 'CLOSED') {
    return { position, valuationCreated: false, skippedReason: 'This paper trade is already closed.' };
  }

  const snapshot = await latestUsableSnapshotForToken(prisma, position.tokenId);
  const eligibility = executionEligibility(snapshot, now);
  if (!eligibility.eligible || !snapshot || eligibility.priceUsd === null) {
    return { position, valuationCreated: false, skippedReason: eligibility.reason };
  }

  // Idempotency: never value the same snapshot twice, and never move
  // "current value" backwards to an older observation.
  const latestValuation = await prisma.paperPositionValuation.findFirst({
    where: { positionId },
    orderBy: { observedAt: 'desc' },
  });
  if (latestValuation && snapshot.observedAt.getTime() <= latestValuation.observedAt.getTime()) {
    return {
      position,
      valuationCreated: false,
      skippedReason: 'The latest stored snapshot has already been applied to this paper trade.',
    };
  }

  const exit = computeExitValue(position.tokenQuantity, eligibility.priceUsd, assumptionsOf(position));
  const { plUsd, returnPct } = computePl(exit.netExitValueUsd, position.notionalUsd);

  const [, updated] = await prisma.$transaction([
    prisma.paperPositionValuation.create({
      data: {
        positionId,
        snapshotId: snapshot.id,
        observedAt: snapshot.observedAt,
        priceUsd: eligibility.priceUsd,
        grossValueUsd: exit.grossExitValueUsd,
        netValueUsd: exit.netExitValueUsd,
        unrealizedPlUsd: plUsd,
        unrealizedReturnPct: returnPct,
        freshness: eligibility.freshness,
      },
    }),
    prisma.paperPosition.update({
      where: { id: positionId },
      data: {
        latestValueUsd: exit.netExitValueUsd,
        unrealizedPlUsd: plUsd,
        unrealizedReturnPct: returnPct,
        latestValuationAt: snapshot.observedAt,
      },
    }),
  ]);

  return { position: updated, valuationCreated: true, skippedReason: null };
}
