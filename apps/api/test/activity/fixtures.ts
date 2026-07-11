// Fixture builders for activity tests. All addresses/mints/signatures are
// invented — never real wallet data. Decoded-swap builders mirror the shape
// of real provider payloads (exact swap legs + fee/tip/rent side flows).
import { syntheticAddress } from '@memecoin-lab/shared';
import type {
  GetTransactionsOptions,
  SolanaActivityProvider,
} from '../../src/providers/solana/provider.js';
import type {
  SolanaNativeTransfer,
  SolanaSwapEvent,
  SolanaTransaction,
} from '../../src/providers/solana/types.js';
import {
  PLATFORM_FEE_ACCOUNTS,
  TIP_ACCOUNTS,
  TOKEN_ACCOUNT_RENT_LAMPORTS,
} from '../../src/services/activity/knownAccounts.js';

export const OTHER_PARTY = syntheticAddress(240);
export const POOL_ACCOUNT = syntheticAddress(241);
export const WALLET_ATA = syntheticAddress(242); // the wallet's own token account
export const POOL_ATA = syntheticAddress(243);
export const KNOWN_PLATFORM_FEE_ACCOUNT = [...PLATFORM_FEE_ACCOUNTS][0];
export const KNOWN_TIP_ACCOUNT = [...TIP_ACCOUNTS][0];

// Real, public program IDs (must match the knownAccounts registry).
export const PUMP_FUN_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
export const PUMP_FEE_PROGRAM = 'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ';
// Synthetic router program (NOT in the venue registry, like Axiom's router).
export const ROUTER_PROGRAM = syntheticAddress(244);

const L = (sol: number) => Math.round(sol * 1_000_000_000);

let signatureCounter = 0;
export function nextSignature(prefix = 'sig'): string {
  signatureCounter += 1;
  return `${prefix}-${signatureCounter.toString().padStart(6, '0')}`;
}

interface BaseTxOptions {
  signature?: string;
  timestamp?: number;
  slot?: number;
  source?: string;
  feeLamports?: number;
  feePayer?: string;
}

export interface DecodedSwapOptions extends BaseTxOptions {
  tokenAmount?: number;
  solAmount?: number;
  innerVenues?: string[];
  platformFeeSol?: number;
  /** Defaults to a known Pump.fun fee account; override to simulate unknown routers. */
  platformFeeAccount?: string;
  tipSol?: number;
  rentLamports?: number;
  unrelatedOutSol?: number;
  unrelatedInSol?: number;
  /** Omit accountData (wallet balance change unknown). */
  omitAccountData?: boolean;
}

function baseTx(wallet: string, o: BaseTxOptions) {
  return {
    signature: o.signature ?? nextSignature(),
    slot: o.slot ?? 1000,
    timestamp: o.timestamp ?? 1_750_000_000,
    failed: false,
    feeLamports: o.feeLamports ?? 5000,
    feePayer: o.feePayer ?? wallet,
  };
}

/**
 * Decoded swap buy: wallet swaps exactly `solAmount` SOL for `tokenAmount` of
 * `mint`, with optional platform fee / tip / ATA rent / unrelated transfers
 * layered on top (all reflected in the wallet's exact balance change).
 */
