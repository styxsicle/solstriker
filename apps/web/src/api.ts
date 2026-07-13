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
  quality: { walletsAnalyzed:number; latestRunStatus:string|null; metricSetsGenerated:number; categoryMetricSetsGenerated:number; timeWindowComparisonsGenerated:number; verySmallSamples:number; smallSamples:number; moderateSamples:number; largeSamples:number; incompleteHistoryWallets:number };
  /** Phase 2C-A counts only — never a "best" or "recommended" focus wallet. */
  focus: { cohorts:number; cohortMembers:number; walletsWithFingerprints:number; latestRunStatus:string|null; latestRunAt:string|null; insufficientEvidenceFingerprints:number; incompleteHistoryFingerprints:number };
}

// --- Phase 2C-A: focus cohorts and strategy fingerprints ---

/** Cohort membership is a USER GROUPING. It never establishes common ownership. */
export type CohortRole = 'PRIMARY' | 'COMPARISON';

export interface FocusCohortMember {
  id: string;
  cohortId: string;
  trackedWalletId: string;
  role: CohortRole;
  displayOrder: number;
  notes: string | null;
  wallet: { id: string; address: string; label: string | null; emoji: string | null; source: string };
  createdAt: string;
  updatedAt: string;
}

/** What a member wallet still needs before a fingerprint can be calculated. */
export interface CohortReadiness {
  synchronized: boolean;
  backfillComplete: boolean;
  syncStatus: string;
  storedEventCount: number;
  reconstructionRunId: string | null;
  reconstructionStatus: string;
  qualityMetricSetId: string | null;
  qualityStatus: string;
  fingerprintId: string | null;
  fingerprintStatus: string;
  fingerprintConfidence: string | null;
  eligibleCycleCount: number | null;
  missingPrerequisites: string[];
  canAnalyze: boolean;
}

export interface FocusCohort {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  memberCount: number;
  members: FocusCohortMember[];
  warningCodes: string[];
  readiness?: Record<string, CohortReadiness>;
}

export interface StrategyPattern {
  id: string;
  fingerprintId: string;
  patternType: string;
  patternValue: string;
  sortOrder: number;
  totalCount: number;
  eligibleCount: number;
  excludedCount: number;
  percentage: string | null;
  medianSizeSol: string | null;
  medianDurationSeconds: string | null;
  medianRawResultSol: string | null;
  confidence: string;
  warningCodes: string[];
}

/** The audit trail behind one descriptor: formula, sample, threshold, warnings. */
export interface DescriptorEvidence {
  code: string;
  formula: string;
  numerator: number | null;
  denominator: number | null;
  observed: string | null;
  threshold: string;
  sampleCount: number;
  confidence: string;
  warningCodes: string[];
}

/**
 * Observed structure of a wallet's reconstructed cycles. All financial values
 * are EXACT DECIMAL STRINGS; null means unknown, never zero. Nothing here
 * measures profitability, proves ownership, or recommends copying anything.
 */
