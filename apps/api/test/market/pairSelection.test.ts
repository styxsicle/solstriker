import { describe, expect, it } from 'vitest';
import { syntheticAddress, WSOL_MINT } from '@memecoin-lab/shared';
import { selectBestPair } from '../../src/providers/market/pairSelection.js';
import { snapshotFieldsFromSelection } from '../../src/services/tokenMetrics/normalization.js';
import { candidateWithNoAmounts, makeCandidate, MEME_MINT, USDC_MINT } from './fixtures.js';

describe('pair selection policy', () => {
  it('selects the single valid pair', () => {
    const selection = selectBestPair(MEME_MINT, [makeCandidate()]);
    expect(selection.pair).not.toBeNull();
    expect(selection.mintIsBase).toBe(true);
    expect(selection.reason).toBe('only_usable_pair');
    expect(selection.confidence).toBe('HIGH');
  });

  it('prefers the pair with the highest USD liquidity', () => {
    const low = makeCandidate({ pairAddress: 'PairLow1111', liquidityUsd: '1000' });
    const high = makeCandidate({ pairAddress: 'PairHigh111', liquidityUsd: '999999' });
    const selection = selectBestPair(MEME_MINT, [low, high]);
    expect(selection.pair!.pairAddress).toBe('PairHigh111');
    expect(selection.reason).toBe('highest_liquidity');
  });

  it('falls back to volume, then recency, then quote preference, then address order', () => {
    const noLiquidityHighVolume = makeCandidate({
      pairAddress: 'PairVol1111',
      liquidityUsd: null,
      volumeUsd: { m5: null, h1: null, h6: null, h24: '5000' },
    });
    const noLiquidityLowVolume = makeCandidate({
      pairAddress: 'PairVol2222',
      liquidityUsd: null,
      volumeUsd: { m5: null, h1: null, h6: null, h24: '10' },
    });
    const byVolume = selectBestPair(MEME_MINT, [noLiquidityLowVolume, noLiquidityHighVolume]);
    expect(byVolume.pair!.pairAddress).toBe('PairVol1111');
    expect(byVolume.reason).toBe('highest_volume_no_liquidity_reported');

    // Everything identical except quote asset: SOL beats USDC beats other.
    const other = candidateWithNoAmounts({
      pairAddress: 'PairBBB',
      priceUsd: '1',
      quoteMint: syntheticAddress(140),
    });
    const usdc = candidateWithNoAmounts({
      pairAddress: 'PairCCC',
      priceUsd: '1',
      quoteMint: USDC_MINT,
    });
    const sol = candidateWithNoAmounts({
      pairAddress: 'PairDDD',
      priceUsd: '1',
      quoteMint: WSOL_MINT,
    });
    for (const c of [other, usdc, sol]) c.pairCreatedAt = 1;
    expect(selectBestPair(MEME_MINT, [other, usdc, sol]).pair!.pairAddress).toBe('PairDDD');
    expect(selectBestPair(MEME_MINT, [other, usdc]).pair!.pairAddress).toBe('PairCCC');

    // Full tie → deterministic pair-address order.
    const tieA = candidateWithNoAmounts({ pairAddress: 'PairA', priceUsd: '1', pairCreatedAt: 1 });
    const tieB = candidateWithNoAmounts({ pairAddress: 'PairB', priceUsd: '1', pairCreatedAt: 1 });
    expect(selectBestPair(MEME_MINT, [tieB, tieA]).pair!.pairAddress).toBe('PairA');
    expect(selectBestPair(MEME_MINT, [tieA, tieB]).pair!.pairAddress).toBe('PairA');
  });

  it('ignores non-Solana pairs and pairs that do not contain the mint', () => {
    const wrongChain = makeCandidate({ chainId: 'ethereum' });
    const wrongMint = makeCandidate({ baseMint: syntheticAddress(141) });
    const selection = selectBestPair(MEME_MINT, [wrongChain, wrongMint]);
    expect(selection.pair).toBeNull();
    expect(selection.reason).toBe('no_solana_pair');
  });

  it('deduplicates repeated provider pairs by address', () => {
    const pair = makeCandidate({ pairAddress: 'PairDup1111' });
    const selection = selectBestPair(MEME_MINT, [pair, { ...pair }]);
    expect(selection.pair!.pairAddress).toBe('PairDup1111');
  });

  it('never invents a price when the mint only appears as the quote token', () => {
    const quoteSide = makeCandidate({
      baseMint: syntheticAddress(142),
      baseName: 'Other Token',
      quoteMint: MEME_MINT,
    });
    const selection = selectBestPair(MEME_MINT, [quoteSide]);
    expect(selection.mintIsBase).toBe(false);
    expect(selection.reason).toBe('token_only_appears_as_quote');
    expect(selection.confidence).toBe('UNKNOWN');
    const fields = snapshotFieldsFromSelection(selection);
    expect(fields.status).toBe('PARTIAL');
    expect(fields.priceUsd).toBeNull(); // no inverted price
    expect(fields.marketCapUsd).toBeNull(); // no borrowed base-token figures
    expect(fields.pairAddress).toBe(selection.pair!.pairAddress); // identity kept
  });

  it('preserves pair identity when no price is parseable', () => {
    const unpriced = candidateWithNoAmounts();
    const selection = selectBestPair(MEME_MINT, [unpriced]);
    expect(selection.reason).toBe('no_parseable_price');
    expect(selection.confidence).toBe('UNKNOWN');
    expect(snapshotFieldsFromSelection(selection).status).toBe('PARTIAL');
  });
});