export function swapBuyTx(
  wallet: string,
  mint: string,
  o: DecodedSwapOptions = {},
): SolanaTransaction {
  const solIn = o.solAmount ?? 1.5;
  const tokenOut = o.tokenAmount ?? 100_000;
  const platformFee = o.platformFeeSol ?? 0;
  const platformAccount = o.platformFeeAccount ?? KNOWN_PLATFORM_FEE_ACCOUNT;
  const tip = o.tipSol ?? 0;
  const rentL = o.rentLamports ?? 0;
  const unrelatedOut = o.unrelatedOutSol ?? 0;
  const unrelatedIn = o.unrelatedInSol ?? 0;
  const base = baseTx(wallet, o);

  const nativeTransfers: SolanaNativeTransfer[] = [
    { fromUserAccount: wallet, toUserAccount: POOL_ACCOUNT, lamports: L(solIn) },
  ];
  if (platformFee > 0) {
    nativeTransfers.push({
      fromUserAccount: wallet,
      toUserAccount: platformAccount,
      lamports: L(platformFee),
    });
  }
  if (tip > 0) {
    nativeTransfers.push({
      fromUserAccount: wallet,
      toUserAccount: KNOWN_TIP_ACCOUNT,
      lamports: L(tip),
    });
  }
  if (unrelatedOut > 0) {
    nativeTransfers.push({
      fromUserAccount: wallet,
      toUserAccount: OTHER_PARTY,
      lamports: L(unrelatedOut),
    });
  }
  if (unrelatedIn > 0) {
    nativeTransfers.push({
      fromUserAccount: OTHER_PARTY,
      toUserAccount: wallet,
      lamports: L(unrelatedIn),
    });
  }
  if (rentL > 0) {
    // ATA creation: the wallet funds its own token account rent-exempt.
    nativeTransfers.push({ fromUserAccount: wallet, toUserAccount: WALLET_ATA, lamports: rentL });
  }

  const swap: SolanaSwapEvent = {
    nativeInput: { account: wallet, lamports: L(solIn) },
    nativeOutput: null,
    tokenInputs: [],
    tokenOutputs: [{ userAccount: wallet, mint, tokenAmount: tokenOut }],
    nativeFees:
      platformFee > 0 ? [{ account: platformAccount, lamports: L(platformFee) }] : [],
    tokenFees: [],
    innerVenues: o.innerVenues ?? [],
  };

  const walletChange =
    -L(solIn) -
    base.feeLamports -
    L(platformFee) -
    L(tip) -
    rentL -
    L(unrelatedOut) +
    L(unrelatedIn);

  return {
    ...base,
    type: 'SWAP',
    source: o.source ?? 'PUMP_FUN',
    tokenTransfers: [
      {
        mint,
        fromUserAccount: POOL_ACCOUNT,
        toUserAccount: wallet,
        fromTokenAccount: POOL_ATA,
        toTokenAccount: WALLET_ATA,
        tokenAmount: tokenOut,
      },
    ],
    nativeTransfers,
    accountBalanceChanges: o.omitAccountData
      ? []
      : [
          { account: wallet, lamportsChange: walletChange },
          ...(rentL > 0 ? [{ account: WALLET_ATA, lamportsChange: rentL }] : []),
        ],
    swap,
    programInvocations: [],
  };
}

/** Decoded swap sell: wallet swaps `tokenAmount` of `mint` for exactly `solAmount` SOL. */
export function swapSellTx(
  wallet: string,
  mint: string,
  o: DecodedSwapOptions = {},
): SolanaTransaction {
  const solOut = o.solAmount ?? 2.25;
  const tokenIn = o.tokenAmount ?? 100_000;
  const platformFee = o.platformFeeSol ?? 0;
  const platformAccount = o.platformFeeAccount ?? KNOWN_PLATFORM_FEE_ACCOUNT;
  const base = baseTx(wallet, o);

  const nativeTransfers: SolanaNativeTransfer[] = [
    { fromUserAccount: POOL_ACCOUNT, toUserAccount: wallet, lamports: L(solOut) },
  ];
  if (platformFee > 0) {
    nativeTransfers.push({
      fromUserAccount: wallet,
      toUserAccount: platformAccount,
      lamports: L(platformFee),
    });
  }

  const swap: SolanaSwapEvent = {
    nativeInput: null,
    nativeOutput: { account: wallet, lamports: L(solOut) },
    tokenInputs: [{ userAccount: wallet, mint, tokenAmount: tokenIn }],
    tokenOutputs: [],
    nativeFees:
      platformFee > 0 ? [{ account: platformAccount, lamports: L(platformFee) }] : [],
    tokenFees: [],
    innerVenues: o.innerVenues ?? [],
  };

  const walletChange = L(solOut) - base.feeLamports - L(platformFee);

  return {
    ...base,
    type: 'SWAP',
    source: o.source ?? 'RAYDIUM',
    tokenTransfers: [
      {
        mint,
        fromUserAccount: wallet,
        toUserAccount: POOL_ACCOUNT,
        fromTokenAccount: WALLET_ATA,
        toTokenAccount: POOL_ATA,
        tokenAmount: tokenIn,
      },
    ],
    nativeTransfers,
    accountBalanceChanges: o.omitAccountData
      ? []
      : [{ account: wallet, lamportsChange: walletChange }],
    swap,
    programInvocations: [],
  };
}