export interface StrategyFingerprint {
  id: string;
  runId: string;
  trackedWalletId: string;
  reconstructionRunId: string;
  qualityMetricSetId: string | null;
  calculationVersion: number;
  status: string;
  confidence: string;
  eligibleCycleCount: number;
  excludedCycleCount: number;
  eligibleBuyCount: number;
  eligibleSellCount: number;
  medianBuysPerCycle: string | null;
  meanBuysPerCycle: string | null;
  p25BuysPerCycle: string | null;
  p75BuysPerCycle: string | null;
  singleBuyCycleCount: number;
  twoBuyCycleCount: number;
  multiBuyCycleCount: number;
  medianFirstToSecondBuySeconds: string | null;
  medianLaterBuyGapSeconds: string | null;
  medianFirstBuySol: string | null;
  medianCycleCostSol: string | null;
  p75CycleCostSol: string | null;
  medianFirstBuySharePct: string | null;
  medianLargestBuySharePct: string | null;
  largestBuyFirstCycleCount: number;
  increasingSizeCycleCount: number;
  cyclesWithSellCount: number;
  medianSellsPerCycle: string | null;
  singleSellCycleCount: number;
  twoSellCycleCount: number;
  multiSellCycleCount: number;
  medianFirstBuyToFirstSellSeconds: string | null;
  medianLastBuyToFirstSellSeconds: string | null;
  medianFirstSellInventoryPct: string | null;
  medianLargestSellInventoryPct: string | null;
  medianRemainingAfterFirstSellPct: string | null;
  medianFirstSellToFinalSellSeconds: string | null;
  partialFirstExitCycleCount: number;
  fullyClosedCycleCount: number;
  openCycleCount: number;
  transferAffectedCycleCount: number;
  unmatchedSellCount: number;
  unknownBasisCycleCount: number;
  missingFeeCycleCount: number;
  eligibleCoveragePct: string | null;
  feeCoveragePct: string | null;
  completeHistory: boolean;
  distinctTokenCount: number;
  repeatedTokenCount: number;
  repeatedTokenCycleCount: number;
  maxCyclesPerToken: number;
  medianSecondsBetweenTokenCycles: string | null;
  medianFeePerBuySol: string | null;
  medianFeePerSellSol: string | null;
  medianFeePerCycleSol: string | null;
  medianFeeBurdenPct: string | null;
  p75FeeBurdenPct: string | null;
  feeBurdenOver1PctCount: number;
  feeBurdenOver2PctCount: number;
  feeBurdenOver5PctCount: number;
  feeBurdenOver10PctCount: number;
  medianLegsPerCycle: string | null;
  observedMaxConcurrentPositions: number;
  medianConcurrentPositions: string | null;
  descriptorCodes: string[];
  descriptorEvidence: DescriptorEvidence[];
  warningCodes: string[];
  calculatedAt: string;
  patterns?: StrategyPattern[];
  trackedWallet?: { address: string; label: string | null; emoji: string | null };
}

export interface StrategyAnalysisResult {
  runId: string;
  calculationVersion: number;
  status: string;
  requestedWallets: number;
  processedWallets: number;
  fingerprintsCreated: number;
  patternsCreated: number;
  eligibleCycles: number;
  excludedCycles: number;
  warnings: number;
  failures: number;
  results: Array<{ walletId: string; status: string; error?: string; warningCodes: string[] }>;
}

