import {
  STABLE_MINTS,
  WSOL_MINT,
  type DecodeConfidence,
  type WalletEventType,
} from '@memecoin-lab/shared';
import type { SolanaSwapEvent, SolanaTransaction } from '../../providers/solana/types.js';
import {
  BASE_FEE_PER_SIGNATURE_LAMPORTS,
  PLATFORM_FEE_ACCOUNTS,
  ROUTER_FEE_MAX_FRACTION,
  ROUTER_FEE_MAX_SOL,
  TIP_ACCOUNTS,
  VENUE_PROGRAMS,
} from './knownAccounts.js';

/**
 * Phase 1C decoder. Three paths, in order:
 *
 * A. PROVIDER-DECODED SWAP (CONFIRMED): the provider shipped a decoded swap
 *    event; amounts come from its exact legs.
 *
 * B. VENUE-INSTRUCTION RECONSTRUCTION (CONFIRMED): no decoded event, but a
 *    known venue program (Pump.fun, Pump AMM, Raydium, ...) was invoked.
 *    Wallet transfers to/from that instruction's accounts ARE the swap legs;
 *    sell proceeds credited directly by the program (no transfer record) are
 *    recovered by exact balance reconciliation. This handles router-mediated
 *    trades (e.g. Axiom → Pump.fun) where the router's own fees/tips must be
 *    excluded from the swap amount.
 *
 * C. HEURISTIC (LIKELY / UNKNOWN): classification from balance movements
 *    only. Quote amounts are NEVER invented here: quote stays null, the exact
 *    wallet SOL change is preserved, and unexplained flow is recorded as
 *    unattributed.
 *
 * Failed transactions and token-free transactions produce no events. Nothing
 * here fabricates amounts, venues, or direction — uncertainty surfaces as
 * null values plus lower confidence.
 */

const LAMPORTS_PER_SOL = 1_000_000_000;
const SOL_DUST = 0.01;
const STABLE_DUST = 0.01;
const TOKEN_EPSILON = 1e-9;

const toSol = (lamports: number) => lamports / LAMPORTS_PER_SOL;
const round9 = (value: number) => Math.round(value * 1e9) / 1e9;
const fmtSol = (value: number) => round9(value).toString();

export interface SolBreakdown {
  walletSolChange: number | null;
  networkFeeSol: number;
  priorityFeeSol: number | null;
  platformFeeSol: number;
  tipSol: number;
  /** Net token-account rent (paid minus refunded on account close). */
  rentSol: number;
  unrelatedSolIn: number;
  unrelatedSolOut: number;
  unattributedSol: number | null;
}

export interface NormalizedWalletEvent {
  signature: string;
  slot: number | null;
  timestamp: number | null;
  eventType: WalletEventType;
  mint: string;
  tokenAmount: number;
  quoteMint: string | null;
  quoteAmount: number | null;
  swapInMint: string | null;
  swapInAmount: number | null;
  swapOutMint: string | null;
  swapOutAmount: number | null;
  source: string | null;
  venue: string | null;
  confidence: DecodeConfidence;
  explanation: string;
  breakdown: SolBreakdown;
}

// ---------------------------------------------------------------------------
// Shared flow accounting
// ---------------------------------------------------------------------------

interface Flows {
  walletChangeL: number | null;
  feeL: number;
  priorityL: number | null;
  tipL: number;
  platformL: number;
  rentL: number;
  rentRefundL: number;
  swapInL: number; // SOL principal the wallet put into the swap
  swapOutL: number; // SOL principal the wallet got out of the swap
  unrelatedInL: number;
  unrelatedOutL: number;
}

function ownTokenAccountsOf(walletAddress: string, tx: SolanaTransaction): Set<string> {
  const own = new Set<string>();
  for (const t of tx.tokenTransfers) {
    if (t.toUserAccount === walletAddress && t.toTokenAccount) own.add(t.toTokenAccount);
    if (t.fromUserAccount === walletAddress && t.fromTokenAccount) own.add(t.fromTokenAccount);
  }
  return own;
}