/** Decoded token→token swap (e.g. Jupiter routing through an AMM). */
export function tokenToTokenSwapTx(
  wallet: string,
  mintIn: string,
  mintOut: string,
  o: BaseTxOptions & { amountIn?: number; amountOut?: number; innerVenues?: string[] } = {},
): SolanaTransaction {
  const amountIn = o.amountIn ?? 1234;
  const amountOut = o.amountOut ?? 9999;
  const base = baseTx(wallet, o);
  return {
    ...base,
    type: 'SWAP',
    source: o.source ?? 'JUPITER',
    tokenTransfers: [
      { mint: mintIn, fromUserAccount: wallet, toUserAccount: POOL_ACCOUNT, tokenAmount: amountIn },
      { mint: mintOut, fromUserAccount: POOL_ACCOUNT, toUserAccount: wallet, tokenAmount: amountOut },
    ],
    nativeTransfers: [],
    accountBalanceChanges: [{ account: wallet, lamportsChange: -base.feeLamports }],
    swap: {
      nativeInput: null,
      nativeOutput: null,
      tokenInputs: [{ userAccount: wallet, mint: mintIn, tokenAmount: amountIn }],
      tokenOutputs: [{ userAccount: wallet, mint: mintOut, tokenAmount: amountOut }],
      nativeFees: [],
      tokenFees: [],
      innerVenues: o.innerVenues ?? ['RAYDIUM'],
    },
    programInvocations: [],
  };
}

export interface PumpRouterBuyOptions extends BaseTxOptions {
  tokenAmount?: number;
  /** SOL paid to the bonding curve itself. */
  curveSol?: number;
  /** Fee legs paid to accounts inside the venue instruction (part of swap input). */
  venueFeeSols?: number[];
  /** Router fees paid outside the venue instruction (e.g. Axiom fee + tip vault). */
  routerFeeSols?: number[];
  rentLamports?: number;
}

/**
 * Mirrors the real router-mediated Pump.fun buy that exposed the quote bug:
 * NO decoded swap event; the Pump.fun program runs as an inner instruction of
 * an unknown router; swap input = wallet transfers to venue-instruction
 * accounts; router fees and own-ATA rent sit outside it.
 */