describe('normalization and confidence', () => {
  it('marks fully populated pairs COMPLETE with HIGH confidence', () => {
    const selection = selectBestPair(MEME_MINT, [makeCandidate()]);
    const fields = snapshotFieldsFromSelection(selection);
    expect(fields.status).toBe('COMPLETE');
    expect(selection.confidence).toBe('HIGH');
    // Exact decimal strings preserved; marketCap and FDV stay separate values.
    expect(fields.priceUsd).toBe('0.000004089');
    expect(fields.marketCapUsd).toBe('363418575');
    expect(fields.fdvUsd).toBe('400000000');
    expect(fields.priceSol).toBe('0.00000005243'); // SOL-quoted pair
  });

  it('missing liquidity → PARTIAL with MEDIUM confidence, liquidity stays null', () => {
    const selection = selectBestPair(MEME_MINT, [makeCandidate({ liquidityUsd: null })]);
    const fields = snapshotFieldsFromSelection(selection);
    expect(fields.status).toBe('PARTIAL');
    expect(selection.confidence).toBe('MEDIUM');
    expect(fields.liquidityUsd).toBeNull(); // never zero
  });

  it('missing market cap AND FDV → PARTIAL; FDV is never used as market cap', () => {
    const selection = selectBestPair(MEME_MINT, [
      makeCandidate({ marketCapUsd: null, fdvUsd: null }),
    ]);
    const fields = snapshotFieldsFromSelection(selection);
    expect(fields.status).toBe('PARTIAL');
    expect(fields.marketCapUsd).toBeNull();
    expect(fields.fdvUsd).toBeNull();

    const fdvOnly = snapshotFieldsFromSelection(
      selectBestPair(MEME_MINT, [makeCandidate({ marketCapUsd: null })]),
    );
    expect(fdvOnly.marketCapUsd).toBeNull(); // FDV not substituted
    expect(fdvOnly.fdvUsd).toBe('400000000');
  });

  it('missing volume → PARTIAL and no priceSol for non-SOL quotes', () => {
    const selection = selectBestPair(MEME_MINT, [
      makeCandidate({
        quoteMint: USDC_MINT,
        volumeUsd: { m5: null, h1: null, h6: null, h24: null },
      }),
    ]);
    const fields = snapshotFieldsFromSelection(selection);
    expect(fields.status).toBe('PARTIAL');
    expect(fields.volume24hUsd).toBeNull();
    expect(fields.priceSol).toBeNull(); // priceNative is USDC units here, not SOL
  });
});
