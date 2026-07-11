const BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:3001';

export interface HealthResponse {
  status: string;
  db: 'ok' | 'error';
  uptimeSec: number;
  timestamp: string;
}

export interface RpcStatus {
  configured: boolean;
  cluster: string;
  healthy: boolean | null;
  slot: number | null;
  latencyMs: number | null;
  checkedAt: string;
  error: string | null;
}

export interface Wallet {
  id: string;
  address: string;
  label: string | null;
  group: string | null;
  groups: string[];
  emoji: string | null;
  notes: string | null;
  enabled: boolean;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export interface WalletListResponse {
  items: Wallet[];
  page: number;
  pageSize: number;
  total: number;
  stats: { total: number; enabled: number };
  groups: string[];
}

export interface ImportSummary {
  format: string;
  totalRows: number;
  imported: number;
  duplicates: number;
  invalid: number;
  skipped: number;
  invalidSamples: { line: number; value: string; reason: string }[];
}

export interface Token {
  id: string;
  mintAddress: string;
  name: string | null;
  symbol: string | null;
  stage: string;
  source: string;
  discoveredAt: string;
  lastSeenAt: string;
}

export interface TokenListResponse {
  items: Token[];
  total: number;
  liveDiscovery: boolean;
}

export interface SyncResult {
  walletId: string;
  address: string;
  status: 'ok' | 'locked' | 'error';
  transactionsProcessed: number;
  eventsCreated: number;
  duplicateEvents: number;
  tokensDiscovered: number;
  backfillComplete: boolean | null;
  error: string | null;
}

export interface SyncResponse {
  results: SyncResult[];
}

export interface SyncStatusItem {
  walletId: string;
  address: string;
  label: string | null;
  emoji: string | null;
  enabled: boolean;
  status: string;
  backfillComplete: boolean;
  totalTransactions: number;
  totalEvents: number;
  lastSyncAt: string | null;
  lastError: string | null;
}

export interface SyncStatusResponse {
  providerConfigured: boolean;
  maxWalletsPerSync: number;
  items: SyncStatusItem[];
}

export interface ActivityEvent {
  id: string;
  walletId: string;
  wallet: { address: string; label: string | null; emoji: string | null };
  tokenId: string | null;
  token: { mintAddress: string; name: string | null; symbol: string | null } | null;
  signature: string;
  eventType: string;
  tokenAmount: number | null;
  quoteMint: string | null;
  quoteAmount: number | null;
  source: string | null;
  blockTime: string | null;
}

export interface ActivityEventsResponse {
  items: ActivityEvent[];
  page: number;
  pageSize: number;
  total: number;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // keep the HTTP status message
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}