export interface WalletTradeMatch { id:string; buyEventId:string; sellEventId:string; sequence:number; matchedTokenAmount:string; allocatedBuyCostSol:string|null; allocatedBuyFeesSol:string|null; allocatedSellProceedsSol:string|null; allocatedSellFeesSol:string|null; rawRealizedPnlSol:string|null; knownAllInRealizedPnlSol:string|null; rawRealizedRoiPct:string|null; knownAllInRealizedRoiPct:string|null; holdingDurationSeconds:number|null; confidence:string; warningCodes:string[]; calculationVersion:number }
export interface WalletPosition { id:string; reconstructionRunId:string; trackedWalletId:string; tokenId:string; cycleNumber:number; status:string; confidence:string; openedAt:string|null; closedAt:string|null; firstBuyEventId:string|null; lastEventAt:string|null; quoteAsset:string; totalBoughtTokenAmount:string|null; totalSoldTokenAmount:string|null; openTokenAmount:string|null; knownCostBasisSol:string|null; knownProceedsSol:string|null; allocatedKnownFeesSol:string|null; rawRealizedPnlSol:string|null; knownAllInRealizedPnlSol:string|null; rawRealizedRoiPct:string|null; knownAllInRealizedRoiPct:string|null; estimatedCurrentValueSol:string|null; estimatedCurrentValueUsd:string|null; estimatedUnrealizedPnlSol:string|null; estimatedUnrealizedRoiPct:string|null; valuationSnapshotId:string|null; valuationObservedAt:string|null; valuationFreshness:string|null; valuationStatus:string|null; holdingDurationSeconds:number|null; transferInAmount:string|null; transferOutAmount:string|null; unmatchedSellAmount:string|null; unknownBasisAmount:string|null; includedEventCount:number; excludedEventCount:number; includedEventIds:string[]; exclusionReasons:string[]; decoderVersions:number[]; warningCodes:string[]; calculationVersion:number; calculatedAt:string; token?:{mintAddress:string;name:string|null;symbol:string|null}; trackedWallet?:{address:string;label:string|null;emoji:string|null}; matches:WalletTradeMatch[] }
export interface WalletProfile { id:string; reconstructionRunId:string; trackedWalletId:string; calculationVersion:number; status:string; confidence:string; eligibleBuyCount:number; eligibleSellCount:number; closedPositionCount:number; openPositionCount:number; partialPositionCount:number; unmatchedSellCount:number; transferAffectedPositionCount:number; knownPositionSizeMedianSol:string|null; knownPositionSizeMeanSol:string|null; knownPositionSizeP25Sol:string|null; knownPositionSizeP75Sol:string|null; knownPositionSizeMinSol:string|null; knownPositionSizeMaxSol:string|null; closedHoldingMedianSeconds:string|null; closedHoldingMeanSeconds:string|null; observedMaxConcurrentPositions:number; knownFeeBurdenMedianPct:string|null; completeHistory:boolean; warningCodes:string[]; knownBuySizesSol:string[]; trackedWallet?:Wallet }
export interface ReconstructionResult { runId:string; calculationVersion:number; method:string; status:string; requestedWallets:number; processedWallets:number; includedEvents:number; excludedEvents:number; positionsCreated:number; matchesCreated:number; profilesCreated:number; warnings:number; failures:number; results:Array<{walletId:string;status:string;positionsCreated:number;matchesCreated:number;warningCodes:string[]}> }
export interface QualityCategory { id:string;categoryType:string;categoryValue:string;totalSampleCount:number;eligibleSampleCount:number;excludedSampleCount:number;confidence:string;positiveRawCount:number;negativeRawCount:number;rawPositiveRatePct:string|null;medianRawPnlSol:string|null;medianRawRoiPct:string|null;medianAllInRoiPct:string|null;medianHoldingSeconds:string|null;medianPositionSizeSol:string|null;warningCodes:string[] }
export interface QualityWindow { id:string;windowType:string;windowStart:string|null;windowEnd:string|null;sampleCount:number;eligibleSampleCount:number;confidence:string;positiveRawRatePct:string|null;medianRawPnlSol:string|null;medianRawRoiPct:string|null;medianAllInRoiPct:string|null;medianHoldingSeconds:string|null;medianPositionSizeSol:string|null;warningCodes:string[] }
export interface QualityMetricSet { id:string;analysisRunId:string;reconstructionRunId:string;trackedWalletId:string;calculationVersion:number;status:string;confidence:string;sampleSizeTier:string;totalPositionCount:number;eligibleClosedCount:number;eligibleOpenCount:number;excludedCount:number;highConfidenceCount:number;lowerConfidenceCount:number;positiveRawCount:number;negativeRawCount:number;flatRawCount:number;positiveAllInCount:number;negativeAllInCount:number;rawPositiveRatePct:string|null;allInPositiveRatePct:string|null;medianRawPnlSol:string|null;meanRawPnlSol:string|null;p25RawPnlSol:string|null;p75RawPnlSol:string|null;minRawPnlSol:string|null;maxRawPnlSol:string|null;medianAllInPnlSol:string|null;meanAllInPnlSol:string|null;medianRawRoiPct:string|null;meanRawRoiPct:string|null;p25RawRoiPct:string|null;p75RawRoiPct:string|null;medianAllInRoiPct:string|null;meanAllInRoiPct:string|null;grossGainSol:string|null;grossLossSol:string|null;profitFactor:string|null;largestGainContributionPct:string|null;largestLossContributionPct:string|null;medianHoldingSeconds:string|null;meanHoldingSeconds:string|null;medianPositionSizeSol:string|null;observedDistinctTokenCount:number;transferAffectedCount:number;unmatchedSellCount:number;completeHistory:boolean;eligibleCoveragePct:string|null;knownFeeCoveragePct:string|null;outcomeCoveragePct:string|null;warningCodes:string[];consistency:{medianMeanDivergence:string|null;repeatedTokenConcentrationPct:string|null};holdingBuckets:Record<string,number>;outcomeMetrics:Record<string,string|number|null>;categories?:QualityCategory[];timeWindows?:QualityWindow[];trackedWallet?:{address:string;label:string|null;emoji:string|null} }
export interface QualityAnalysisResult { runId:string;status:string;requestedWallets:number;processedWallets:number;metricSetsCreated:number;categorySetsCreated:number;timeWindowSetsCreated:number;eligiblePositions:number;excludedPositions:number;warnings:number;failures:number }

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

