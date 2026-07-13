/**
 * Synthetic Slow Cook fixtures. Every address, event, and position is
 * fabricated for tests (`syntheticAddress`) — never real wallet data.
 */
import type { PrismaClient } from '@prisma/client';
import { syntheticAddress } from '@memecoin-lab/shared';

let counter = 0;
export const nextId = (prefix: string) => `${prefix}-${(counter += 1)}`;
export const resetIds = () => {
  counter = 0;
};

export async function createWallet(
  prisma: PrismaClient,
  seed: number,
  opts: Partial<{ label: string; source: string }> = {},
) {
  return prisma.trackedWallet.create({
    data: { address: syntheticAddress(seed), label: opts.label ?? null, source: opts.source ?? 'activity' },
  });
}

export async function createToken(prisma: PrismaClient, seed: number, opts: Partial<{ source: string; name: string; symbol: string }> = {}) {
  return prisma.token.create({
    data: {
      mintAddress: syntheticAddress(seed),
      source: opts.source ?? 'activity',
      name: opts.name ?? null,
      symbol: opts.symbol ?? null,
    },
  });
}

export interface EventSpec {
  walletId: string;
  tokenId: string;
  eventType: 'BUY' | 'SELL' | 'TOKEN_TRANSFER_IN' | 'TOKEN_TRANSFER_OUT';
  blockTime: Date;
  tokenAmount?: number;
  quoteAmount?: number | null;
  decoderVersion?: number;
  confidence?: 'CONFIRMED' | 'LIKELY' | 'UNKNOWN' | null;
}

export async function createEvent(prisma: PrismaClient, spec: EventSpec) {
  return prisma.walletEvent.create({
    data: {
      dedupeKey: nextId('dedupe'),
      walletId: spec.walletId,
      tokenId: spec.tokenId,
      signature: nextId('sig'),
      eventType: spec.eventType,
      tokenAmount: spec.tokenAmount ?? 100,
      quoteMint: 'SOL',
      quoteAmount: spec.quoteAmount === undefined ? 0.2 : spec.quoteAmount,
      blockTime: spec.blockTime,
      confidence: spec.confidence === undefined ? 'CONFIRMED' : spec.confidence,
      decoderVersion: spec.decoderVersion ?? 2,
    },
  });
}

/** Creates a COMPLETED reconstruction run + behavior profile covering exactly the given events. */
export async function completeReconstruction(
  prisma: PrismaClient,
  walletId: string,
  eventIds: string[],
  opts: Partial<{ completeHistory: boolean; completedAt: Date }> = {},
) {
  const run = await prisma.walletPositionReconstructionRun.create({
    data: { status: 'COMPLETED', completedAt: opts.completedAt ?? new Date() },
  });
  await prisma.walletBehaviorProfile.create({
    data: {
      reconstructionRunId: run.id,
      trackedWalletId: walletId,
      status: 'COMPLETE',
      confidence: 'HIGH',
      completeHistory: opts.completeHistory ?? true,
    },
  });
  return run;
}

export interface PositionSpec {
  reconstructionRunId: string;
  trackedWalletId: string;
  tokenId: string;
  cycleNumber?: number;
  status: 'OPEN' | 'PARTIAL' | 'CLOSED' | 'UNMATCHED_SELL';
  includedEventIds: string[];
  excludedEventCount?: number;
  openTokenAmount?: string;
}

export async function createPosition(prisma: PrismaClient, spec: PositionSpec) {
  return prisma.walletPosition.create({
    data: {
      reconstructionRunId: spec.reconstructionRunId,
      trackedWalletId: spec.trackedWalletId,
      tokenId: spec.tokenId,
      cycleNumber: spec.cycleNumber ?? 1,
      status: spec.status,
      confidence: 'HIGH',
      openTokenAmount: spec.openTokenAmount ?? (spec.status === 'OPEN' || spec.status === 'PARTIAL' ? '50' : '0'),
      includedEventCount: spec.includedEventIds.length,
      excludedEventCount: spec.excludedEventCount ?? 0,
      includedEventIdsJson: JSON.stringify(spec.includedEventIds),
      warningCodes: '[]',
    },
  });
}

export async function createSnapshot(
  prisma: PrismaClient,
  tokenId: string,
  opts: Partial<{
    observedAt: Date;
    status: string;
    liquidityUsd: string | null;
    priceUsd: string | null;
  }> = {},
) {
  const run = await prisma.tokenMarketRefreshRun.create({ data: { provider: 'dexscreener' } });
  return prisma.tokenMarketSnapshot.create({
    data: {
      tokenId,
      refreshRunId: run.id,
      observedAt: opts.observedAt ?? new Date(),
      priceUsd: opts.priceUsd === undefined ? '0.001' : opts.priceUsd,
      liquidityUsd: opts.liquidityUsd === undefined ? '50000' : opts.liquidityUsd,
      marketCapUsd: '1000000',
      volume24hUsd: '20000',
      priceChange24hPct: '5',
      source: 'dexscreener',
      status: opts.status ?? 'COMPLETE',
      confidence: 'HIGH',
    },
  });
}
