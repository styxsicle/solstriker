// Market-provider fixtures — synthetic mints only, never real wallet data.
import { syntheticAddress, STABLE_MINTS, WSOL_MINT } from '@memecoin-lab/shared';
import type { MarketDataProvider } from '../../src/providers/market/marketDataProvider.js';
import type {
  MarketLookupResult,
  MarketPairCandidate,
  WindowKey,
} from '../../src/providers/market/types.js';

export const MEME_MINT = syntheticAddress(120);
export const MEME_MINT_2 = syntheticAddress(121);
export const USDC_MINT = STABLE_MINTS[0];

const emptyWindows = <T>(value: T): Record<WindowKey, T> => ({
  m5: value,
  h1: value,
  h6: value,
  h24: value,
});

export function makeCandidate(
  overrides: Partial<MarketPairCandidate> = {},
): MarketPairCandidate {
  return {
    chainId: 'solana',
    pairAddress: syntheticAddress(130),
    dex: 'raydium',
    baseMint: MEME_MINT,
    baseName: 'Fixture Meme',
    baseSymbol: 'FIXT',
    quoteMint: WSOL_MINT,
    quoteSymbol: 'SOL',
    priceUsd: '0.000004089',
    priceNative: '0.00000005243',
    marketCapUsd: '363418575',
    fdvUsd: '400000000',
    liquidityUsd: '122349.87',
    volumeUsd: { m5: '210.6', h1: '6390.7', h6: '26875.2', h24: '260503.7' },
    txns: {
      m5: { buys: 3, sells: 16 },
      h1: { buys: 133, sells: 86 },
      h6: { buys: 819, sells: 656 },
      h24: { buys: 3322, sells: 5608 },
    },
    priceChangePct: { m5: '0.11', h1: '-0.37', h6: '-0.88', h24: '-0.6' },
    pairCreatedAt: 1_671_980_424_000,
    observedAt: null,
    ...overrides,
  };
}

export function candidateWithNoAmounts(
  overrides: Partial<MarketPairCandidate> = {},
): MarketPairCandidate {
  return makeCandidate({
    priceUsd: null,
    priceNative: null,
    marketCapUsd: null,
    fdvUsd: null,
    liquidityUsd: null,
    volumeUsd: emptyWindows<string | null>(null),
    txns: emptyWindows({ buys: null, sells: null }),
    priceChangePct: emptyWindows<string | null>(null),
    ...overrides,
  });
}

/** Injectable provider serving canned candidates (or throwing). */
export class FakeMarketProvider implements MarketDataProvider {
  readonly name = 'fake-market';
  readonly calls: string[][] = [];

  constructor(
    private candidates: Record<string, MarketPairCandidate[]>,
    private options: { configured?: boolean; failWith?: Error } = {},
  ) {}

  isConfigured(): boolean {
    return this.options.configured ?? true;
  }

  async lookupTokens(mints: string[]): Promise<MarketLookupResult> {
    this.calls.push([...mints]);
    if (this.options.failWith) throw this.options.failWith;
    const candidatesByMint = new Map<string, MarketPairCandidate[]>();
    for (const mint of mints) {
      candidatesByMint.set(mint, this.candidates[mint] ?? []);
    }
    return { provider: this.name, fetchedAt: Date.now(), candidatesByMint };
  }
}

/** Raw DexScreener-shaped pair JSON for provider-mapping tests. */
export function rawDexPair(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    chainId: 'solana',
    dexId: 'raydium',
    pairAddress: syntheticAddress(131),
    baseToken: { address: MEME_MINT, name: 'Fixture Meme', symbol: 'FIXT' },
    quoteToken: { address: WSOL_MINT, name: 'Wrapped SOL', symbol: 'SOL' },
    priceNative: '0.00000005243',
    priceUsd: '0.000004089',
    txns: {
      m5: { buys: 3, sells: 16 },
      h1: { buys: 133, sells: 86 },
      h6: { buys: 819, sells: 656 },
      h24: { buys: 3322, sells: 5608 },
    },
    volume: { h24: 260503.7, h6: 26875.2, h1: 6390.7, m5: 210.6 },
    priceChange: { m5: 0.11, h1: -0.37, h6: -0.88, h24: -0.6 },
    liquidity: { usd: 122349.87, base: 23424929975, quote: 340.424 },
    fdv: 400000000,
    marketCap: 363418575,
    pairCreatedAt: 1671980424000,
    ...overrides,
  };
}