// --- One-click Focus Wallet Preparation ---

export type PrepareStageStatus = 'NOT_STARTED' | 'RUNNING' | 'COMPLETED' | 'SKIPPED' | 'FAILED';

export interface PrepareSyncStage {
  status: PrepareStageStatus;
  reason: string | null;
  error: string | null;
  transactionsProcessed: number | null;
  eventsCreated: number | null;
  duplicateEvents: number | null;
  tokensDiscovered: number | null;
  backfillComplete: boolean | null;
}
export interface PrepareReconstructionStage {
  status: PrepareStageStatus;
  reason: string | null;
  error: string | null;
  reconstructionRunId: string | null;
  positionsCreated: number | null;
  matchesCreated: number | null;
  warningCodes: string[];
}
export interface PrepareQualityStage {
  status: PrepareStageStatus;
  reason: string | null;
  error: string | null;
  qualityMetricSetId: string | null;
  eligiblePositions: number | null;
  excludedPositions: number | null;
  warningCodes: string[];
}
export interface PrepareFingerprintStage {
  status: PrepareStageStatus;
  reason: string | null;
  error: string | null;
  fingerprintId: string | null;
  eligibleCycleCount: number | null;
  excludedCycleCount: number | null;
  descriptorCodes: string[];
  warningCodes: string[];
}
export interface PrepareWalletResult {
  walletId: string;
  address: string;
  label: string | null;
  storedEventCountBefore: number;
  storedEventCountAfter: number;
  backfillComplete: boolean;
  sync: PrepareSyncStage;
  reconstruction: PrepareReconstructionStage;
  quality: PrepareQualityStage;
  fingerprint: PrepareFingerprintStage;
  warningCodes: string[];
  sanitizedError: string | null;
}
export interface PrepareBatchResult {
  requestedWallets: number;
  processedWallets: number;
  failures: number;
  results: PrepareWalletResult[];
}

// --- Slow Cook V1 ---

export type SlowCookEvidenceState = 'SUFFICIENT' | 'LIMITED' | 'INSUFFICIENT';
export type SlowCookCandidateState = 'BUILDING' | 'HOLDING' | 'MIXED' | 'COOLING' | 'DISTRIBUTION_RISK' | 'INSUFFICIENT_EVIDENCE';
export type SlowCookConfidenceLevel = 'LOW' | 'MODERATE' | 'HIGHER';
export type SlowCookMarketFreshness = 'FRESH' | 'AGING' | 'STALE';

export interface SlowCookRequest {
  walletIds: string[];
  lookbackDays?: number;
  minimumWallets?: number;
  limit?: number;
  includeLowerConfidence?: boolean;
}

export interface SlowCookOptions {
  lookbackDays: number;
  minimumWallets: number;
  limit: number;
  includeLowerConfidence: boolean;
}

