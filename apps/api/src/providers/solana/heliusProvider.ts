import type { GetTransactionsOptions, SolanaActivityProvider } from './provider.js';
import {
  ProviderError,
  type SolanaAccountBalanceChange,
  type SolanaNativeTransfer,
  type SolanaSwapEvent,
  type SolanaSwapNativeLeg,
  type SolanaSwapTokenLeg,
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
  fromTokenAccount?: unknown;
  toTokenAccount?: unknown;
  tokenAmount?: unknown;
}

interface RawHeliusNativeTransfer {
  fromUserAccount?: unknown;
  toUserAccount?: unknown;
  amount?: unknown;
}

interface RawHeliusAccountData {
  account?: unknown;
  nativeBalanceChange?: unknown;
}

interface RawHeliusNativeLeg {
  account?: unknown;
  amount?: unknown;
}

interface RawHeliusSwapTokenLeg {
  userAccount?: unknown;
  mint?: unknown;
  tokenAmount?: unknown;
  rawTokenAmount?: { tokenAmount?: unknown; decimals?: unknown };
}

interface RawHeliusInnerSwap {
  programInfo?: { source?: unknown };
}

interface RawHeliusSwapEvent {
  nativeInput?: RawHeliusNativeLeg | null;
  nativeOutput?: RawHeliusNativeLeg | null;
  tokenInputs?: RawHeliusSwapTokenLeg[];
  tokenOutputs?: RawHeliusSwapTokenLeg[];
  nativeFees?: RawHeliusNativeLeg[];
  tokenFees?: RawHeliusSwapTokenLeg[];
  innerSwaps?: RawHeliusInnerSwap[];
}

interface RawHeliusInstruction {
  programId?: unknown;
  accounts?: unknown;
  innerInstructions?: RawHeliusInstruction[];
}

interface RawHeliusTransaction {
  signature?: unknown;
  slot?: unknown;
  timestamp?: unknown;
  type?: unknown;
  source?: unknown;
  fee?: unknown;
  feePayer?: unknown;
  transactionError?: unknown;
  tokenTransfers?: RawHeliusTokenTransfer[];
  nativeTransfers?: RawHeliusNativeTransfer[];
  accountData?: RawHeliusAccountData[];
  events?: { swap?: RawHeliusSwapEvent | null };
  instructions?: RawHeliusInstruction[];
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Helius mixes numbers and numeric strings (e.g. lamports in swap events). */
function asLooseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function mapNativeLeg(raw: RawHeliusNativeLeg | null | undefined): SolanaSwapNativeLeg | null {
  if (!raw) return null;
  const account = asString(raw.account);
  const lamports = asLooseNumber(raw.amount);
  if (!account || lamports === null || lamports <= 0) return null;
  return { account, lamports };
}

function mapSwapTokenLeg(raw: RawHeliusSwapTokenLeg): SolanaSwapTokenLeg | null {
  const mint = asString(raw.mint);
  if (!mint) return null;
  let amount = asLooseNumber(raw.tokenAmount);
  if (amount === null && raw.rawTokenAmount) {
    const rawAmount = asLooseNumber(raw.rawTokenAmount.tokenAmount);
    const decimals = asLooseNumber(raw.rawTokenAmount.decimals);
    if (rawAmount !== null && decimals !== null) {
      amount = rawAmount / 10 ** decimals;
    }
  }
  if (amount === null || !(Math.abs(amount) > 0)) return null;
  return {
    userAccount: asString(raw.userAccount),
    mint,
    tokenAmount: Math.abs(amount),
  };
}

function mapSwapEvent(raw: RawHeliusSwapEvent | null | undefined): SolanaSwapEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const swap: SolanaSwapEvent = {
    nativeInput: mapNativeLeg(raw.nativeInput),
    nativeOutput: mapNativeLeg(raw.nativeOutput),
    tokenInputs: (raw.tokenInputs ?? [])
      .map(mapSwapTokenLeg)
      .filter((l): l is SolanaSwapTokenLeg => l !== null),
    tokenOutputs: (raw.tokenOutputs ?? [])
      .map(mapSwapTokenLeg)
      .filter((l): l is SolanaSwapTokenLeg => l !== null),
    nativeFees: (raw.nativeFees ?? [])
      .map((f) => mapNativeLeg(f))
      .filter((l): l is SolanaSwapNativeLeg => l !== null),
    tokenFees: (raw.tokenFees ?? [])
      .map(mapSwapTokenLeg)
      .filter((l): l is SolanaSwapTokenLeg => l !== null),
    innerVenues: [
      ...new Set(
        (raw.innerSwaps ?? [])
          .map((s) => asString(s.programInfo?.source))
          .filter((s): s is string => s !== null && s !== 'UNKNOWN'),
      ),
    ],
  };
  const empty =
    !swap.nativeInput &&
    !swap.nativeOutput &&
    swap.tokenInputs.length === 0 &&
    swap.tokenOutputs.length === 0;
  return empty ? null : swap;
}

/**
 * Maps one raw Helius enhanced transaction into the neutral shape.
 * Exported for offline fixtures and manual verification scripts.
 */
export function mapRawHeliusTransaction(rawInput: unknown): SolanaTransaction | null {
  if (typeof rawInput !== 'object' || rawInput === null) return null;
  return mapTransaction(rawInput as RawHeliusTransaction);
}

function mapTransaction(raw: RawHeliusTransaction): SolanaTransaction | null {
  const signature = asString(raw.signature);
  if (!signature) return null;

  const tokenTransfers: SolanaTokenTransfer[] = (raw.tokenTransfers ?? [])
    .map((t) => ({
      mint: asString(t.mint) ?? '',
      fromUserAccount: asString(t.fromUserAccount),
      toUserAccount: asString(t.toUserAccount),
      fromTokenAccount: asString(t.fromTokenAccount),
      toTokenAccount: asString(t.toTokenAccount),
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

  const accountBalanceChanges: SolanaAccountBalanceChange[] = (raw.accountData ?? [])
    .map((a) => ({
      account: asString(a.account) ?? '',
      lamportsChange: asLooseNumber(a.nativeBalanceChange) ?? NaN,
    }))
    .filter((a) => a.account !== '' && Number.isFinite(a.lamportsChange));

  const programInvocations: SolanaTransaction['programInvocations'] = [];
  const pushInvocation = (ins: RawHeliusInstruction | undefined) => {
    if (!ins) return;
    const programId = asString(ins.programId);
    if (!programId) return;
    const accounts = Array.isArray(ins.accounts)
      ? ins.accounts.filter((a): a is string => typeof a === 'string' && a !== '')
      : [];
    programInvocations.push({ programId, accounts });
  };
  for (const ins of raw.instructions ?? []) {
    pushInvocation(ins);
    for (const inner of ins?.innerInstructions ?? []) pushInvocation(inner);
  }

  return {
    signature,
    slot: asNumber(raw.slot),
    timestamp: asNumber(raw.timestamp),
    type: asString(raw.type),
    source: asString(raw.source),
    failed: raw.transactionError !== null && raw.transactionError !== undefined,
    feeLamports: asLooseNumber(raw.fee),
    feePayer: asString(raw.feePayer),
    tokenTransfers,
    nativeTransfers,
    accountBalanceChanges,
    swap: mapSwapEvent(raw.events?.swap),
    programInvocations,
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