function walletFeeParts(walletAddress: string, tx: SolanaTransaction) {
  const isFeePayer = tx.feePayer === walletAddress;
  const feeL = isFeePayer && tx.feeLamports !== null ? tx.feeLamports : 0;
  const priorityL =
    isFeePayer && tx.feeLamports !== null
      ? Math.max(0, tx.feeLamports - BASE_FEE_PER_SIGNATURE_LAMPORTS)
      : null;
  return { feeL, priorityL };
}

function walletChangeOf(walletAddress: string, tx: SolanaTransaction): number | null {
  return tx.accountBalanceChanges.find((a) => a.account === walletAddress)?.lamportsChange ?? null;
}

/** Rent refunded to the wallet by closing its own (non-wSOL) token accounts. */
function rentRefundOf(tx: SolanaTransaction, own: Set<string>): number {
  let refund = 0;
  for (const change of tx.accountBalanceChanges) {
    if (own.has(change.account) && change.lamportsChange < 0) refund += -change.lamportsChange;
  }
  return refund;
}

function buildBreakdown(flows: Flows): SolBreakdown {
  let unattributedL: number | null = null;
  if (flows.walletChangeL !== null) {
    const explained =
      flows.swapOutL -
      flows.swapInL -
      flows.feeL -
      flows.tipL -
      flows.platformL -
      (flows.rentL - flows.rentRefundL) -
      flows.unrelatedOutL +
      flows.unrelatedInL;
    unattributedL = flows.walletChangeL - explained;
  }
  return {
    walletSolChange: flows.walletChangeL !== null ? round9(toSol(flows.walletChangeL)) : null,
    networkFeeSol: round9(toSol(flows.feeL)),
    priorityFeeSol: flows.priorityL !== null ? round9(toSol(flows.priorityL)) : null,
    platformFeeSol: round9(toSol(flows.platformL)),
    tipSol: round9(toSol(flows.tipL)),
    rentSol: round9(toSol(flows.rentL - flows.rentRefundL)),
    unrelatedSolIn: round9(toSol(flows.unrelatedInL)),
    unrelatedSolOut: round9(toSol(flows.unrelatedOutL)),
    unattributedSol: unattributedL !== null ? round9(toSol(unattributedL)) : null,
  };
}

function describeBreakdown(b: SolBreakdown): string {
  const parts: string[] = [];
  if (b.networkFeeSol > 0) {
    parts.push(
      `network fee ${fmtSol(b.networkFeeSol)}${
        b.priorityFeeSol !== null && b.priorityFeeSol > 0
          ? ` (priority ${fmtSol(b.priorityFeeSol)})`
          : ''
      }`,
    );
  }
  if (b.platformFeeSol > 0) parts.push(`platform/router fees ${fmtSol(b.platformFeeSol)}`);
  if (b.tipSol > 0) parts.push(`tip ${fmtSol(b.tipSol)}`);
  if (Math.abs(b.rentSol) > TOKEN_EPSILON) parts.push(`token-account rent ${fmtSol(b.rentSol)}`);
  if (b.unrelatedSolOut > 0) parts.push(`unrelated transfers out ${fmtSol(b.unrelatedSolOut)}`);
  if (b.unrelatedSolIn > 0) parts.push(`unrelated transfers in ${fmtSol(b.unrelatedSolIn)}`);
  if (b.unattributedSol !== null && Math.abs(b.unattributedSol) > TOKEN_EPSILON) {
    parts.push(`UNATTRIBUTED ${fmtSol(b.unattributedSol)}`);
  }
  const walletPart =
    b.walletSolChange !== null ? `Wallet SOL change ${fmtSol(b.walletSolChange)}` : null;
  if (!walletPart && parts.length === 0) return '';
  return `${walletPart ?? 'Wallet SOL change unknown'}${
    parts.length > 0 ? `, including ${parts.join(', ')}` : ''
  }.`;
}