export interface SlowCookWalletStyleMemory {
  walletId: string;
  address: string;
  label: string | null;
  evidenceState: SlowCookEvidenceState;
  summarySentences: string[];
  styleTags: string[];
  metrics: {
    eligibleCycleCount: number | null;
    eligibleClosedCount: number | null;
    medianHoldingSeconds: string | null;
    medianBuysPerCycle: string | null;
    medianSellsPerCycle: string | null;
    fullyClosedCycleCount: number | null;
    openCycleCount: number | null;
    medianFirstSellInventoryPct: string | null;
    medianRemainingAfterFirstSellPct: string | null;
    medianPositionSizeSol: string | null;
    observedMaxConcurrentPositions: number | null;
    rawPositiveRatePct: string | null;
    medianRawRoiPct: string | null;
    largestGainContributionPct: string | null;
    transferAffectedCount: number | null;
    unmatchedSellCount: number | null;
    completeHistory: boolean | null;
  };
  ids: {
    reconstructionRunId: string | null;
    qualityMetricSetId: string | null;
    fingerprintId: string | null;
    fingerprintRunId: string | null;
    fingerprintCalculationVersion: number | null;
  };
}

export interface SlowCookCandidateWalletDetail {
  walletId: string;
  address: string;
  label: string | null;
  buyCount: number;
  sellCount: number;
  hasOpenPosition: boolean;
  firstBuyAt: string | null;
  lastBuyAt: string | null;
  styleMatch: string | null;
}

export interface SlowCookCandidate {
  tokenId: string;
  mintAddress: string;
  name: string | null;
  symbol: string | null;
  state: SlowCookCandidateState;
  confidence: SlowCookConfidenceLevel;
  confidenceScore: number;
  confidenceComponents: Record<string, number>;
  walletInterest: {
    walletsWithEvidenceCount: number;
    recentBuyCount: number;
    openPositionWalletCount: number;
    mostRecentActivityAt: string | null;
  };
  accumulation: {
    repeatBuyWalletCount: number;
    addsAfterEntryCount: number;
    recentBuyCount: number;
    recentSellCount: number;
    stillOpenCount: number;
  };
  holdingConviction: {
    secondsSinceFirstBuy: number | null;
    secondsSinceLastBuy: number | null;
    detectedSellCount: number;
    openPositionCount: number;
  };
  dataQuality: {
    contributingWalletsCurrentCount: number;
    contributingWalletsStaleOrMissingCount: number;
    transferAffectedWalletCount: number;
    unmatchedSellWalletCount: number;
    marketSnapshotStatus: 'AVAILABLE' | 'STALE' | 'UNAVAILABLE';
    marketFreshness: SlowCookMarketFreshness | null;
  };
  distributionPressure: {
    detectedSellCount: number;
    walletsSellingCount: number;
    label: 'LOW_DETECTED_DISTRIBUTION' | 'MIXED_ACTIVITY' | 'ELEVATED_DETECTED_SELLING';
  };
  styleMatchSummary: string;
  wallets: SlowCookCandidateWalletDetail[];
  whyThisAppeared: string[];
  whatCouldInvalidate: string[];
  market: {
    priceUsd: string | null;
    marketCapUsd: string | null;
    liquidityUsd: string | null;
    volume24hUsd: string | null;
    priceChange24hPct: string | null;
    observedAt: string | null;
    freshness: SlowCookMarketFreshness | null;
  } | null;
  /** FOMO Simulator preview, derived by the backend — never by the frontend. */
  paperPreview?: PaperCallPreview;
}

// --- FOMO Simulator V1 (paper calls only — no real trading) ---

export type PaperAction = 'BUY' | 'HOLD' | 'EXIT' | 'AVOID' | 'NO_TRADE';
export type PaperConviction = 'HIGH' | 'MEDIUM' | 'LOW';

export interface PaperCallPreview {
  action: PaperAction;
  conviction: PaperConviction;
  openPositionId: string | null;
  openPositionUnrealizedReturnPct: string | null;
}

