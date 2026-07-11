import { STABLE_MINTS, WSOL_MINT, type WalletEventType } from '@memecoin-lab/shared';
import type { SolanaTransaction } from '../../providers/solana/types.js';

/**
 * Converts one provider-neutral transaction into zero or more normalized
 * wallet events, from the perspective of a single tracked wallet.
 *
 * Rules (heuristic, documented for later phases):
 * - Failed transactions produce nothing.
 * - wSOL deltas are folded into the native SOL delta; USDC/USDT are treated
 *   as quote currencies. Neither is recorded as a tracked token.
 * - For each remaining mint with a net balance change:
 *     received + (quote spent or provider says SWAP)  -> BUY
 *     received otherwise                              -> TOKEN_TRANSFER_IN
 *     sent + (quote received or provider says SWAP)   -> SELL
 *     sent otherwise                                  -> TOKEN_TRANSFER_OUT
 * - The quote amount is attached only when exactly one token moved in that
 *   direction (otherwise attribution would double-count).
 * - SOL movements below SOL_DUST (fees/rent noise) don't count as quote flow.
 * - Transactions with no token movement (plain SOL transfers, votes, ...) are
 *   ignored — Phase 1B records token activity only.
 */

const SOL_DUST = 0.01;
const STABLE_DUST = 0.01;
const TOKEN_EPSILON = 1e-9;

export interface NormalizedWalletEvent {
  signature: string;
  slot: number | null;
  /** Unix seconds. */
  timestamp: number | null;
  eventType: WalletEventType;
  mint: string;
  tokenAmount: number;
  quoteMint: string | null;
  quoteAmount: number | null;
  source: string | null;
}

export function normalizeTransaction(
  walletAddress: string,
  tx: SolanaTransaction,
): NormalizedWalletEvent[] {
  if (tx.failed) return [];

  // Net token deltas for this wallet.
  const deltas = new Map<string, number>();
  for (const t of tx.tokenTransfers) {
    if (t.toUserAccount === walletAddress) {
      deltas.set(t.mint, (deltas.get(t.mint) ?? 0) + t.tokenAmount);
    }
    if (t.fromUserAccount === walletAddress) {
      deltas.set(t.mint, (deltas.get(t.mint) ?? 0) - t.tokenAmount);
    }
  }

  // Net SOL delta (lamports -> SOL), with wSOL folded in.
  let solDelta = 0;
  for (const n of tx.nativeTransfers) {
    if (n.toUserAccount === walletAddress) solDelta += n.lamports;
    if (n.fromUserAccount === walletAddress) solDelta -= n.lamports;
  }
  solDelta /= 1_000_000_000;
  solDelta += deltas.get(WSOL_MINT) ?? 0;
  deltas.delete(WSOL_MINT);

  // Stablecoin quote flow.
  let stableDelta = 0;
  let stableMint: string | null = null;
  for (const mint of STABLE_MINTS) {
    const d = deltas.get(mint);
    if (d !== undefined) {
      if (Math.abs(d) > TOKEN_EPSILON) {
        stableDelta += d;
        stableMint = mint;
      }
      deltas.delete(mint);
    }
  }

  const moved = [...deltas.entries()].filter(([, d]) => Math.abs(d) > TOKEN_EPSILON);
  if (moved.length === 0) return [];

  const received = moved.filter(([, d]) => d > 0);
  const sent = moved.filter(([, d]) => d < 0);

  const quoteOut =
    solDelta < -SOL_DUST
      ? { mint: 'SOL', amount: -solDelta }
      : stableDelta < -STABLE_DUST && stableMint
        ? { mint: stableMint, amount: -stableDelta }
        : null;
  const quoteIn =
    solDelta > SOL_DUST
      ? { mint: 'SOL', amount: solDelta }
      : stableDelta > STABLE_DUST && stableMint
        ? { mint: stableMint, amount: stableDelta }
        : null;

  const isSwap = tx.type === 'SWAP';
  const events: NormalizedWalletEvent[] = [];

  for (const [mint, delta] of received) {
    const isBuy = quoteOut !== null || isSwap;
    const attachQuote = isBuy && quoteOut !== null && received.length === 1;
    events.push({
      signature: tx.signature,
      slot: tx.slot,
      timestamp: tx.timestamp,
      eventType: isBuy ? 'BUY' : 'TOKEN_TRANSFER_IN',
      mint,
      tokenAmount: delta,
      quoteMint: attachQuote ? quoteOut.mint : null,
      quoteAmount: attachQuote ? quoteOut.amount : null,
      source: tx.source,
    });
  }

  for (const [mint, delta] of sent) {
    const isSell = quoteIn !== null || isSwap;
    const attachQuote = isSell && quoteIn !== null && sent.length === 1;
    events.push({
      signature: tx.signature,
      slot: tx.slot,
      timestamp: tx.timestamp,
      eventType: isSell ? 'SELL' : 'TOKEN_TRANSFER_OUT',
      mint,
      tokenAmount: -delta,
      quoteMint: attachQuote ? quoteIn.mint : null,
      quoteAmount: attachQuote ? quoteIn.amount : null,
      source: tx.source,
    });
  }

  return events;
}