/**
 * Classifies the wallet's native transfers into swap principal / tips /
 * platform fees / rent / unrelated. `principalAccounts` are accounts whose
 * transfers count as swap principal (venue-instruction accounts in path B);
 * `principalOutAmount` consumes one exact-amount transfer instead (path A).
 */
function partitionNativeTransfers(
  walletAddress: string,
  tx: SolanaTransaction,
  own: Set<string>,
  opts: {
    principalAccounts?: Set<string>;
    principalOutAmountL?: number;
    principalInAmountL?: number;
    knownFeeLegs?: { account: string; lamports: number }[];
    principalHintL?: number;
  },
) {
  let tipL = 0;
  let platformL = 0;
  let rentL = 0;
  let principalOutL = 0;
  let principalInL = 0;
  const leftoverOut: number[] = [];
  let unrelatedInL = 0;

  let outAmountToConsume = opts.principalOutAmountL ?? 0;
  let inAmountToConsume = opts.principalInAmountL ?? 0;
  const feeLegs = [...(opts.knownFeeLegs ?? [])];

  for (const t of tx.nativeTransfers) {
    const isOut = t.fromUserAccount === walletAddress && t.toUserAccount !== walletAddress;
    const isIn = t.toUserAccount === walletAddress && t.fromUserAccount !== walletAddress;
    if (!isOut && !isIn) continue;

    if (isOut) {
      const to = t.toUserAccount as string;
      if (own.has(to)) {
        rentL += t.lamports; // funding own token accounts (ATA creation/rent)
      } else if (TIP_ACCOUNTS.has(to)) {
        tipL += t.lamports;
      } else if (opts.principalAccounts?.has(to)) {
        principalOutL += t.lamports;
      } else if (outAmountToConsume > 0 && t.lamports === outAmountToConsume) {
        principalOutL += t.lamports;
        outAmountToConsume = 0;
      } else {
        const feeLegIdx = feeLegs.findIndex(
          (f) => f.account === to && f.lamports === t.lamports,
        );
        if (feeLegIdx !== -1) {
          platformL += t.lamports;
          feeLegs.splice(feeLegIdx, 1);
        } else if (PLATFORM_FEE_ACCOUNTS.has(to)) {
          platformL += t.lamports;
        } else {
          leftoverOut.push(t.lamports);
        }
      }
    } else {
      const from = t.fromUserAccount as string;
      if (opts.principalAccounts?.has(from)) {
        principalInL += t.lamports;
      } else if (inAmountToConsume > 0 && t.lamports === inAmountToConsume) {
        principalInL += t.lamports;
        inAmountToConsume = 0;
      } else {
        unrelatedInL += t.lamports;
      }
    }
  }

  // Fee legs decoded inside a swap event but not visible as raw transfers.
  for (const f of feeLegs) platformL += f.lamports;

  // Small leftover outflows during a decoded swap are platform/router fees;
  // large ones are reported as unrelated transfers.
  const principalL = Math.max(opts.principalHintL ?? 0, principalOutL, principalInL);
  const feeCeilingL = Math.max(
    ROUTER_FEE_MAX_SOL * LAMPORTS_PER_SOL,
    ROUTER_FEE_MAX_FRACTION * principalL,
  );
  let unrelatedOutL = 0;
  for (const lamports of leftoverOut) {
    if (lamports <= feeCeilingL) platformL += lamports;
    else unrelatedOutL += lamports;
  }

  return { tipL, platformL, rentL, principalOutL, principalInL, unrelatedInL, unrelatedOutL };
}

// ---------------------------------------------------------------------------
// Token movement (used by paths B and C)
// ---------------------------------------------------------------------------