export function pumpRouterBuyTx(
  wallet: string,
  mint: string,
  o: PumpRouterBuyOptions = {},
): SolanaTransaction {
  const curveSol = o.curveSol ?? 1.49205632;
  const venueFeeSols = o.venueFeeSols ?? [];
  const routerFeeSols = o.routerFeeSols ?? [];
  const rentL = o.rentLamports ?? 0;
  const tokenOut = o.tokenAmount ?? 1_000_000;
  const base = baseTx(wallet, { feeLamports: 307_000, ...o });

  const curve = syntheticAddress(245);
  const venueFeeAccounts = venueFeeSols.map((_, i) => syntheticAddress(246 + i));
  const routerFeeAccounts = routerFeeSols.map((_, i) => syntheticAddress(250 + i));

  const nativeTransfers: SolanaNativeTransfer[] = [
    { fromUserAccount: wallet, toUserAccount: curve, lamports: L(curveSol) },
    ...venueFeeSols.map((sol, i) => ({
      fromUserAccount: wallet,
      toUserAccount: venueFeeAccounts[i],
      lamports: L(sol),
    })),
    ...routerFeeSols.map((sol, i) => ({
      fromUserAccount: wallet,
      toUserAccount: routerFeeAccounts[i],
      lamports: L(sol),
    })),
  ];
  if (rentL > 0) {
    nativeTransfers.push({ fromUserAccount: wallet, toUserAccount: WALLET_ATA, lamports: rentL });
  }

  const walletChange =
    -L(curveSol) -
    venueFeeSols.reduce((sum, sol) => sum + L(sol), 0) -
    routerFeeSols.reduce((sum, sol) => sum + L(sol), 0) -
    rentL -
    base.feeLamports;

  return {
    ...base,
    type: 'SWAP',
    source: o.source ?? 'PUMP_FUN',
    tokenTransfers: [
      {
        mint,
        fromUserAccount: curve,
        toUserAccount: wallet,
        fromTokenAccount: POOL_ATA,
        toTokenAccount: WALLET_ATA,
        tokenAmount: tokenOut,
      },
    ],
    nativeTransfers,
    accountBalanceChanges: [
      { account: wallet, lamportsChange: walletChange },
      ...(rentL > 0 ? [{ account: WALLET_ATA, lamportsChange: rentL }] : []),
    ],
    swap: null,
    programInvocations: [
      // Router wrapper (unknown program — its accounts must NOT count as venue).
      { programId: ROUTER_PROGRAM, accounts: [wallet, curve, mint, ...routerFeeAccounts] },
      // The venue instruction: its accounts define the swap principal.
      {
        programId: PUMP_FUN_PROGRAM,
        accounts: [curve, POOL_ATA, WALLET_ATA, wallet, mint, ...venueFeeAccounts.slice(0, 2)],
      },
      // Pump fee helper program carrying any remaining fee accounts.
      ...(venueFeeAccounts.length > 2
        ? [{ programId: PUMP_FEE_PROGRAM, accounts: [wallet, ...venueFeeAccounts.slice(2)] }]
        : []),
    ],
  };
}

export interface PumpRouterSellOptions extends BaseTxOptions {
  tokenAmount?: number;
  /** Exact SOL the venue program credits to the wallet (no transfer record). */
  proceedsSol?: number;
  routerFeeSols?: number[];
  /** Rent refunded by closing the wallet's ATA in the same transaction. */
  closeAtaRefundLamports?: number;
}

/**
 * Mirrors the real router-mediated Pump.fun sell: proceeds are credited by
 * direct program lamport transfer (absent from nativeTransfers) and must be
 * recovered from the exact wallet balance change.
 */
export function pumpRouterSellTx(
  wallet: string,
  mint: string,
  o: PumpRouterSellOptions = {},
): SolanaTransaction {
  const proceeds = o.proceedsSol ?? 1.000449718;
  const routerFeeSols = o.routerFeeSols ?? [];
  const refundL = o.closeAtaRefundLamports ?? 0;
  const tokenIn = o.tokenAmount ?? 1_000_000;
  const base = baseTx(wallet, { feeLamports: 364_039, ...o });

  const curve = syntheticAddress(245);
  const routerFeeAccounts = routerFeeSols.map((_, i) => syntheticAddress(250 + i));

  const walletChange =
    L(proceeds) -
    routerFeeSols.reduce((sum, sol) => sum + L(sol), 0) -
    base.feeLamports +
    refundL;

  return {
    ...base,
    type: 'SWAP',
    source: o.source ?? 'PUMP_FUN',
    tokenTransfers: [
      {
        mint,
        fromUserAccount: wallet,
        toUserAccount: curve,
        fromTokenAccount: WALLET_ATA,
        toTokenAccount: POOL_ATA,
        tokenAmount: tokenIn,
      },
    ],
    nativeTransfers: routerFeeSols.map((sol, i) => ({
      fromUserAccount: wallet,
      toUserAccount: routerFeeAccounts[i],
      lamports: L(sol),
    })),
    accountBalanceChanges: [
      { account: wallet, lamportsChange: walletChange },
      ...(refundL > 0 ? [{ account: WALLET_ATA, lamportsChange: -refundL }] : []),
    ],
    swap: null,
    programInvocations: [
      { programId: ROUTER_PROGRAM, accounts: [wallet, curve, mint, ...routerFeeAccounts] },
      { programId: PUMP_FUN_PROGRAM, accounts: [curve, POOL_ATA, WALLET_ATA, wallet, mint] },
    ],
  };
}

