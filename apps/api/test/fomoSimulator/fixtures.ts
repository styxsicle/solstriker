/**
 * FOMO Simulator fixtures — synthetic only. Builds real stored evidence that
 * deterministically produces specific Slow Cook state/confidence combinations
 * (see services/slowCook/candidates.ts for the scoring being exercised).
 */
import type { PrismaClient } from '@prisma/client';
import { FOMO_METHODOLOGY_VERSION, cohortKeyFor } from '../../src/services/fomoSimulator/mapping.js';
import {
  completeReconstruction,
  createEvent,
  createPosition,
  createSnapshot,
  createToken,
  createWallet,
  nextId,
} from '../slowCook/fixtures.js';

export * from '../slowCook/fixtures.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
export const ago = (ms: number) => new Date(Date.now() - ms);
export { MIN, HOUR, DAY };

/**
 * HOLDING (or BUILDING) + HIGHER confidence: `walletCount` wallets (>=5 for
 * HIGHER) each with recent buys, a current reconstruction covering every
 * event, an OPEN reconstructed position, plus a FRESH market snapshot.
 * Score: 5×10 (wallets) + 20 (all current) + 10 (fresh market) = 80 → HIGHER.
 */
export async function higherConfidenceSetup(
  prisma: PrismaClient,
  seedBase: number,
  options: { walletCount?: number; buysPerWallet?: number; priceUsd?: string } = {},
) {
  const walletCount = options.walletCount ?? 5;
  const buysPerWallet = options.buysPerWallet ?? 1;
  const token = await createToken(prisma, seedBase);
  const walletIds: string[] = [];
  for (let i = 0; i < walletCount; i += 1) {
    const wallet = await createWallet(prisma, seedBase + 1 + i);
    walletIds.push(wallet.id);
    const eventIds: string[] = [];
    for (let b = 0; b < buysPerWallet; b += 1) {
      const event = await createEvent(prisma, {
        walletId: wallet.id,
        tokenId: token.id,
        eventType: 'BUY',
        blockTime: ago(HOUR * (b + 1)),
      });
      eventIds.push(event.id);
    }
    const run = await completeReconstruction(prisma, wallet.id, eventIds);
    await createPosition(prisma, {
      reconstructionRunId: run.id,
      trackedWalletId: wallet.id,
      tokenId: token.id,
      status: 'OPEN',
      includedEventIds: eventIds,
    });
  }
  const snapshot = await createSnapshot(prisma, token.id, {
    observedAt: ago(MIN),
    priceUsd: options.priceUsd ?? '0.001',
  });
  return { token, walletIds, snapshot };
}

/** COOLING evidence: one old buy (past 66% of the 30-day lookback), nothing since. */
export async function coolingSetup(prisma: PrismaClient, seedBase: number) {
  const token = await createToken(prisma, seedBase);
  const wallet = await createWallet(prisma, seedBase + 1);
  await createEvent(prisma, {
    walletId: wallet.id,
    tokenId: token.id,
    eventType: 'BUY',
    blockTime: ago(25 * DAY),
  });
  return { token, walletIds: [wallet.id] };
}

/** DISTRIBUTION_RISK evidence: recent buy followed by at least as much selling. */
export async function distributionSetup(prisma: PrismaClient, seedBase: number) {
  const token = await createToken(prisma, seedBase);
  const wallet = await createWallet(prisma, seedBase + 1);
  await createEvent(prisma, { walletId: wallet.id, tokenId: token.id, eventType: 'BUY', blockTime: ago(3 * HOUR) });
  await createEvent(prisma, { walletId: wallet.id, tokenId: token.id, eventType: 'SELL', blockTime: ago(HOUR) });
  return { token, walletIds: [wallet.id] };
}

/** A directly inserted open paper position (bypasses the BUY flow on purpose). */
export async function createPaperPosition(
  prisma: PrismaClient,
  options: {
    tokenId: string;
    tokenMint: string;
    walletIds: string[];
    status?: 'OPEN' | 'CLOSED';
    notionalUsd?: string;
    tokenQuantity?: string;
    entryPriceUsd?: string;
    realizedPlUsd?: string | null;
    unrealizedPlUsd?: string | null;
  },
) {
  const status = options.status ?? 'OPEN';
  return prisma.paperPosition.create({
    data: {
      tokenId: options.tokenId,
      tokenMint: options.tokenMint,
      cohortKey: cohortKeyFor(options.walletIds),
      walletIdsJson: JSON.stringify([...options.walletIds].sort()),
      methodologyVersion: FOMO_METHODOLOGY_VERSION,
      status,
      notionalUsd: options.notionalUsd ?? '100',
      feeRatePct: '0.3',
      entrySlippagePct: '1',
      exitSlippagePct: '1',
      entrySnapshotId: nextId('entry-snap'),
      entryObservedAt: ago(2 * HOUR),
      entryPriceUsd: options.entryPriceUsd ?? '0.001',
      effectiveEntryPriceUsd: options.entryPriceUsd ?? '0.001',
      entryFeeUsd: '0.3',
      tokenQuantity: options.tokenQuantity ?? '99700',
      closedAt: status === 'CLOSED' ? ago(HOUR) : null,
      realizedPlUsd: options.realizedPlUsd ?? null,
      realizedReturnPct: options.realizedPlUsd ?? null,
      unrealizedPlUsd: options.unrealizedPlUsd ?? null,
      unrealizedReturnPct: options.unrealizedPlUsd ?? null,
    },
  });
}

/** A directly inserted paper call (for scorecard tests). */
export async function createPaperCall(
  prisma: PrismaClient,
  options: {
    tokenId: string;
    tokenMint: string;
    walletIds: string[];
    action: 'BUY' | 'HOLD' | 'EXIT' | 'AVOID' | 'NO_TRADE';
    conviction?: 'HIGH' | 'MEDIUM' | 'LOW';
    priced?: boolean;
    paperPositionId?: string | null;
    walletLabels?: (string | null)[];
  },
) {
  const sorted = [...options.walletIds].sort();
  return prisma.paperCall.create({
    data: {
      dedupeKey: nextId('dedupe-call'),
      action: options.action,
      conviction: options.conviction ?? 'LOW',
      slowCookState: 'HOLDING',
      slowCookConfidence: 'LOW',
      slowCookMethodologyVersion: 'slow-cook-v1',
      fomoMethodologyVersion: FOMO_METHODOLOGY_VERSION,
      analyzedAt: new Date(),
      tokenId: options.tokenId,
      tokenMint: options.tokenMint,
      cohortKey: cohortKeyFor(options.walletIds),
      walletIdsJson: JSON.stringify(sorted),
      walletAddressesJson: JSON.stringify(sorted),
      walletLabelsJson: JSON.stringify(options.walletLabels ?? sorted.map(() => null)),
      reasonsJson: '[]',
      invalidationJson: '[]',
      evidenceJson: '{}',
      dataQualityJson: '{}',
      settingsJson: '{}',
      priced: options.priced ?? false,
      paperPositionId: options.paperPositionId ?? null,
    },
  });
}
