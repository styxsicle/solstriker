import { MarketProviderError } from './errors.js';
import type { MarketDataProvider } from './marketDataProvider.js';
import { createDexscreenerProvider } from './dexscreenerProvider.js';
import type { MarketLookupResult } from './types.js';

/** Placeholder returned for unknown/disabled provider names. Never fetches. */
function createUnconfiguredProvider(name: string): MarketDataProvider {
  return {
    name,
    isConfigured: () => false,
    lookupTokens(): Promise<MarketLookupResult> {
      return Promise.reject(
        new MarketProviderError('not_configured', 'market data provider is not configured'),
      );
    },
  };
}

/**
 * Selects the market-data provider. Phase 1D-B1 ships exactly one
 * (DexScreener, credential-free); the factory exists so a keyed or additional
 * provider can be added without touching consumers.
 */
export function createMarketDataProvider(
  providerName: string | undefined,
): MarketDataProvider {
  const name = (providerName ?? 'dexscreener').trim().toLowerCase();
  if (name === 'dexscreener') return createDexscreenerProvider();
  if (name === 'none' || name === '') return createUnconfiguredProvider('none');
  return createUnconfiguredProvider(name);
}
