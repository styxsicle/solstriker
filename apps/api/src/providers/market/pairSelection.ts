import { STABLE_MINTS, WSOL_MINT } from '@memecoin-lab/shared';
import type { MarketPairCandidate } from './types.js';

/**
 * Deterministic pair selection for one requested mint.
 *
 * Only Solana pairs that actually contain the mint with a valid pair address
 * are considered. Pairs where the mint is the BASE token are preferred and
 * required for price data; if the mint only ever appears as the QUOTE token,
 * price inversion would be unreliable, so identity is preserved without
 * amounts (PARTIAL, reason `token_only_appears_as_quote`).
 *
 * Ranking (spec order): usable data → higher USD liquidity → higher recent
 * volume (24h, then 1h) → more recent pair creation → preferred quote asset
 * (SOL, then USDC/USDT, then others) → pair address as a stable tie-breaker.
 *
 * All values stored for a token come from the ONE selected pair — liquidity,
 * volume, price changes, and market cap are never combined across pools.
 */

export type SelectionConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';

export interface PairSelection {
  pair: MarketPairCandidate | null;
  /** True when the mint is the base token of the selected pair. */
  mintIsBase: boolean;
  reason: string;
  confidence: SelectionConfidence;
}

const QUOTE_PREFERENCE = new Map<string, number>([
  [WSOL_MINT, 0],
  ...STABLE_MINTS.map((mint, i) => [mint, i + 1] as [string, number]),
]);

function quoteRank(candidate: MarketPairCandidate): number {
  if (!candidate.quoteMint) return 99;
  return QUOTE_PREFERENCE.get(candidate.quoteMint) ?? 10;
}

const num = (value: string | null): number | null => {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** Descending compare with nulls last. */
function compareDesc(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

function comparePairs(a: MarketPairCandidate, b: MarketPairCandidate): number {
  return (
    compareDesc(num(a.liquidityUsd), num(b.liquidityUsd)) ||
    compareDesc(num(a.volumeUsd.h24), num(b.volumeUsd.h24)) ||
    compareDesc(num(a.volumeUsd.h1), num(b.volumeUsd.h1)) ||
    compareDesc(a.pairCreatedAt, b.pairCreatedAt) ||
    quoteRank(a) - quoteRank(b) ||
    a.pairAddress.localeCompare(b.pairAddress)
  );
}

export function selectionConfidence(pair: MarketPairCandidate): SelectionConfidence {
  const hasPrice = num(pair.priceUsd) !== null;
  const hasLiquidity = num(pair.liquidityUsd) !== null;
  const hasVolume = num(pair.volumeUsd.h24) !== null;
  if (hasPrice && hasLiquidity && hasVolume) return 'HIGH';
  if (hasPrice && (hasLiquidity || hasVolume)) return 'MEDIUM';
  if (hasPrice) return 'LOW';
  return 'UNKNOWN';
}

export function selectBestPair(
  mint: string,
  candidates: MarketPairCandidate[],
): PairSelection {
  const onSolana = candidates.filter(
    (c) =>
      c.chainId === 'solana' &&
      c.pairAddress !== '' &&
      (c.baseMint === mint || c.quoteMint === mint),
  );
  if (onSolana.length === 0) {
    return { pair: null, mintIsBase: false, reason: 'no_solana_pair', confidence: 'UNKNOWN' };
  }

  // Deduplicate provider repeats of the same pair address deterministically.
  const byAddress = new Map<string, MarketPairCandidate>();
  for (const candidate of onSolana) {
    if (!byAddress.has(candidate.pairAddress)) byAddress.set(candidate.pairAddress, candidate);
  }
  const unique = [...byAddress.values()];

  // Price data is only trustworthy when the mint is the base token.
  const baseSide = unique.filter((c) => c.baseMint === mint);
  const pricedBase = baseSide.filter((c) => num(c.priceUsd) !== null).sort(comparePairs);

  if (pricedBase.length > 0) {
    const pair = pricedBase[0];
    const reason =
      pricedBase.length === 1
        ? 'only_usable_pair'
        : num(pair.liquidityUsd) !== null
          ? 'highest_liquidity'
          : num(pair.volumeUsd.h24) !== null
            ? 'highest_volume_no_liquidity_reported'
            : 'deterministic_fallback_order';
    return { pair, mintIsBase: true, reason, confidence: selectionConfidence(pair) };
  }

  if (baseSide.length > 0) {
    // A pair exists but its price is not parseable — preserve pair identity
    // and whatever fields are valid without guessing the price.
    const pair = [...baseSide].sort(comparePairs)[0];
    return { pair, mintIsBase: true, reason: 'no_parseable_price', confidence: 'UNKNOWN' };
  }

  const quoteSide = unique.filter((c) => c.quoteMint === mint).sort(comparePairs);
  if (quoteSide.length > 0) {
    // Inverting base-token prices into quote-token prices is not reliably
    // supported by the provider's units — preserve identity, not amounts.
    return {
      pair: quoteSide[0],
      mintIsBase: false,
      reason: 'token_only_appears_as_quote',
      confidence: 'UNKNOWN',
    };
  }

  return {
    pair: null,
    mintIsBase: false,
    reason: 'no_pair_with_parseable_price',
    confidence: 'UNKNOWN',
  };
}
