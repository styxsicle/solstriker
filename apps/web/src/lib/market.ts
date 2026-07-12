// Market-data wording and display formatting.
//
// Exact decimal STRINGS from the API are preserved for Quant Mode. Simple Mode
// humanizes them for readability, but the underlying exact value is always
// available (and shown verbatim in Quant Mode). Unknown values are stated in
// words — never shown as a bare dash or as zero.
import type { Freshness, MarketConfidence, MarketSnapshot } from '../api';

export const NO_MARKET_DATA_TEXT = 'Market data has not been collected for this token yet.';
export const MISSING_FIELD_TEXT = 'Not reported by the selected provider.';

export const MARKET_DEFINITIONS = {
  marketCap: 'An estimate of the token’s circulating value.',
  fdv: 'An estimate of the token’s value if its full supply were circulating.',
  liquidity:
    'How much value is available in the selected trading pool. Low liquidity can make entering and exiting difficult.',
  volume: 'How much trading value passed through the selected pool during this period.',
  priceChange: 'How much the selected pool’s price moved during this period.',
  freshness: 'How recently this market snapshot was collected.',
} as const;

export interface FreshnessInfo {
  label: string;
  tone: 'good' | 'warn' | 'bad' | 'muted';
  icon: string;
}

export function freshnessInfo(freshness: Freshness): FreshnessInfo {
  switch (freshness) {
    case 'FRESH':
      return { label: 'Fresh', tone: 'good', icon: '●' };
    case 'AGING':
      return { label: 'Aging', tone: 'warn', icon: '◐' };
    case 'STALE':
      return { label: 'Stale', tone: 'bad', icon: '○' };
    case 'NEVER_FETCHED':
      return { label: 'Never collected', tone: 'muted', icon: '—' };
    default:
      return { label: 'Unknown', tone: 'muted', icon: '?' };
  }
}

export function confidenceLabel(confidence: MarketConfidence): string {
  switch (confidence) {
    case 'HIGH':
      return 'High';
    case 'MEDIUM':
      return 'Medium';
    case 'LOW':
      return 'Low';
    default:
      return 'Unknown';
  }
}

/** Humanized USD money for Simple Mode ($1.2M, $4,089, $0.000004). */
export function formatUsd(value: string | null): string {
  if (value === null) return MISSING_FIELD_TEXT;
  const n = Number(value);
  if (!Number.isFinite(n)) return MISSING_FIELD_TEXT;
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (abs >= 1) return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  if (abs === 0) return '$0';
  // Sub-dollar prices: keep enough significant digits to be meaningful.
  return `$${n.toLocaleString(undefined, { maximumSignificantDigits: 4 })}`;
}

/** Signed percentage for Simple Mode (+1.2%, -0.6%). */
export function formatPct(value: string | null): string {
  if (value === null) return MISSING_FIELD_TEXT;
  const n = Number(value);
  if (!Number.isFinite(n)) return MISSING_FIELD_TEXT;
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
}

export function pctTone(value: string | null): 'good' | 'bad' | 'muted' {
  if (value === null) return 'muted';
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return 'muted';
  return n > 0 ? 'good' : 'bad';
}

/** True when a token has a usable (COMPLETE/PARTIAL) market snapshot. */
export function hasMarket(market: MarketSnapshot | null | undefined): market is MarketSnapshot {
  return !!market && (market.status === 'COMPLETE' || market.status === 'PARTIAL');
}
