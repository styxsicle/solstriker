/**
 * Slow Cook V1 — orchestration.
 *
 * A user-triggered, read-only research query over explicitly selected
 * wallets: builds each wallet's deterministic Wallet Style Memory, then
 * finds candidate tokens strictly from those same wallets' own stored
 * events and current reconstructed positions. It never synchronizes,
 * reconstructs, analyzes, generates a fingerprint, calls an external
 * provider, or writes to the database — every call in this module is a
 * read.
 */
import type { PrismaClient } from '@prisma/client';
import { buildWalletStyleMemories, type WalletStyleMemory } from './styleMemory.js';
import { buildSlowCookCandidates, DEFAULT_SLOW_COOK_OPTIONS, SLOW_COOK_CALCULATION_VERSION, type SlowCookCandidate, type SlowCookOptions } from './candidates.js';

export const MAX_SLOW_COOK_WALLETS = 10;
export const MAX_LOOKBACK_DAYS = 180;
export const MAX_CANDIDATE_LIMIT = 50;

export interface SlowCookRequest {
  walletIds: string[];
  lookbackDays?: number;
  minimumWallets?: number;
  limit?: number;
  includeLowerConfidence?: boolean;
}

export interface SlowCookResult {
  calculationVersion: string;
  analyzedAt: string;
  requestedWalletIds: string[];
  options: SlowCookOptions;
  walletsAnalyzed: number;
  walletsWithUsableStyle: number;
  styleMemories: WalletStyleMemory[];
  candidates: SlowCookCandidate[];
  candidatesFound: number;
  strongerCandidateCount: number;
}

/**
 * Clamps and defaults request options. Never trusts the caller for bounds
 * that affect how much of the database is scanned.
 */
export function resolveOptions(request: SlowCookRequest): SlowCookOptions {
  return {
    lookbackDays: clamp(request.lookbackDays ?? DEFAULT_SLOW_COOK_OPTIONS.lookbackDays, 1, MAX_LOOKBACK_DAYS),
    minimumWallets: clamp(request.minimumWallets ?? DEFAULT_SLOW_COOK_OPTIONS.minimumWallets, 1, MAX_SLOW_COOK_WALLETS),
    limit: clamp(request.limit ?? DEFAULT_SLOW_COOK_OPTIONS.limit, 1, MAX_CANDIDATE_LIMIT),
    includeLowerConfidence: request.includeLowerConfidence ?? DEFAULT_SLOW_COOK_OPTIONS.includeLowerConfidence,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

/**
 * Runs one Slow Cook analysis, scoped strictly to `walletIds`. Callers are
 * responsible for validating that every ID exists and excludes development
 * wallets before calling this (see routes/slowCook.ts) — this function
 * trusts its input list as the complete, final scope of the analysis.
 */
export async function analyzeSlowCook(prisma: PrismaClient, request: SlowCookRequest): Promise<SlowCookResult> {
  const options = resolveOptions(request);
  const walletIds = [...new Set(request.walletIds)];

  const styleMemories = await buildWalletStyleMemories(prisma, walletIds);
  const candidates = await buildSlowCookCandidates(prisma, walletIds, styleMemories, options);

  return {
    calculationVersion: SLOW_COOK_CALCULATION_VERSION,
    analyzedAt: new Date().toISOString(),
    requestedWalletIds: walletIds,
    options,
    walletsAnalyzed: walletIds.length,
    walletsWithUsableStyle: styleMemories.filter((m) => m.evidenceState !== 'INSUFFICIENT').length,
    styleMemories,
    candidates,
    candidatesFound: candidates.length,
    strongerCandidateCount: candidates.filter((c) => c.confidence !== 'LOW').length,
  };
}

export { SLOW_COOK_CALCULATION_VERSION };