interface TokenMovement {
  memeDeltas: [string, number][];
  solTransferDelta: number; // SOL from raw transfers (both directions), in SOL
  stableDelta: number;
  wsolInvolved: boolean;
}

function tokenMovementOf(walletAddress: string, tx: SolanaTransaction): TokenMovement {
  const deltas = new Map<string, number>();
  let wsolInvolved = false;
  for (const t of tx.tokenTransfers) {
    if (t.mint === WSOL_MINT && (t.toUserAccount === walletAddress || t.fromUserAccount === walletAddress)) {
      wsolInvolved = true;
    }
    if (t.toUserAccount === walletAddress) {
      deltas.set(t.mint, (deltas.get(t.mint) ?? 0) + t.tokenAmount);
    }
    if (t.fromUserAccount === walletAddress) {
      deltas.set(t.mint, (deltas.get(t.mint) ?? 0) - t.tokenAmount);
    }
  }

  let solTransferDelta = 0;
  for (const n of tx.nativeTransfers) {
    if (n.toUserAccount === walletAddress) solTransferDelta += n.lamports;
    if (n.fromUserAccount === walletAddress) solTransferDelta -= n.lamports;
  }
  solTransferDelta = toSol(solTransferDelta);
  solTransferDelta += deltas.get(WSOL_MINT) ?? 0;
  deltas.delete(WSOL_MINT);

  let stableDelta = 0;
  for (const mint of STABLE_MINTS) {
    const d = deltas.get(mint);
    if (d !== undefined) {
      if (Math.abs(d) > TOKEN_EPSILON) stableDelta += d;
      deltas.delete(mint);
    }
  }

  return {
    memeDeltas: [...deltas.entries()].filter(([, d]) => Math.abs(d) > TOKEN_EPSILON),
    solTransferDelta,
    stableDelta,
    wsolInvolved,
  };
}

// ---------------------------------------------------------------------------
// Path A: provider-decoded swap event
// ---------------------------------------------------------------------------

interface QuoteLeg {
  mint: string;
  amount: number;
}

interface WalletSwapLegs {
  solInSol: number;
  solOutSol: number;
  stableIn: QuoteLeg | null;
  stableOut: QuoteLeg | null;
  memeIn: QuoteLeg[];
  memeOut: QuoteLeg[];
}

function extractWalletSwapLegs(
  walletAddress: string,
  swap: SolanaSwapEvent,
): WalletSwapLegs | null {
  const legs: WalletSwapLegs = {
    solInSol: swap.nativeInput?.account === walletAddress ? toSol(swap.nativeInput.lamports) : 0,
    solOutSol: swap.nativeOutput?.account === walletAddress ? toSol(swap.nativeOutput.lamports) : 0,
    stableIn: null,
    stableOut: null,
    memeIn: [],
    memeOut: [],
  };
  const stableSet = new Set(STABLE_MINTS);
  for (const leg of swap.tokenInputs) {
    if (leg.userAccount !== walletAddress) continue;
    if (leg.mint === WSOL_MINT) legs.solInSol += leg.tokenAmount;
    else if (stableSet.has(leg.mint)) legs.stableIn = { mint: leg.mint, amount: leg.tokenAmount };
    else legs.memeIn.push({ mint: leg.mint, amount: leg.tokenAmount });
  }
  for (const leg of swap.tokenOutputs) {
    if (leg.userAccount !== walletAddress) continue;
    if (leg.mint === WSOL_MINT) legs.solOutSol += leg.tokenAmount;
    else if (stableSet.has(leg.mint)) legs.stableOut = { mint: leg.mint, amount: leg.tokenAmount };
    else legs.memeOut.push({ mint: leg.mint, amount: leg.tokenAmount });
  }
  const involved =
    legs.solInSol > 0 ||
    legs.solOutSol > 0 ||
    legs.stableIn !== null ||
    legs.stableOut !== null ||
    legs.memeIn.length > 0 ||
    legs.memeOut.length > 0;
  return involved ? legs : null;
}

