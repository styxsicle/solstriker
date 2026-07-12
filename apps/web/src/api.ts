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

export type Freshness = 'FRESH' | 'AGING' | 'STALE' | 'NEVER_FETCHED' | 'UNKNOWN';
export type SnapshotStatus = 'COMPLETE' | 'PARTIAL' | 'NOT_FOUND' | 'ERROR';
export type MarketConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';

/**
 * Current market snapshot. All financial values are EXACT DECIMAL STRINGS
 * (never converted to lossy JS numbers) — null means the provider did not
 * report the value; it is never zero.
 */
export interface MarketSnapshot {
  id: string;
  tokenId: string;
  refreshRunId: string;
  observedAt: string;
  fetchedAt: string;
  ageSeconds: number | null;
  freshness: Freshness;
  priceUsd: string | null;
  priceSol: string | null;
  marketCapUsd: string | null;
  fdvUsd: string | null;
  liquidityUsd: string | null;
  volume5mUsd: string | null;
  volume1hUsd: string | null;
  volume6hUsd: string | null;
  volume24hUsd: string | null;
  buys5m: number | null;
  sells5m: number | null;
  buys1h: number | null;
  sells1h: number | null;
  buys6h: number | null;
  sells6h: number | null;
  buys24h: number | null;
  sells24h: number | null;
  priceChange5mPct: string | null;
  priceChange1hPct: string | null;
  priceChange6hPct: string | null;
  priceChange24hPct: string | null;
  pairAddress: string | null;
  dex: string | null;
  baseMint: string | null;
  quoteMint: string | null;
  tokenName: string | null;
  tokenSymbol: string | null;
  source: string;
  status: SnapshotStatus;
  confidence: MarketConfidence;
  selectionReason: string | null;
  sanitizedErrorCode: string | null;
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
  /** Present only when the tokens list was requested withMarket=true. */
  market?: MarketSnapshot | null;
}

export interface TokenListResponse {
  items: Token[];
  total: number;
  liveDiscovery: boolean;
}

export interface RefreshTokenResult {
  tokenId: string;
  mint: string;
  status: SnapshotStatus;
  confidence: MarketConfidence;
  pairAddress: string | null;
  dex: string | null;
  observedAt: string;
  sanitizedErrorCode: string | null;
}

export interface RefreshRunResult {
  runId: string;
  provider: string;
  status: 'RUNNING' | 'COMPLETED' | 'PARTIAL' | 'FAILED';
  requested: number;
  processed: number;
  complete: number;
  partial: number;
  notFound: number;
  failed: number;
  snapshotsInserted: number;
  duplicatesPrevented: number;
  results: RefreshTokenResult[];
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
  eventsCleared: number;
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
  venue: string | null;
  confidence: 'CONFIRMED' | 'LIKELY' | 'UNKNOWN' | null;
  explanation: string | null;
  swapInMint: string | null;
  swapInAmount: number | null;
  swapOutMint: string | null;
  swapOutAmount: number | null;
  walletSolChange: number | null;
  networkFeeSol: number | null;
  priorityFeeSol: number | null;
  platformFeeSol: number | null;
  tipSol: number | null;
  rentSol: number | null;
  unrelatedSolIn: number | null;
  unrelatedSolOut: number | null;
  unattributedSol: number | null;
  decoderVersion: number;
  blockTime: string | null;
}

export interface ActivityEventsResponse {
  items: ActivityEvent[];
  page: number;
  pageSize: number;
  total: number;
}

export interface OverviewResponse {
  wallets: { total: number; enabled: number; dev: number };
  activity: { syncedWallets: number; storedEvents: number };
  tokens: { total: number; dev: number };
  market: {
    nonDevTokens: number;
    withSnapshots: number;
    neverRefreshed: number;
    fresh: number;
    aging: number;
    stale: number;
    partialLatest: number;
    lastSuccessfulRefreshAt: string | null;
    lastRunStatus: string | null;
  };
  historical: {
    tokensWithCandles: number;
    totalCandles: number;
    earliestCandle: string | null;
    latestCandle: string | null;
    lastBackfillStatus: string | null;
    lastBackfillAt: string | null;
    eligibleBuyEvents: number;
    buysWithCompleteOutcome: number;
    buysWithPartialOutcome: number;
    buysWithoutOutcome: number;
  };
  positions: {
    walletsReconstructed: number; totalPositions: number; closedPositions: number;
    openPositions: number; incompletePositions: number; totalMatches: number;
    profilesGenerated: number; latestRunStatus: string | null;
  };
}

