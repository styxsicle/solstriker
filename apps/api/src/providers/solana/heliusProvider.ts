import type { GetTransactionsOptions, SolanaActivityProvider } from './provider.js';
import {
  ProviderError,
  type SolanaNativeTransfer,
  type SolanaTokenTransfer,
  type SolanaTransaction,
} from './types.js';

/**
 * Helius Enhanced Transactions API provider.
 *
 * The API key and request URLs exist only inside this closure. Every failure
 * is converted to a ProviderError with a generic message so nothing that
 * could contain the key ever propagates.
 */

const PAGE_LIMIT_MAX = 100;

export interface HeliusProviderOptions {
  apiKey?: string;
  cluster: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

interface RawHeliusTokenTransfer {
  mint?: unknown;
  fromUserAccount?: unknown;
  toUserAccount?: unknown;
  tokenAmount?: unknown;
}

interface RawHeliusNativeTransfer {
  fromUserAccount?: unknown;
  toUserAccount?: unknown;
  amount?: unknown;
}

interface RawHeliusTransaction {
  signature?: unknown;
  slot?: unknown;
  timestamp?: unknown;
  type?: unknown;
  source?: unknown;
  transactionError?: unknown;
  tokenTransfers?: RawHeliusTokenTransfer[];
  nativeTransfers?: RawHeliusNativeTransfer[];
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function mapTransaction(raw: RawHeliusTransaction): SolanaTransaction | null {
  const signature = asString(raw.signature);
  if (!signature) return null;

  const tokenTransfers: SolanaTokenTransfer[] = (raw.tokenTransfers ?? [])
    .map((t) => ({
      mint: asString(t.mint) ?? '',
      fromUserAccount: asString(t.fromUserAccount),
      toUserAccount: asString(t.toUserAccount),
      tokenAmount: asNumber(t.tokenAmount) ?? Number(t.tokenAmount ?? NaN),
    }))
    .filter((t) => t.mint !== '' && Number.isFinite(t.tokenAmount));

  const nativeTransfers: SolanaNativeTransfer[] = (raw.nativeTransfers ?? [])
    .map((n) => ({
      fromUserAccount: asString(n.fromUserAccount),
      toUserAccount: asString(n.toUserAccount),
      lamports: asNumber(n.amount) ?? NaN,
    }))
    .filter((n) => Number.isFinite(n.lamports));

  return {
    signature,
    slot: asNumber(raw.slot),
    timestamp: asNumber(raw.timestamp),
    type: asString(raw.type),
    source: asString(raw.source),
    failed: raw.transactionError !== null && raw.transactionError !== undefined,
    tokenTransfers,
    nativeTransfers,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createHeliusProvider(options: HeliusProviderOptions): SolanaActivityProvider {
  const apiKey = options.apiKey?.trim() || undefined;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxRetries = options.maxRetries ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 500;
  const host =
    options.cluster === 'devnet' ? 'https://api-devnet.helius.xyz' : 'https://api.helius.xyz';

  async function getWalletTransactions(
    address: string,
    opts: GetTransactionsOptions = {},
  ): Promise<SolanaTransaction[]> {
    if (!apiKey) throw new ProviderError('not_configured');

    const limit = Math.min(Math.max(opts.limit ?? PAGE_LIMIT_MAX, 1), PAGE_LIMIT_MAX);
    const params = new URLSearchParams({ 'api-key': apiKey, limit: String(limit) });
    if (opts.before) params.set('before', opts.before);
    const url = `${host}/v0/addresses/${address}/transactions?${params.toString()}`;

    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
      } catch {
        // Network/timeout errors may embed the URL — replace them entirely.
        if (attempt < maxRetries) {
          await sleep(retryDelayMs * (attempt + 1));
          continue;
        }
        throw new ProviderError('provider_error', 'network error contacting activity provider');
      }

      if (res.status === 429 || res.status >= 500) {
        if (attempt < maxRetries) {
          await sleep(retryDelayMs * (attempt + 1));
          continue;
        }
        throw new ProviderError(
          res.status === 429 ? 'rate_limited' : 'provider_error',
          res.status === 429 ? 'rate limited by activity provider' : 'activity provider error',
        );
      }

      if (!res.ok) {
        throw new ProviderError('provider_error', `activity provider returned status ${res.status}`);
      }

      let data: unknown;
      try {
        data = await res.json();
      } catch {
        throw new ProviderError('provider_error', 'invalid response from activity provider');
      }
      if (!Array.isArray(data)) {
        throw new ProviderError('provider_error', 'unexpected response shape from activity provider');
      }

      return (data as RawHeliusTransaction[])
        .map(mapTransaction)
        .filter((tx): tx is SolanaTransaction => tx !== null);
    }
  }

  return {
    name: 'helius',
    isConfigured: () => Boolean(apiKey),
    getWalletTransactions,
  };
}