function buildSwapEvents(
  tx: SolanaTransaction,
  venue: string | null,
  breakdown: SolBreakdown,
  legs: {
    memeIn: QuoteLeg[];
    memeOut: QuoteLeg[];
    paidQuote: QuoteLeg | null;
    receivedQuote: QuoteLeg | null;
  },
  how: string,
): NormalizedWalletEvent[] {
  const base = {
    signature: tx.signature,
    slot: tx.slot,
    timestamp: tx.timestamp,
    source: tx.source,
    venue,
    confidence: 'CONFIRMED' as const,
    breakdown,
  };
  const venueLabel = venue ?? tx.source ?? 'unknown venue';
  const routerNote = tx.source && venue && tx.source !== venue ? ` via ${tx.source}` : '';
  const breakdownNote = describeBreakdown(breakdown);
  const label = (q: QuoteLeg) => (q.mint === 'SOL' ? 'SOL' : q.mint);
  const events: NormalizedWalletEvent[] = [];

  for (const out of legs.memeOut) {
    const unambiguous = legs.memeOut.length === 1 && legs.paidQuote !== null;
    const q = legs.paidQuote as QuoteLeg;
    events.push({
      ...base,
      eventType: 'BUY',
      mint: out.mint,
      tokenAmount: out.amount,
      quoteMint: unambiguous ? q.mint : null,
      quoteAmount: unambiguous ? q.amount : null,
      swapInMint: unambiguous ? q.mint : null,
      swapInAmount: unambiguous ? q.amount : null,
      swapOutMint: out.mint,
      swapOutAmount: out.amount,
      explanation: unambiguous
        ? `${how} on ${venueLabel}${routerNote}: swapped exactly ${q.amount} ${label(q)} for exactly ${out.amount} of this token. ${breakdownNote}`.trim()
        : `${how} on ${venueLabel}${routerNote}: received exactly ${out.amount} of this token, but the swap input could not be attributed to a single quote leg, so the quote is left unknown. ${breakdownNote}`.trim(),
    });
  }

  for (const input of legs.memeIn) {
    const unambiguous = legs.memeIn.length === 1 && legs.receivedQuote !== null;
    const q = legs.receivedQuote as QuoteLeg;
    events.push({
      ...base,
      eventType: 'SELL',
      mint: input.mint,
      tokenAmount: input.amount,
      quoteMint: unambiguous ? q.mint : null,
      quoteAmount: unambiguous ? q.amount : null,
      swapInMint: input.mint,
      swapInAmount: input.amount,
      swapOutMint: unambiguous ? q.mint : null,
      swapOutAmount: unambiguous ? q.amount : null,
      explanation: unambiguous
        ? `${how} on ${venueLabel}${routerNote}: swapped exactly ${input.amount} of this token for exactly ${q.amount} ${label(q)}. ${breakdownNote}`.trim()
        : `${how} on ${venueLabel}${routerNote}: spent exactly ${input.amount} of this token, but the swap output could not be attributed to a single quote leg, so the quote is left unknown. ${breakdownNote}`.trim(),
    });
  }

  return events;
}