export interface WalletTradeMatch { id:string; buyEventId:string; sellEventId:string; sequence:number; matchedTokenAmount:string; allocatedBuyCostSol:string|null; allocatedBuyFeesSol:string|null; allocatedSellProceedsSol:string|null; allocatedSellFeesSol:string|null; rawRealizedPnlSol:string|null; knownAllInRealizedPnlSol:string|null; rawRealizedRoiPct:string|null; knownAllInRealizedRoiPct:string|null; holdingDurationSeconds:number|null; confidence:string; warningCodes:string[]; calculationVersion:number }
export interface WalletPosition { id:string; reconstructionRunId:string; trackedWalletId:string; tokenId:string; cycleNumber:number; status:string; confidence:string; openedAt:string|null; closedAt:string|null; firstBuyEventId:string|null; lastEventAt:string|null; quoteAsset:string; totalBoughtTokenAmount:string|null; totalSoldTokenAmount:string|null; openTokenAmount:string|null; knownCostBasisSol:string|null; knownProceedsSol:string|null; allocatedKnownFeesSol:string|null; rawRealizedPnlSol:string|null; knownAllInRealizedPnlSol:string|null; rawRealizedRoiPct:string|null; knownAllInRealizedRoiPct:string|null; estimatedCurrentValueSol:string|null; estimatedCurrentValueUsd:string|null; estimatedUnrealizedPnlSol:string|null; estimatedUnrealizedRoiPct:string|null; valuationSnapshotId:string|null; valuationObservedAt:string|null; valuationFreshness:string|null; valuationStatus:string|null; holdingDurationSeconds:number|null; transferInAmount:string|null; transferOutAmount:string|null; unmatchedSellAmount:string|null; unknownBasisAmount:string|null; includedEventCount:number; excludedEventCount:number; includedEventIds:string[]; exclusionReasons:string[]; decoderVersions:number[]; warningCodes:string[]; calculationVersion:number; calculatedAt:string; token?:{mintAddress:string;name:string|null;symbol:string|null}; trackedWallet?:{address:string;label:string|null;emoji:string|null}; matches:WalletTradeMatch[] }
export interface WalletProfile { id:string; reconstructionRunId:string; trackedWalletId:string; calculationVersion:number; status:string; confidence:string; eligibleBuyCount:number; eligibleSellCount:number; closedPositionCount:number; openPositionCount:number; partialPositionCount:number; unmatchedSellCount:number; transferAffectedPositionCount:number; knownPositionSizeMedianSol:string|null; knownPositionSizeMeanSol:string|null; knownPositionSizeP25Sol:string|null; knownPositionSizeP75Sol:string|null; knownPositionSizeMinSol:string|null; knownPositionSizeMaxSol:string|null; closedHoldingMedianSeconds:string|null; closedHoldingMeanSeconds:string|null; observedMaxConcurrentPositions:number; knownFeeBurdenMedianPct:string|null; completeHistory:boolean; warningCodes:string[]; knownBuySizesSol:string[]; trackedWallet?:Wallet }
export interface ReconstructionResult { runId:string; calculationVersion:number; method:string; status:string; requestedWallets:number; processedWallets:number; includedEvents:number; excludedEvents:number; positionsCreated:number; matchesCreated:number; profilesCreated:number; warnings:number; failures:number; results:Array<{walletId:string;status:string;positionsCreated:number;matchesCreated:number;warningCodes:string[]}> }

// --- Phase 1D-B2: historical candles + post-entry outcomes ---

export interface TokenCandleCoverage {
  pairAddress: string | null;
  interval: string | null;
  earliestCandle: string | null;
  latestCandle: string | null;
  candleCount: number;
  gapCount: number;
  lastBackfillAt: string | null;
  status: 'NONE' | 'PARTIAL' | 'COVERED';
}

export interface BackfillTokenResult {
  tokenId: string;
  mint: string;
  pairAddress: string | null;
  status: 'COMPLETE' | 'PARTIAL' | 'NOT_FOUND' | 'ERROR';
  candlesInserted: number;
  candlesUpdated: number;
  duplicatesPrevented: number;
  gapCount: number;
  coverageStart: string | null;
  coverageEnd: string | null;
  sanitizedErrorCode: string | null;
  reason: string | null;
}

export interface BackfillRunResult {
  runId: string;
  provider: string;
  status: 'COMPLETED' | 'PARTIAL' | 'FAILED';
  interval: string;
  requestedStart: string;
  requestedEnd: string;
  requested: number;
  processed: number;
  complete: number;
  partial: number;
  notFound: number;
  failed: number;
  candlesInserted: number;
  candlesUpdated: number;
  duplicatesPrevented: number;
  gapCount: number;
  results: BackfillTokenResult[];
}

export type OutcomeStatus = 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE' | 'ERROR';

/** Post-entry outcome. All prices/returns are EXACT DECIMAL STRINGS or null. */
export interface WalletEntryOutcome {
  id: string;
  walletEventId: string;
  tokenId: string;
  pairAddress: string | null;
  entryTime: string;
  entryPriceUsd: string | null;
  entryPriceMethod: string;
  entryCandleTime: string | null;
  entryDelaySeconds: number | null;
  price1mUsd: string | null;
  price5mUsd: string | null;
  price15mUsd: string | null;
  price30mUsd: string | null;
  price1hUsd: string | null;
  price4hUsd: string | null;
  price24hUsd: string | null;
  return1mPct: string | null;
  return5mPct: string | null;
  return15mPct: string | null;
  return30mPct: string | null;
  return1hPct: string | null;
  return4hPct: string | null;
  return24hPct: string | null;
  maxPrice1hUsd: string | null;
  minPrice1hUsd: string | null;
  maxReturn1hPct: string | null;
  maxDrawdown1hPct: string | null;
  timeToMax1hSeconds: number | null;
  maxPrice24hUsd: string | null;
  minPrice24hUsd: string | null;
  maxReturn24hPct: string | null;
  maxDrawdown24hPct: string | null;
  timeToMax24hSeconds: number | null;
  status: OutcomeStatus;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
  coverageStart: string | null;
  coverageEnd: string | null;
  missingWindowCount: number;
  calculationVersion: number;
  calculatedAt: string;
}

export interface ActivitySummary {
  transactionsChecked: number;
  eventsStored: number;
  buys: number;
  sells: number;
  transfersIn: number;
  transfersOut: number;
  confirmed: number;
  likely: number;
  unknownConfidence: number;
  legacyEvents: number;
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