export interface PaperCallRecord {
  id: string;
  action: PaperAction;
  conviction: PaperConviction;
  slowCookState: SlowCookCandidateState;
  slowCookConfidence: SlowCookConfidenceLevel;
  slowCookMethodologyVersion: string;
  fomoMethodologyVersion: string;
  analyzedAt: string;
  latestEvidenceAt: string | null;
  tokenId: string;
  tokenMint: string;
  tokenName: string | null;
  tokenSymbol: string | null;
  cohortKey: string;
  walletIds: string[];
  walletAddresses: (string | null)[];
  walletLabels: (string | null)[];
  styleSummaries: { walletId: string; evidenceState: string; summarySentences: string[] }[];
  reasons: string[];
  invalidation: string[];
  evidence: Record<string, unknown> | null;
  dataQuality: Record<string, unknown> | null;
  settings: Record<string, unknown> | null;
  entrySnapshotId: string | null;
  entryObservedAt: string | null;
  entryPriceUsd: string | null;
  marketCapUsd: string | null;
  liquidityUsd: string | null;
  volume24hUsd: string | null;
  snapshotFreshness: string | null;
  simulatedAmountUsd: string | null;
  feeRatePct: string | null;
  entrySlippagePct: string | null;
  exitSlippagePct: string | null;
  priced: boolean;
  unpricedReason: string | null;
  warningCodes: string[];
  paperPositionId: string | null;
  dedupeKey: string;
  createdAt: string;
}

export interface PaperPositionRecord {
  id: string;
  tokenId: string;
  tokenMint: string;
  tokenName: string | null;
  tokenSymbol: string | null;
  cohortKey: string;
  walletIds: string[];
  methodologyVersion: string;
  status: 'OPEN' | 'CLOSED';
  notionalUsd: string;
  feeRatePct: string;
  entrySlippagePct: string;
  exitSlippagePct: string;
  entrySnapshotId: string;
  entryObservedAt: string;
  entryPriceUsd: string;
  effectiveEntryPriceUsd: string;
  entryFeeUsd: string;
  tokenQuantity: string;
  entryWarningCodes: string[];
  openedAt: string;
  closedAt: string | null;
  exitSnapshotId: string | null;
  exitObservedAt: string | null;
  exitPriceUsd: string | null;
  grossExitValueUsd: string | null;
  exitFeeUsd: string | null;
  netExitValueUsd: string | null;
  realizedPlUsd: string | null;
  realizedReturnPct: string | null;
  latestValueUsd: string | null;
  unrealizedPlUsd: string | null;
  unrealizedReturnPct: string | null;
  latestValuationAt: string | null;
  exitSignalPendingReason: string | null;
}

export interface PaperPositionValuationRecord {
  id: string;
  positionId: string;
  snapshotId: string;
  observedAt: string;
  priceUsd: string;
  grossValueUsd: string;
  netValueUsd: string;
  unrealizedPlUsd: string;
  unrealizedReturnPct: string;
  freshness: string;
}

export interface PaperPositionDetail extends PaperPositionRecord {
  calls: PaperCallRecord[];
  valuations: PaperPositionValuationRecord[];
}

export interface FomoSummary {
  methodologyVersion: string;
  netPlUsd: string | null;
  realizedPlUsd: string | null;
  unrealizedPlUsd: string | null;
  openTradeCount: number;
  closedTradeCount: number;
  winRatePct: string | null;
  winningClosedCount: number | null;
  highConvictionPlUsd: string | null;
  highConvictionTradeCount: number;
  calls: {
    total: number;
    buy: number;
    hold: number;
    exit: number;
    avoid: number;
    noTrade: number;
    unpriced: number;
  };
}

export interface RecordPaperCallRequest {
  tokenId: string;
  walletIds: string[];
  lookbackDays?: number;
  minimumWallets?: number;
  limit?: number;
  includeLowerConfidence?: boolean;
  simulatedAmountUsd?: string;
  assumptions?: { feeRatePct?: string; entrySlippagePct?: string; exitSlippagePct?: string };
}

export interface RecordPaperCallResponse {
  call: PaperCallRecord;
  position: PaperPositionRecord | null;
}

export interface SlowCookResult {
  calculationVersion: string;
  analyzedAt: string;
  requestedWalletIds: string[];
  options: SlowCookOptions;
  walletsAnalyzed: number;
  walletsWithUsableStyle: number;
  styleMemories: SlowCookWalletStyleMemory[];
  candidates: SlowCookCandidate[];
  candidatesFound: number;
  strongerCandidateCount: number;
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