function decodeFromSwapEvent(
  walletAddress: string,
  tx: SolanaTransaction,
): NormalizedWalletEvent[] | null {
  if (!tx.swap) return null;
  const legs = extractWalletSwapLegs(walletAddress, tx.swap);
  if (!legs || (legs.memeIn.length === 0 && legs.memeOut.length === 0)) return null;

  const own = ownTokenAccountsOf(walletAddress, tx);
  const { feeL, priorityL } = walletFeeParts(walletAddress, tx);
  const part = partitionNativeTransfers(walletAddress, tx, own, {
    principalOutAmountL: Math.round(legs.solInSol * LAMPORTS_PER_SOL),
    principalInAmountL: Math.round(legs.solOutSol * LAMPORTS_PER_SOL),
    knownFeeLegs: tx.swap.nativeFees.map((f) => ({ account: f.account, lamports: f.lamports })),
    principalHintL: Math.round(Math.max(legs.solInSol, legs.solOutSol) * LAMPORTS_PER_SOL),
  });
  const breakdown = buildBreakdown({
    walletChangeL: walletChangeOf(walletAddress, tx),
    feeL,
    priorityL,
    tipL: part.tipL,
    platformL: part.platformL,
    rentL: part.rentL,
    rentRefundL: rentRefundOf(tx, own),
    swapInL: Math.round(legs.solInSol * LAMPORTS_PER_SOL),
    swapOutL: Math.round(legs.solOutSol * LAMPORTS_PER_SOL),
    unrelatedInL: part.unrelatedInL,
    unrelatedOutL: part.unrelatedOutL,
  });

  const venue =
    tx.swap.innerVenues.length > 0 ? tx.swap.innerVenues.join('+') : tx.source;

  const paidQuote: QuoteLeg | null =
    legs.solInSol > 0
      ? { mint: 'SOL', amount: round9(legs.solInSol) }
      : (legs.stableIn ??
        (legs.memeIn.length === 1 && legs.memeOut.length > 0 ? legs.memeIn[0] : null));
  const receivedQuote: QuoteLeg | null =
    legs.solOutSol > 0
      ? { mint: 'SOL', amount: round9(legs.solOutSol) }
      : (legs.stableOut ??
        (legs.memeOut.length === 1 && legs.memeIn.length > 0 ? legs.memeOut[0] : null));

  return buildSwapEvents(
    tx,
    venue,
    breakdown,
    { memeIn: legs.memeIn, memeOut: legs.memeOut, paidQuote, receivedQuote },
    'Decoded swap event',
  );
}

// ---------------------------------------------------------------------------
// Path B: venue-instruction reconstruction (no decoded event)
// ---------------------------------------------------------------------------

