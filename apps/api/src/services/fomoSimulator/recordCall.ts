/**
 * FOMO Simulator V1 — recording a paper call.
 *
 * The backend NEVER trusts a frontend candidate payload or a
 * frontend-provided action. Recording a call re-runs the Slow Cook analysis
 * with the exact requested wallet IDs and settings against current stored
 * data, finds the candidate for the requested token, derives the action from
 * the fixed fomo-sim-v1 mapping, and freezes an immutable evidence snapshot
 * into the PaperCall row. If the token is no longer a candidate under the
 * same settings, the request is rejected as stale — the user must run Slow
 * Cook again.
 *
 * No provider calls, no synchronization, no background work: the only writes
 * are the new paper rows themselves.
 */
import type { PaperCall, PaperPosition, PrismaClient } from '@prisma/client';
import { analyzeSlowCook, type SlowCookResult } from '../slowCook/analyze.js';
import type { SlowCookCandidate } from '../slowCook/candidates.js';
import {
  cohortKeyFor,
  convictionFor,
  dedupeKeyFor,
  derivePaperAction,
  FOMO_METHODOLOGY_VERSION,
  type PaperAction,
} from './mapping.js';
import {
  computeEntry,
  computeExitValue,
  computePl,
  DEFAULT_ASSUMPTIONS,
  DEFAULT_NOTIONAL_USD,
  type SimulationAssumptions,
} from './math.js';
import { executionEligibility, latestUsableSnapshotForToken } from './pricing.js';
import { refreshPositionValuation } from './refresh.js';

export const UNPRICED_BUY_REASON = 'No usable entry price was available at the time of the call.';
export const EXIT_PENDING_REASON = 'Exit signal recorded — closing price unavailable.';

export interface RecordCallRequest {
  tokenId: string;
  walletIds: string[];
  lookbackDays?: number;
  minimumWallets?: number;
  limit?: number;
  includeLowerConfidence?: boolean;
  simulatedAmountUsd?: string;
  assumptions?: Partial<SimulationAssumptions>;
}

export type RecordCallOutcome =
  | { outcome: 'RECORDED'; call: PaperCall; position: PaperPosition | null }
  | { outcome: 'DUPLICATE'; existingCallId: string }
  | { outcome: 'STALE_ANALYSIS' };

function resolveAssumptions(partial: Partial<SimulationAssumptions> | undefined): SimulationAssumptions {
  return {
    feeRatePct: partial?.feeRatePct ?? DEFAULT_ASSUMPTIONS.feeRatePct,
    entrySlippagePct: partial?.entrySlippagePct ?? DEFAULT_ASSUMPTIONS.entrySlippagePct,
    exitSlippagePct: partial?.exitSlippagePct ?? DEFAULT_ASSUMPTIONS.exitSlippagePct,
  };
}

async function findOpenPosition(
  prisma: PrismaClient,
  tokenId: string,
  cohortKey: string,
): Promise<PaperPosition | null> {
  return prisma.paperPosition.findFirst({
    where: { tokenId, cohortKey, methodologyVersion: FOMO_METHODOLOGY_VERSION, status: 'OPEN' },
  });
}

/** The immutable evidence snapshot frozen into every PaperCall row. */
function frozenEvidence(
  candidate: SlowCookCandidate,
  analysis: SlowCookResult,
  wallets: { id: string; address: string; label: string | null }[],
) {
  const sortedIds = [...wallets.map((w) => w.id)].sort();
  const byId = new Map(wallets.map((w) => [w.id, w]));
  const contributingStyles = analysis.styleMemories.map((memory) => ({
    walletId: memory.walletId,
    evidenceState: memory.evidenceState,
    summarySentences: memory.summarySentences,
  }));
  return {
    walletIdsJson: JSON.stringify(sortedIds),
    walletAddressesJson: JSON.stringify(sortedIds.map((id) => byId.get(id)?.address ?? null)),
    walletLabelsJson: JSON.stringify(sortedIds.map((id) => byId.get(id)?.label ?? null)),
    styleSummariesJson: JSON.stringify(contributingStyles),
    reasonsJson: JSON.stringify(candidate.whyThisAppeared),
    invalidationJson: JSON.stringify(candidate.whatCouldInvalidate),
    evidenceJson: JSON.stringify({
      walletInterest: candidate.walletInterest,
      accumulation: candidate.accumulation,
      holdingConviction: candidate.holdingConviction,
      distributionPressure: candidate.distributionPressure,
      styleMatchSummary: candidate.styleMatchSummary,
      confidenceScore: candidate.confidenceScore,
      confidenceComponents: candidate.confidenceComponents,
    }),
    dataQualityJson: JSON.stringify(candidate.dataQuality),
    settingsJson: JSON.stringify(analysis.options),
  };
}

