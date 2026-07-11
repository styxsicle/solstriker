import type { PrismaClient } from '@prisma/client';
import { DECODER_VERSION } from '@memecoin-lab/shared';
import type { SolanaActivityProvider } from '../../providers/solana/provider.js';
import { ProviderError } from '../../providers/solana/types.js';
import { normalizeTransaction, type NormalizedWalletEvent } from './normalizeTransaction.js';
import { releaseSyncLock, tryAcquireSyncLock } from './syncLock.js';

/**
 * Historical, read-only sync of one wallet's transaction activity.
 *
 * Backfill mode (backfillComplete=false): pages backwards through history from
 * `oldestSignature` (or the tip on the first run), up to `maxTransactions` per
 * call. Hitting the cap leaves backfillComplete=false so the next sync resumes
 * from the stored cursor.
 *
 * Incremental mode (backfillComplete=true): pages from the tip until the
 * stored `newestSignature` is reached. If more than `maxTransactions` new
 * transactions accumulated between syncs, the overflow is skipped (documented
 * Phase 1B limitation); event dedupe keeps overlapping fetches harmless.
 */

export interface SyncDeps {
  prisma: PrismaClient;
  provider: SolanaActivityProvider;
}

export interface SyncWalletOptions {
  maxTransactions: number;
  pageSize?: number;
  /** Pause between provider pages (rate limiting). Tests pass 0. */
  pauseMs?: number;
  /**
   * Wallet-scoped re-sync: delete this wallet's stored events and sync state
   * (under the sync lock) before fetching, so history is re-decoded with the
   * current decoder. Never touches other wallets or the database as a whole.
   */
  resetBeforeSync?: boolean;
}