function decodeFromVenuePrograms(
  walletAddress: string,
  tx: SolanaTransaction,
): NormalizedWalletEvent[] | null {
  const venueLabels = new Set<string>();
  const venueAccounts = new Set<string>();
  for (const invocation of tx.programInvocations) {
    const label = VENUE_PROGRAMS.get(invocation.programId);
    if (!label) continue;
    venueLabels.add(label);
    for (const account of invocation.accounts) {
      if (account !== walletAddress) venueAccounts.add(account);
    }
  }
  // Require exactly one venue — ambiguous multi-venue routing falls back.
  if (venueLabels.size !== 1 || venueAccounts.size === 0) return null;
  const venue = [...venueLabels][0];

  const movement = tokenMovementOf(walletAddress, tx);
  if (movement.wsolInvolved) return null; // wSOL wrap/unwrap breaks balance identities
  const received = movement.memeDeltas.filter(([, d]) => d > 0);
  const sent = movement.memeDeltas.filter(([, d]) => d < 0);
  // Only unambiguous single-token, single-direction trades decode on this path.
  const isBuy = received.length === 1 && sent.length === 0;
  const isSell = sent.length === 1 && received.length === 0;
  if (!isBuy && !isSell) return null;

  const own = ownTokenAccountsOf(walletAddress, tx);
  const { feeL, priorityL } = walletFeeParts(walletAddress, tx);
  const walletChangeL = walletChangeOf(walletAddress, tx);
  const rentRefundL = rentRefundOf(tx, own);
  const part = partitionNativeTransfers(walletAddress, tx, own, {
    principalAccounts: venueAccounts,
  });

  let swapInL = 0;
  let swapOutL = 0;
  let sellProceedsHow = '';
  if (isBuy) {
    swapInL = part.principalOutL - part.principalInL;
    if (swapInL <= 0) return null; // no observable payment to the venue
  } else {
    if (part.principalInL > 0) {
      swapOutL = part.principalInL;
      sellProceedsHow = 'paid out by direct transfers from the venue';
    } else {
      // Proceeds are credited directly by the program (no transfer record):
      // recover them exactly from the wallet balance identity.
      if (walletChangeL === null) return null;
      let outTotalL = 0;
      let inTotalL = 0;
      for (const t of tx.nativeTransfers) {
        if (t.fromUserAccount === walletAddress && t.toUserAccount !== walletAddress) {
          outTotalL += t.lamports;
        }
        if (t.toUserAccount === walletAddress && t.fromUserAccount !== walletAddress) {
          inTotalL += t.lamports;
        }
      }
      swapOutL = walletChangeL + feeL + outTotalL - inTotalL - rentRefundL;
      if (swapOutL <= 0) return null;
      sellProceedsHow = 'recovered from the exact wallet balance change';
    }
  }

  // Re-run leftover classification with the real principal as the fee ceiling.
  const partFinal = partitionNativeTransfers(walletAddress, tx, own, {
    principalAccounts: venueAccounts,
    principalHintL: Math.max(swapInL, swapOutL),
  });

  const breakdown = buildBreakdown({
    walletChangeL,
    feeL,
    priorityL,
    tipL: partFinal.tipL,
    platformL: partFinal.platformL,
    rentL: partFinal.rentL,
    rentRefundL,
    swapInL,
    swapOutL,
    unrelatedInL: partFinal.unrelatedInL,
    unrelatedOutL: partFinal.unrelatedOutL,
  });

  if (isBuy) {
    const [mint, delta] = received[0];
    return buildSwapEvents(
      tx,
      venue,
      breakdown,
      {
        memeIn: [],
        memeOut: [{ mint, amount: delta }],
        paidQuote: { mint: 'SOL', amount: round9(toSol(swapInL)) },
        receivedQuote: null,
      },
      'Reconstructed from venue instruction transfers',
    );
  }
  const [mint, delta] = sent[0];
  return buildSwapEvents(
    tx,
    venue,
    breakdown,
    {
      memeIn: [{ mint, amount: -delta }],
      memeOut: [],
      paidQuote: null,
      receivedQuote: { mint: 'SOL', amount: round9(toSol(swapOutL)) },
    },
    `Reconstructed from venue instruction transfers (proceeds ${sellProceedsHow})`,
  );
}

// ---------------------------------------------------------------------------
// Path C: heuristic — quotes are never invented here
// ---------------------------------------------------------------------------