/**
 * SWAP-labeled transaction WITHOUT a decoded swap event — the case that used
 * to produce invented quotes. SOL leaves the wallet and tokens arrive, but the
 * exact swap input is unknown.
 */
export function heuristicBuyTx(
  wallet: string,
  mint: string,
  o: BaseTxOptions & { tokenAmount?: number; solAmount?: number } = {},
): SolanaTransaction {
  const sol = o.solAmount ?? 1.5;
  const tokenOut = o.tokenAmount ?? 100_000;
  const base = baseTx(wallet, o);
  return {
    ...base,
    type: 'SWAP',
    source: o.source ?? 'UNKNOWN',
    tokenTransfers: [
      { mint, fromUserAccount: POOL_ACCOUNT, toUserAccount: wallet, tokenAmount: tokenOut },
    ],
    nativeTransfers: [
      { fromUserAccount: wallet, toUserAccount: POOL_ACCOUNT, lamports: L(sol) },
    ],
    accountBalanceChanges: [{ account: wallet, lamportsChange: -L(sol) - base.feeLamports }],
    swap: null,
    programInvocations: [],
  };
}

/** Plain token transfer into the wallet (no payment, no swap). */
export function tokenTransferInTx(
  wallet: string,
  mint: string,
  o: BaseTxOptions & { tokenAmount?: number } = {},
): SolanaTransaction {
  const base = baseTx(wallet, { feePayer: OTHER_PARTY, ...o });
  return {
    ...base,
    type: 'TRANSFER',
    source: o.source ?? 'SYSTEM_PROGRAM',
    tokenTransfers: [
      {
        mint,
        fromUserAccount: OTHER_PARTY,
        toUserAccount: wallet,
        tokenAmount: o.tokenAmount ?? 500,
      },
    ],
    nativeTransfers: [],
    accountBalanceChanges: [{ account: wallet, lamportsChange: 0 }],
    swap: null,
    programInvocations: [],
  };
}

/** Plain SOL transfer — produces no wallet events (no token movement). */
export function solOnlyTx(wallet: string, o: BaseTxOptions = {}): SolanaTransaction {
  const base = baseTx(wallet, o);
  return {
    ...base,
    type: 'TRANSFER',
    source: o.source ?? 'SYSTEM_PROGRAM',
    tokenTransfers: [],
    nativeTransfers: [
      { fromUserAccount: wallet, toUserAccount: OTHER_PARTY, lamports: 50_000_000 },
    ],
    accountBalanceChanges: [
      { account: wallet, lamportsChange: -50_000_000 - base.feeLamports },
    ],
    swap: null,
    programInvocations: [],
  };
}

export { TOKEN_ACCOUNT_RENT_LAMPORTS };

/**
 * Fake provider that emulates signature-cursor pagination over a fixed,
 * newest-first history per address. Records every call for assertions.
 */
export class FakeProvider implements SolanaActivityProvider {
  readonly name = 'fake';
  readonly calls: { address: string; before?: string; limit?: number }[] = [];

  constructor(
    private history: Record<string, SolanaTransaction[]>,
    private configured = true,
  ) {}

  isConfigured(): boolean {
    return this.configured;
  }

  /** Prepend new (more recent) transactions to an address's history. */
  addNewest(address: string, txs: SolanaTransaction[]): void {
    this.history[address] = [...txs, ...(this.history[address] ?? [])];
  }

  async getWalletTransactions(
    address: string,
    options: GetTransactionsOptions = {},
  ): Promise<SolanaTransaction[]> {
    this.calls.push({ address, before: options.before, limit: options.limit });
    const txs = this.history[address] ?? [];
    const limit = options.limit ?? 100;
    let start = 0;
    if (options.before) {
      const idx = txs.findIndex((t) => t.signature === options.before);
      start = idx === -1 ? txs.length : idx + 1;
    }
    return txs.slice(start, start + limit);
  }
}
