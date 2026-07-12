import { WSOL_MINT } from '@memecoin-lab/shared';
import type { PairSelection } from '../../providers/market/pairSelection.js';

/**
 * Builds the snapshot column payload from one selected pair.
 * Unknown values stay null (never zero). Market cap and FDV are stored
 * strictly separately — one is never substituted for the other.
 */

export type SnapshotStatus = 'COMPLETE' | 'PARTIAL' | 'NOT_FOUND' | 'ERROR';

export interface SnapshotFields {
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
  status: SnapshotStatus;
}

const EMPTY: Omit<SnapshotFields, 'status'> = {
  priceUsd: null,
  priceSol: null,
  marketCapUsd: null,
  fdvUsd: null,
  liquidityUsd: null,
  volume5mUsd: null,
  volume1hUsd: null,
  volume6hUsd: null,
  volume24hUsd: null,
  buys5m: null,
  sells5m: null,
  buys1h: null,
  sells1h: null,
  buys6h: null,
  sells6h: null,
  buys24h: null,
  sells24h: null,
  priceChange5mPct: null,
  priceChange1hPct: null,
  priceChange6hPct: null,
  priceChange24hPct: null,
  pairAddress: null,
  dex: null,
  baseMint: null,
  quoteMint: null,
  tokenName: null,
  tokenSymbol: null,
};

export function emptySnapshotFields(status: SnapshotStatus): SnapshotFields {
  return { ...EMPTY, status };
}

export function snapshotFieldsFromSelection(selection: PairSelection): SnapshotFields {
  const pair = selection.pair;
  if (!pair) return emptySnapshotFields('NOT_FOUND');

  const identityOnly: SnapshotFields = {
    ...EMPTY,
    pairAddress: pair.pairAddress,
    dex: pair.dex,
    baseMint: pair.baseMint,
    quoteMint: pair.quoteMint,
    status: 'PARTIAL',
  };

  // Quote-side-only (or unpriced) selections preserve identity, not amounts:
  // inverting prices or reusing base-token figures would be guessing.
  if (!selection.mintIsBase || pair.priceUsd === null) {
    return identityOnly;
  }

  const fields: SnapshotFields = {
    priceUsd: pair.priceUsd,
    // priceNative is the base price in QUOTE units — it is a SOL price only
    // when the selected pair is actually SOL-quoted.
    priceSol: pair.quoteMint === WSOL_MINT ? pair.priceNative : null,
    marketCapUsd: pair.marketCapUsd,
    fdvUsd: pair.fdvUsd,
    liquidityUsd: pair.liquidityUsd,
    volume5mUsd: pair.volumeUsd.m5,
    volume1hUsd: pair.volumeUsd.h1,
    volume6hUsd: pair.volumeUsd.h6,
    volume24hUsd: pair.volumeUsd.h24,
    buys5m: pair.txns.m5.buys,
    sells5m: pair.txns.m5.sells,
    buys1h: pair.txns.h1.buys,
    sells1h: pair.txns.h1.sells,
    buys6h: pair.txns.h6.buys,
    sells6h: pair.txns.h6.sells,
    buys24h: pair.txns.h24.buys,
    sells24h: pair.txns.h24.sells,
    priceChange5mPct: pair.priceChangePct.m5,
    priceChange1hPct: pair.priceChangePct.h1,
    priceChange6hPct: pair.priceChangePct.h6,
    priceChange24hPct: pair.priceChangePct.h24,
    pairAddress: pair.pairAddress,
    dex: pair.dex,
    baseMint: pair.baseMint,
    quoteMint: pair.quoteMint,
    tokenName: pair.baseName,
    tokenSymbol: pair.baseSymbol,
    status: 'PARTIAL',
  };

  // COMPLETE requires the core figures a researcher needs: price, liquidity,
  // 24h volume, and at least one supply-based valuation (market cap or FDV —
  // still stored separately; this is only a completeness gate).
  const complete =
    fields.priceUsd !== null &&
    fields.liquidityUsd !== null &&
    fields.volume24hUsd !== null &&
    (fields.marketCapUsd !== null || fields.fdvUsd !== null);
  fields.status = complete ? 'COMPLETE' : 'PARTIAL';
  return fields;
}