export async function recordPaperCall(
  prisma: PrismaClient,
  request: RecordCallRequest,
  now = new Date(),
): Promise<RecordCallOutcome> {
  const wallets = await prisma.trackedWallet.findMany({
    where: { id: { in: request.walletIds } },
    select: { id: true, address: true, label: true },
  });

  // Revalidate against current stored data with the exact requested settings.
  const analysis = await analyzeSlowCook(prisma, {
    walletIds: request.walletIds,
    lookbackDays: request.lookbackDays,
    minimumWallets: request.minimumWallets,
    limit: request.limit,
    includeLowerConfidence: request.includeLowerConfidence,
  });
  const candidate = analysis.candidates.find((c) => c.tokenId === request.tokenId);
  if (!candidate) return { outcome: 'STALE_ANALYSIS' };

  const cohortKey = cohortKeyFor(request.walletIds);
  const openPosition = await findOpenPosition(prisma, request.tokenId, cohortKey);
  const action: PaperAction = derivePaperAction(candidate.state, candidate.confidence, openPosition !== null);
  const conviction = convictionFor(candidate.confidence);

  const snapshot = await latestUsableSnapshotForToken(prisma, request.tokenId);
  const eligibility = executionEligibility(snapshot, now);

  const dedupeKey = dedupeKeyFor({
    tokenId: request.tokenId,
    walletIds: request.walletIds,
    action,
    latestEvidenceAt: candidate.walletInterest.mostRecentActivityAt,
    entrySnapshotId: snapshot?.id ?? null,
    methodologyVersion: FOMO_METHODOLOGY_VERSION,
  });
  const existing = await prisma.paperCall.findUnique({ where: { dedupeKey } });
  if (existing) return { outcome: 'DUPLICATE', existingCallId: existing.id };

  const assumptions = resolveAssumptions(request.assumptions);
  const notionalUsd = request.simulatedAmountUsd ?? DEFAULT_NOTIONAL_USD;

  const baseCall = {
    dedupeKey,
    action,
    conviction,
    slowCookState: candidate.state,
    slowCookConfidence: candidate.confidence,
    slowCookMethodologyVersion: analysis.calculationVersion,
    fomoMethodologyVersion: FOMO_METHODOLOGY_VERSION,
    analyzedAt: new Date(analysis.analyzedAt),
    latestEvidenceAt: candidate.walletInterest.mostRecentActivityAt
      ? new Date(candidate.walletInterest.mostRecentActivityAt)
      : null,
    tokenId: candidate.tokenId,
    tokenMint: candidate.mintAddress,
    tokenName: candidate.name,
    tokenSymbol: candidate.symbol,
    cohortKey,
    ...frozenEvidence(candidate, analysis, wallets),
    entrySnapshotId: snapshot?.id ?? null,
    entryObservedAt: snapshot?.observedAt ?? null,
    entryPriceUsd: eligibility.priceUsd,
    marketCapUsd: snapshot?.marketCapUsd ?? null,
    liquidityUsd: snapshot?.liquidityUsd ?? null,
    volume24hUsd: snapshot?.volume24hUsd ?? null,
    snapshotFreshness: eligibility.freshness,
    simulatedAmountUsd: notionalUsd,
    feeRatePct: assumptions.feeRatePct,
    entrySlippagePct: assumptions.entrySlippagePct,
    exitSlippagePct: assumptions.exitSlippagePct,
    warningCodes: JSON.stringify(eligibility.warningCodes),
  };

  if (action === 'BUY') {
    if (!eligibility.eligible || !snapshot || eligibility.priceUsd === null) {
      // BUY — NOT SIMULATED: recorded, but no position opens, and it must
      // never be back-filled later with a future price (no look-ahead bias).
      const call = await prisma.paperCall.create({
        data: { ...baseCall, priced: false, unpricedReason: UNPRICED_BUY_REASON },
      });
      return { outcome: 'RECORDED', call, position: null };
    }
    const entry = computeEntry(notionalUsd, eligibility.priceUsd, assumptions);
    const [position, call] = await prisma.$transaction(async (tx) => {
      const created = await tx.paperPosition.create({
        data: {
          tokenId: candidate.tokenId,
          tokenMint: candidate.mintAddress,
          tokenName: candidate.name,
          tokenSymbol: candidate.symbol,
          cohortKey,
          walletIdsJson: baseCall.walletIdsJson,
          methodologyVersion: FOMO_METHODOLOGY_VERSION,
          status: 'OPEN',
          notionalUsd,
          feeRatePct: assumptions.feeRatePct,
          entrySlippagePct: assumptions.entrySlippagePct,
          exitSlippagePct: assumptions.exitSlippagePct,
          entrySnapshotId: snapshot.id,
          entryObservedAt: snapshot.observedAt,
          entryPriceUsd: eligibility.priceUsd!,
          effectiveEntryPriceUsd: entry.effectiveEntryPriceUsd,
          entryFeeUsd: entry.entryFeeUsd,
          tokenQuantity: entry.tokenQuantity,
          entryWarningCodes: JSON.stringify(eligibility.warningCodes),
        },
      });
      const createdCall = await tx.paperCall.create({
        data: { ...baseCall, priced: true, paperPositionId: created.id },
      });
      return [created, createdCall] as const;
    });
    return { outcome: 'RECORDED', call, position };
  }

  if (action === 'HOLD' && openPosition) {
    const call = await prisma.paperCall.create({
      data: { ...baseCall, priced: eligibility.eligible, paperPositionId: openPosition.id },
    });
    // A HOLD also refreshes the valuation from the latest stored usable
    // snapshot (idempotent — see refresh.ts). It never opens a new position.
    const refreshed = await refreshPositionValuation(prisma, openPosition.id, now);
    return { outcome: 'RECORDED', call, position: refreshed?.position ?? openPosition };
  }

  if (action === 'EXIT' && openPosition) {
    if (!eligibility.eligible || !snapshot || eligibility.priceUsd === null) {
      // The exit signal is recorded, but the position stays open — it is
      // never silently closed later at a future price.
      const [call, position] = await prisma.$transaction([
        prisma.paperCall.create({
          data: { ...baseCall, priced: false, unpricedReason: EXIT_PENDING_REASON, paperPositionId: openPosition.id },
        }),
        prisma.paperPosition.update({
          where: { id: openPosition.id },
          data: { exitSignalPendingReason: EXIT_PENDING_REASON },
        }),
      ]);
      return { outcome: 'RECORDED', call, position };
    }
    const exit = computeExitValue(openPosition.tokenQuantity, eligibility.priceUsd, {
      feeRatePct: openPosition.feeRatePct,
      entrySlippagePct: openPosition.entrySlippagePct,
      exitSlippagePct: openPosition.exitSlippagePct,
    });
    const { plUsd, returnPct } = computePl(exit.netExitValueUsd, openPosition.notionalUsd);
    const [call, position] = await prisma.$transaction([
      prisma.paperCall.create({ data: { ...baseCall, priced: true, paperPositionId: openPosition.id } }),
      prisma.paperPosition.update({
        where: { id: openPosition.id },
        data: {
          status: 'CLOSED',
          closedAt: now,
          exitSnapshotId: snapshot.id,
          exitObservedAt: snapshot.observedAt,
          exitPriceUsd: eligibility.priceUsd,
          grossExitValueUsd: exit.grossExitValueUsd,
          exitFeeUsd: exit.exitFeeUsd,
          netExitValueUsd: exit.netExitValueUsd,
          realizedPlUsd: plUsd,
          realizedReturnPct: returnPct,
          exitSignalPendingReason: null,
        },
      }),
    ]);
    return { outcome: 'RECORDED', call, position };
  }

  // AVOID and NO_TRADE (and any HOLD/EXIT that lost its position in a race):
  // record the call only. No position is created, none is modified, and the
  // portfolio P/L is unaffected. A NO_TRADE against an open position is
  // linked to it for call history but leaves it unchanged.
  const call = await prisma.paperCall.create({
    data: { ...baseCall, priced: false, paperPositionId: openPosition?.id ?? null },
  });
  return { outcome: 'RECORDED', call, position: openPosition };
}
