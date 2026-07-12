import { HistoricalProviderError } from './errors.js';
import type { HistoricalMarketProvider } from './historicalMarketProvider.js';
import { createGeckoterminalProvider } from './geckoterminalProvider.js';
import type { HistoricalLookupResult } from './types.js';

/** Placeholder for unknown/disabled provider names. Never fetches. */
function createUnconfiguredProvider(name: string): HistoricalMarketProvider {
  return {
    name,
    isConfigured: () => false,
    supportedIntervals: () => ['1m', '5m', '15m', '1h'],
    fetchCandles(): Promise<HistoricalLookupResult> {
      return Promise.reject(
        new HistoricalProviderError('not_configured', 'historical market provider is not configured'),
      );
    },
  };
}

/**
 * Selects the historical-market provider. Phase 1D-B2 ships GeckoTerminal
 * (credential-free); the factory lets a keyed or additional provider be added
 * without touching consumers. `none` yields a disabled provider so the app
 * boots and tests run with no historical provider configured.
 */
export function createHistoricalMarketProvider(
  providerName: string | undefined,
): HistoricalMarketProvider {
  const name = (providerName ?? 'geckoterminal').trim().toLowerCase();
  if (name === 'geckoterminal') return createGeckoterminalProvider();
  if (name === 'none' || name === '') return createUnconfiguredProvider('none');
  return createUnconfiguredProvider(name);
}