function heuristicEvents(
  walletAddress: string,
  tx: SolanaTransaction,
): NormalizedWalletEvent[] {
  const movement = tokenMovementOf(walletAddress, tx);
  if (movement.memeDeltas.length === 0) return [];

  const own = ownTokenAccountsOf(walletAddress, tx);
  const { feeL, priorityL } = walletFeeParts(walletAddress, tx);
  // No decoded swap: leftover transfers may BE the undecoded swap payment, so
  // nothing is classified as platform/unrelated — the residue is unattributed.
  const part = partitionNativeTransfers(walletAddress, tx, own, {});
  const breakdown = buildBreakdown({
    walletChangeL: walletChangeOf(walletAddress, tx),
    feeL,
    priorityL,
    tipL: part.tipL,
    platformL: 0,
    rentL: part.rentL,
    rentRefundL: rentRefundOf(tx, own),
    swapInL: 0,
    swapOutL: 0,
    unrelatedInL: 0,
    unrelatedOutL: 0,
  });

  const received = movement.memeDeltas.filter(([, d]) => d > 0);
  const sent = movement.memeDeltas.filter(([, d]) => d < 0);
  const quoteOutSignal =
    movement.solTransferDelta < -SOL_DUST || movement.stableDelta < -STABLE_DUST;
  const quoteInSignal =
    movement.solTransferDelta > SOL_DUST || movement.stableDelta > STABLE_DUST;
  const isSwapLabeled = tx.type === 'SWAP';
  const bothDirections = received.length > 0 && sent.length > 0;

  const base = {
    signature: tx.signature,
    slot: tx.slot,
    timestamp: tx.timestamp,
    source: tx.source,
    venue: null,
    quoteMint: null,
    quoteAmount: null,
    swapInMint: null,
    swapInAmount: null,
    swapOutMint: null,
    swapOutAmount: null,
    breakdown,
  };
  const breakdownNote = describeBreakdown(breakdown);
  const events: NormalizedWalletEvent[] = [];

  for (const [mint, delta] of received) {
    let eventType: WalletEventType;
    let confidence: DecodeConfidence;
    let why: string;
    if (bothDirections) {
      eventType = isSwapLabeled ? 'BUY' : 'TOKEN_TRANSFER_IN';
      confidence = 'UNKNOWN';
      why = isSwapLabeled
        ? 'Provider labeled this a SWAP and tokens moved in both directions, but nothing decodable was available — treated as a probable token-to-token trade with unknown amounts.'
        : 'Tokens moved in both directions with nothing decodable and no SWAP label — direction of value exchange is unknown.';
    } else if (quoteOutSignal || isSwapLabeled) {
      eventType = 'BUY';
      confidence = 'LIKELY';
      why = `Received tokens while ${
        quoteOutSignal ? 'SOL/stablecoins left the wallet' : 'the provider labeled the transaction a SWAP'
      }, but the swap could not be decoded — classified as a buy with the exact price unknown (total outflow is NOT a reliable swap input).`;
    } else {
      eventType = 'TOKEN_TRANSFER_IN';
      confidence = 'CONFIRMED';
      why = 'Received tokens with no corresponding SOL/stablecoin payment — a plain incoming token transfer, not a trade.';
    }
    events.push({
      ...base,
      eventType,
      confidence,
      mint,
      tokenAmount: delta,
      explanation: `${why} ${breakdownNote}`.trim(),
    });
  }

  for (const [mint, delta] of sent) {
    let eventType: WalletEventType;
    let confidence: DecodeConfidence;
    let why: string;
    if (bothDirections) {
      eventType = isSwapLabeled ? 'SELL' : 'TOKEN_TRANSFER_OUT';
      confidence = 'UNKNOWN';
      why = isSwapLabeled
        ? 'Provider labeled this a SWAP and tokens moved in both directions, but nothing decodable was available — treated as a probable token-to-token trade with unknown amounts.'
        : 'Tokens moved in both directions with nothing decodable and no SWAP label — direction of value exchange is unknown.';
    } else if (quoteInSignal || isSwapLabeled) {
      eventType = 'SELL';
      confidence = 'LIKELY';
      why = `Sent tokens while ${
        quoteInSignal ? 'SOL/stablecoins entered the wallet' : 'the provider labeled the transaction a SWAP'
      }, but the swap could not be decoded — classified as a sell with the exact proceeds unknown (total inflow is NOT a reliable swap output).`;
    } else {
      eventType = 'TOKEN_TRANSFER_OUT';
      confidence = 'CONFIRMED';
      why = 'Sent tokens with no corresponding SOL/stablecoin proceeds — a plain outgoing token transfer, not a trade.';
    }
    events.push({
      ...base,
      eventType,
      confidence,
      mint,
      tokenAmount: -delta,
      explanation: `${why} ${breakdownNote}`.trim(),
    });
  }

  return events;
}

// ---------------------------------------------------------------------------

export function normalizeTransaction(
  walletAddress: string,
  tx: SolanaTransaction,
): NormalizedWalletEvent[] {
  if (tx.failed) return [];
  return (
    decodeFromSwapEvent(walletAddress, tx) ??
    decodeFromVenuePrograms(walletAddress, tx) ??
    heuristicEvents(walletAddress, tx)
  );
}