export interface SyncWalletResult {
  walletId: string;
  address: string;
  status: 'ok' | 'locked' | 'error';
  transactionsProcessed: number;
  eventsCreated: number;
  duplicateEvents: number;
  tokensDiscovered: number;
  backfillComplete: boolean | null;
  /** Events removed by a resetBeforeSync re-sync (0 otherwise). */
  eventsCleared: number;
  error: string | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dedupeKeyFor(walletId: string, event: NormalizedWalletEvent): string {
  return `${walletId}:${event.signature}:${event.eventType}:${event.mint}`;
}

interface TokenCacheEntry {
  id: string;
  lastSeenAt: Date;
}

async function persistEvents(
  prisma: PrismaClient,
  walletId: string,
  events: NormalizedWalletEvent[],
  tokenCache: Map<string, TokenCacheEntry>,
): Promise<{ created: number; duplicates: number; tokensDiscovered: number }> {
  if (events.length === 0) return { created: 0, duplicates: 0, tokensDiscovered: 0 };

  // Ensure a Token row exists for every mint (real mints discovered from activity).
  let tokensDiscovered = 0;
  for (const mint of new Set(events.map((e) => e.mint))) {
    if (tokenCache.has(mint)) continue;
    const existing = await prisma.token.findUnique({ where: { mintAddress: mint } });
    if (existing) {
      tokenCache.set(mint, { id: existing.id, lastSeenAt: existing.lastSeenAt });
    } else {
      const created = await prisma.token.create({
        data: { mintAddress: mint, stage: 'UNCLASSIFIED', source: 'activity' },
      });
      tokensDiscovered += 1;
      tokenCache.set(mint, { id: created.id, lastSeenAt: created.lastSeenAt });
    }
  }

  // Deduplicate: within this batch and against the database.
  const byKey = new Map<string, NormalizedWalletEvent>();
  let duplicates = 0;
  for (const event of events) {
    const key = dedupeKeyFor(walletId, event);
    if (byKey.has(key)) duplicates += 1;
    else byKey.set(key, event);
  }
  const keys = [...byKey.keys()];
  const existingRows = await prisma.walletEvent.findMany({
    where: { dedupeKey: { in: keys } },
    select: { dedupeKey: true },
  });
  const existingKeys = new Set(existingRows.map((r) => r.dedupeKey));
  duplicates += existingKeys.size;

  const toCreate = [...byKey.entries()].filter(([key]) => !existingKeys.has(key));
  if (toCreate.length > 0) {
    await prisma.walletEvent.createMany({
      data: toCreate.map(([key, e]) => ({
        dedupeKey: key,
        walletId,
        tokenId: tokenCache.get(e.mint)!.id,
        signature: e.signature,
        eventType: e.eventType,
        tokenAmount: e.tokenAmount,
        quoteMint: e.quoteMint,
        quoteAmount: e.quoteAmount,
        source: e.source,
        slot: e.slot,
        blockTime: e.timestamp !== null ? new Date(e.timestamp * 1000) : null,
        venue: e.venue,
        confidence: e.confidence,
        explanation: e.explanation,
        swapInMint: e.swapInMint,
        swapInAmount: e.swapInAmount,
        swapOutMint: e.swapOutMint,
        swapOutAmount: e.swapOutAmount,
        walletSolChange: e.breakdown.walletSolChange,
        networkFeeSol: e.breakdown.networkFeeSol,
        priorityFeeSol: e.breakdown.priorityFeeSol,
        platformFeeSol: e.breakdown.platformFeeSol,
        tipSol: e.breakdown.tipSol,
        rentSol: e.breakdown.rentSol,
        unrelatedSolIn: e.breakdown.unrelatedSolIn,
        unrelatedSolOut: e.breakdown.unrelatedSolOut,
        unattributedSol: e.breakdown.unattributedSol,
        decoderVersion: DECODER_VERSION,
      })),
    });
  }

  // Advance token lastSeenAt to the newest activity we saw for each mint.
  const newestByMint = new Map<string, number>();
  for (const e of events) {
    if (e.timestamp === null) continue;
    newestByMint.set(e.mint, Math.max(newestByMint.get(e.mint) ?? 0, e.timestamp));
  }
  for (const [mint, ts] of newestByMint) {
    const cached = tokenCache.get(mint)!;
    const seenAt = new Date(ts * 1000);
    if (seenAt > cached.lastSeenAt) {
      await prisma.token.update({ where: { id: cached.id }, data: { lastSeenAt: seenAt } });
      cached.lastSeenAt = seenAt;
    }
  }

  return { created: toCreate.length, duplicates, tokensDiscovered };
}

export async function syncWallet(
  deps: SyncDeps,
  wallet: { id: string; address: string },
  options: SyncWalletOptions,
): Promise<SyncWalletResult> {
  const base: SyncWalletResult = {
    walletId: wallet.id,
    address: wallet.address,
    status: 'ok',
    transactionsProcessed: 0,
    eventsCreated: 0,
    duplicateEvents: 0,
    tokensDiscovered: 0,
    backfillComplete: null,
    eventsCleared: 0,
    error: null,
  };

  if (!tryAcquireSyncLock(wallet.id)) {
    return { ...base, status: 'locked', error: 'sync_in_progress' };
  }

  const { prisma, provider } = deps;
  try {
    let eventsCleared = 0;
    if (options.resetBeforeSync) {
      // Scoped strictly to this wallet; runs under the sync lock.
      const [deleted] = await prisma.$transaction([
        prisma.walletEvent.deleteMany({ where: { walletId: wallet.id } }),
        prisma.walletSyncState.deleteMany({ where: { walletId: wallet.id } }),
      ]);
      eventsCleared = deleted.count;
      base.eventsCleared = eventsCleared;
    }

    const state = await prisma.walletSyncState.upsert({
      where: { walletId: wallet.id },
      create: { walletId: wallet.id, status: 'syncing' },
      update: { status: 'syncing', lastError: null },
    });

    const isBackfill = !state.backfillComplete;
    const pageSize = Math.min(options.pageSize ?? 100, 100);
    const pauseMs = options.pauseMs ?? 300;

    let before = isBackfill ? (state.oldestSignature ?? undefined) : undefined;
    let processed = 0;
    let created = 0;
    let duplicates = 0;
    let tokensDiscovered = 0;
    let newestSeen: string | null = null;
    let oldestSeen: string | null = isBackfill ? (state.oldestSignature ?? null) : null;
    let reachedEnd = false;
    let reachedKnown = false;
    const tokenCache = new Map<string, TokenCacheEntry>();

    while (processed < options.maxTransactions && !reachedKnown && !reachedEnd) {
      const limit = Math.min(pageSize, options.maxTransactions - processed);
      const txs = await provider.getWalletTransactions(wallet.address, { before, limit });
      if (txs.length === 0) {
        reachedEnd = true;
        break;
      }
      if (newestSeen === null) newestSeen = txs[0].signature;

      const pageEvents: NormalizedWalletEvent[] = [];
      for (const tx of txs) {
        if (!isBackfill && state.newestSignature && tx.signature === state.newestSignature) {
          reachedKnown = true;
          break;
        }
        processed += 1;
        pageEvents.push(...normalizeTransaction(wallet.address, tx));
        before = tx.signature;
        if (isBackfill) oldestSeen = tx.signature;
      }

      const result = await persistEvents(prisma, wallet.id, pageEvents, tokenCache);
      created += result.created;
      duplicates += result.duplicates;
      tokensDiscovered += result.tokensDiscovered;

      if (txs.length < limit) {
        reachedEnd = true;
      } else if (!reachedKnown && processed < options.maxTransactions && pauseMs > 0) {
        await sleep(pauseMs);
      }
    }

    const backfillComplete = isBackfill ? reachedEnd : true;
    await prisma.walletSyncState.update({
      where: { walletId: wallet.id },
      data: {
        status: 'idle',
        lastSyncAt: new Date(),
        lastError: null,
        backfillComplete,
        totalTransactions: { increment: processed },
        totalEvents: { increment: created },
        ...(isBackfill
          ? {
              oldestSignature: oldestSeen,
              // First backfill run pins the tip so later incremental syncs
              // know where "new" begins.
              newestSignature: state.newestSignature ?? newestSeen,
            }
          : { newestSignature: newestSeen ?? state.newestSignature }),
      },
    });

    return {
      ...base,
      transactionsProcessed: processed,
      eventsCreated: created,
      duplicateEvents: duplicates,
      tokensDiscovered,
      backfillComplete,
      eventsCleared,
    };
  } catch (err) {
    // Only sanitized codes are stored/returned — never raw provider messages.
    const code = err instanceof ProviderError ? err.code : 'sync_error';
    await prisma.walletSyncState
      .update({
        where: { walletId: wallet.id },
        data: { status: 'error', lastError: code, lastSyncAt: new Date() },
      })
      .catch(() => {});
    return { ...base, status: 'error', error: code };
  } finally {
    releaseSyncLock(wallet.id);
  }
}
