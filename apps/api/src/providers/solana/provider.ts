import type { SolanaTransaction } from './types.js';

export interface GetTransactionsOptions {
  /** Fetch transactions strictly older than this signature (pagination cursor). */
  before?: string;
  /** Max transactions to return (provider may cap lower). */
  limit?: number;
}

/**
 * Read-only source of historical wallet activity. Implementations must return
 * transactions ordered newest → oldest and throw only ProviderError.
 */
export interface SolanaActivityProvider {
  readonly name: string;
  isConfigured(): boolean;
  getWalletTransactions(
    address: string,
    options?: GetTransactionsOptions,
  ): Promise<SolanaTransaction[]>;
}
