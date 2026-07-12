// Synthetic test data only — never real wallet addresses or signatures.
import type { ActivityEvent, MarketSnapshot, Token } from '../src/api';

export const FAKE_WALLET = {
  address: 'FAKEwa11etAddressForTests11111111111111111',
  label: 'mr phoof',
  emoji: null as string | null,
};

export const FAKE_MINT = 'FAKEmintAddressForTests1111111111111111111';

export function makeEvent(overrides: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    id: 'evt-1',
    walletId: 'wallet-1',
    wallet: { ...FAKE_WALLET },
    tokenId: 'token-1',
    token: { mintAddress: FAKE_MINT, name: null, symbol: null },
    signature: 'FAKEsignatureForTests111111111111111111111111111111111111111111',
    eventType: 'BUY',
    tokenAmount: 15_606_894.907348,
    quoteMint: 'SOL',
    quoteAmount: 1.510707025,
    source: 'PUMP_FUN',
    venue: 'PUMP_FUN',
    confidence: 'CONFIRMED',
    explanation: 'Reconstructed from venue instruction transfers on PUMP_FUN.',
    swapInMint: 'SOL',
    swapInAmount: 1.510707025,
    swapOutMint: FAKE_MINT,
    swapOutAmount: 15_606_894.907348,
    walletSolChange: -1.539427863,
    networkFeeSol: 0.000307,
    priorityFeeSol: 0.000302,
    platformFeeSol: 0.026339758,
    tipSol: 0,
    rentSol: 0.00207408,
    unrelatedSolIn: 0,
    unrelatedSolOut: 0,
    unattributedSol: 0,
    decoderVersion: 2,
    blockTime: '2026-07-10T21:43:50.000Z',
    ...overrides,
  };
}

export function makeMarketSnapshot(overrides: Partial<MarketSnapshot> = {}): MarketSnapshot {
  return {
    id: 'snap-1',
    tokenId: 'token-1',
    refreshRunId: 'run-1',
    observedAt: '2026-07-12T00:00:00.000Z',
    fetchedAt: '2026-07-12T00:00:00.000Z',
    ageSeconds: 42,
    freshness: 'FRESH',
    priceUsd: '0.000004089',
    priceSol: '0.00000005243',
    marketCapUsd: '363418575',
    fdvUsd: '400000000',
    liquidityUsd: '122349.87',
    volume5mUsd: '210.6',
    volume1hUsd: '6390.7',
    volume6hUsd: '26875.2',
    volume24hUsd: '260503.7',
    buys5m: 3,
    sells5m: 16,
    buys1h: 133,
    sells1h: 86,
    buys6h: 819,
    sells6h: 656,
    buys24h: 3322,
    sells24h: 5608,
    priceChange5mPct: '0.11',
    priceChange1hPct: '-0.37',
    priceChange6hPct: '-0.88',
    priceChange24hPct: '-0.6',
    pairAddress: 'FAKEpairAddress1111111111111111111111111111',
    dex: 'raydium',
    baseMint: 'FAKEmintAddressForTests1111111111111111111',
    quoteMint: 'So11111111111111111111111111111111111111112',
    tokenName: 'Fixture Meme',
    tokenSymbol: 'FIXT',
    source: 'dexscreener',
    status: 'COMPLETE',
    confidence: 'HIGH',
    selectionReason: 'only_usable_pair',
    sanitizedErrorCode: null,
    ...overrides,
  };
}

export function makeToken(overrides: Partial<Token> = {}): Token {
  return {
    id: 'token-1',
    mintAddress: 'FAKErealMint11111111111111111111111111111',
    name: 'Fixture Meme',
    symbol: 'FIXT',
    stage: 'UNCLASSIFIED',
    source: 'activity',
    discoveredAt: '2026-07-10T00:00:00.000Z',
    lastSeenAt: '2026-07-11T00:00:00.000Z',
    market: null,
    ...overrides,
  };
}
