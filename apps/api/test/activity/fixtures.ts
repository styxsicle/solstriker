// Fixture builders for activity tests. All addresses/mints/signatures are
// invented — never real wallet data.
import { syntheticAddress } from '@memecoin-lab/shared';
import type { GetTransactionsOptions, SolanaActivityProvider } from '../../src/providers/solana/provider.js';
import type { SolanaTransaction } from '../../src/providers/solana/types.js';

export const OTHER_PARTY = syntheticAddress(240);

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
}

const baseDefaults = (o: BaseTxOptions) => ({
  signature: o.signature ?? nextSignature(),
  slot: o.slot ?? 1000,
  timestamp: o.timestamp ?? 1_750_000_000,
  failed: false,
});

/** Wallet spends SOL, receives `tokenAmount` of `mint` (a swap buy). */
export function swapBuyTx(
  wallet: string,
  mint: string,
  opts: BaseTxOptions & { tokenAmount?: number; solAmount?: number } = {},
): SolanaTransaction {
  return {
    ...baseDefaults(opts),
    type: 'SWAP',
    source: opts.source ?? 'PUMP_FUN',
    tokenTransfers: [
      {
        mint,
        fromUserAccount: OTHER_PARTY,
        toUserAccount: wallet,
        tokenAmount: opts.tokenAmount ?? 100_000,
      },
    ],
    nativeTransfers: [
      {
        fromUserAccount: wallet,
        toUserAccount: OTHER_PARTY,
        lamports: Math.round((opts.solAmount ?? 1.5) * 1_000_000_000),
      },
    ],
  };
}

/** Wallet sends `mint`, receives SOL (a swap sell). */
export function swapSellTx(
  wallet: string,
  mint: string,
  opts: BaseTxOptions & { tokenAmount?: number; solAmount?: number } = {},
): SolanaTransaction {
  return {
    ...baseDefaults(opts),
    type: 'SWAP',
    source: opts.source ?? 'RAYDIUM',
    tokenTransfers: [
      {
        mint,
        fromUserAccount: wallet,
        toUserAccount: OTHER_PARTY,
        tokenAmount: opts.tokenAmount ?? 100_000,
      },
    ],
    nativeTransfers: [
      {
        fromUserAccount: OTHER_PARTY,
        toUserAccount: wallet,
        lamports: Math.round((opts.solAmount ?? 2.25) * 1_000_000_000),
      },
    ],
  };
}

/** Plain token transfer into the wallet (no meaningful SOL movement). */
export function tokenTransferInTx(
  wallet: string,
  mint: string,
  opts: BaseTxOptions & { tokenAmount?: number } = {},
): SolanaTransaction {
  return {
    ...baseDefaults(opts),
    type: 'TRANSFER',
    source: opts.source ?? 'SYSTEM_PROGRAM',
    tokenTransfers: [
      {
        mint,
        fromUserAccount: OTHER_PARTY,
        toUserAccount: wallet,
        tokenAmount: opts.tokenAmount ?? 500,
      },
    ],
    nativeTransfers: [],
  };
}

/** Plain SOL transfer — produces no wallet events (no token movement). */
export function solOnlyTx(wallet: string, opts: BaseTxOptions = {}): SolanaTransaction {
  return {
    ...baseDefaults(opts),
    type: 'TRANSFER',
    source: opts.source ?? 'SYSTEM_PROGRAM',
    tokenTransfers: [],
    nativeTransfers: [
      { fromUserAccount: wallet, toUserAccount: OTHER_PARTY, lamports: 50_000_000 },
    ],
  };
}

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
