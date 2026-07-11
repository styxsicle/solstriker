// Phase 1C decoding fixtures: fee separation, venue/router preservation,
// and the exact real-world Pump.fun case that exposed the quote bug
// (reproduced here with the same amounts but synthetic addresses).
import { describe, expect, it } from 'vitest';
import { syntheticAddress } from '@memecoin-lab/shared';
import { normalizeTransaction } from '../../src/services/activity/normalizeTransaction.js';
import {
  heuristicBuyTx,
  pumpRouterBuyTx,
  pumpRouterSellTx,
  swapBuyTx,
  swapSellTx,
  tokenToTokenSwapTx,
  TOKEN_ACCOUNT_RENT_LAMPORTS,
} from './fixtures.js';

const WALLET = syntheticAddress(90);
const MEME = syntheticAddress(91);
const MEME2 = syntheticAddress(92);
const UNKNOWN_ROUTER_FEE_VAULT = syntheticAddress(93);

describe('instruction-reconstructed Pump.fun buy (the real bug transaction, exact numbers)', () => {
  // Mirrors the on-chain reality of the reported transaction: NO decoded swap
  // event; Pump.fun runs as an inner instruction under an Axiom-style router.
  // Swap input = 1.49205632 (curve) + 0.004476169 + 0.007087268 + 0.007087268
  // (venue fee legs) = exactly 1.510707025 SOL. Router fees (0.011080092 +
  // 0.015259666), own-ATA rent (0.00207408), and the network fee (0.000307)
  // are NOT part of the swap input. Old decoder reported 1.539120863.
  const tx = pumpRouterBuyTx(WALLET, MEME, {
    tokenAmount: 15_606_894.907348,
    curveSol: 1.49205632,
    venueFeeSols: [0.004476169, 0.007087268, 0.007087268],
    routerFeeSols: [0.011080092, 0.015259666],
    rentLamports: 2_074_080,
    feeLamports: 307_000,
    source: 'PUMP_FUN',
  });

  it('recovers the exact swap input from the venue instruction accounts', () => {
    const events = normalizeTransaction(WALLET, tx);
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event).toMatchObject({
      eventType: 'BUY',
      confidence: 'CONFIRMED',
      venue: 'PUMP_FUN',
      quoteMint: 'SOL',
      quoteAmount: 1.510707025,
      swapInAmount: 1.510707025,
      swapOutAmount: 15_606_894.907348,
    });
    expect(event.quoteAmount).not.toBe(1.539120863); // the old wrong value
  });

  it('buckets router fees, rent, and network fee outside the swap and reconciles to zero', () => {
    const [event] = normalizeTransaction(WALLET, tx);
    const b = event.breakdown;
    expect(b.platformFeeSol).toBeCloseTo(0.026339758, 9); // both router fee legs
    expect(b.rentSol).toBeCloseTo(0.00207408, 9);
    expect(b.networkFeeSol).toBeCloseTo(0.000307, 9);
    expect(b.priorityFeeSol).toBeCloseTo(0.000302, 9);
    expect(b.walletSolChange).toBeCloseTo(-1.539427863, 9);
    expect(b.unattributedSol).toBeCloseTo(0, 9);
  });
});

describe('instruction-reconstructed Pump.fun sell (proceeds credited by the program)', () => {
  it('recovers exact proceeds from the wallet balance identity', () => {
    const [event] = normalizeTransaction(
      WALLET,
      pumpRouterSellTx(WALLET, MEME, {
        tokenAmount: 15_241_684.830358,
        proceedsSol: 1.000449718,
        routerFeeSols: [0.003, 0.010004497],
        feeLamports: 364_039,
      }),
    );
    expect(event).toMatchObject({
      eventType: 'SELL',
      confidence: 'CONFIRMED',
      venue: 'PUMP_FUN',
      quoteMint: 'SOL',
      quoteAmount: 1.000449718,
      swapOutMint: 'SOL',
      swapOutAmount: 1.000449718,
    });
    expect(event.breakdown.platformFeeSol).toBeCloseTo(0.013004497, 9);
    expect(event.breakdown.walletSolChange).toBeCloseTo(0.987081182, 9);
    expect(event.breakdown.unattributedSol).toBeCloseTo(0, 9);
    expect(event.explanation).toContain('exact wallet balance change');
  });

  it('excludes ATA-close rent refunds from the proceeds', () => {
    const [event] = normalizeTransaction(
      WALLET,
      pumpRouterSellTx(WALLET, MEME, {
        proceedsSol: 1.000449718,
        routerFeeSols: [0.003],
        closeAtaRefundLamports: 2_039_280,
      }),
    );
    expect(event.quoteAmount).toBe(1.000449718); // refund not counted as proceeds
    expect(event.breakdown.rentSol).toBeCloseTo(-0.00203928, 9); // net refund
    expect(event.breakdown.unattributedSol).toBeCloseTo(0, 9);
  });
});

describe('provider-decoded swap event (synthetic legs with the same amounts)', () => {
  const tx = swapBuyTx(WALLET, MEME, {
    solAmount: 1.510707025,
    tokenAmount: 15_606_894.907348,
    platformFeeSol: 0.01510707,
    tipSol: 0.01,
    rentLamports: TOKEN_ACCOUNT_RENT_LAMPORTS,
    feeLamports: 105_000, // 5000 base + 100000 priority
    source: 'PUMP_FUN',
  });

  it('reports the exact swap input as the quote', () => {
    const [event] = normalizeTransaction(WALLET, tx);
    expect(event.eventType).toBe('BUY');
    expect(event.confidence).toBe('CONFIRMED');
    expect(event.quoteAmount).toBe(1.510707025);
    expect(event.tokenAmount).toBe(15_606_894.907348);
    expect(event.swapInAmount).toBe(1.510707025);
    expect(event.swapOutAmount).toBe(15_606_894.907348);
  });

  it('separates every SOL outflow into its own bucket and reconciles to zero', () => {
    const [event] = normalizeTransaction(WALLET, tx);
    const b = event.breakdown;
    expect(b.networkFeeSol).toBeCloseTo(0.000105, 9);
    expect(b.priorityFeeSol).toBeCloseTo(0.0001, 9);
    expect(b.platformFeeSol).toBeCloseTo(0.01510707, 9);
    expect(b.tipSol).toBeCloseTo(0.01, 9);
    expect(b.rentSol).toBeCloseTo(0.00203928, 9);
    expect(b.walletSolChange).toBeCloseTo(
      -(1.510707025 + 0.01510707 + 0.01 + 0.00203928 + 0.000105),
      9,
    );
    expect(b.unattributedSol).toBeCloseTo(0, 9);
    // Total outflow differs from swap input — the exact bug being fixed.
    expect(Math.abs(b.walletSolChange!)).toBeGreaterThan(event.quoteAmount!);
  });
});

describe('router-mediated buy (e.g. Axiom → Pump AMM) with unknown fee vault', () => {
  const tx = swapBuyTx(WALLET, MEME, {
    solAmount: 0.8,
    tokenAmount: 2_000_000,
    source: 'AXIOM',
    innerVenues: ['PUMP_AMM'],
    platformFeeSol: 0.008,
    platformFeeAccount: UNKNOWN_ROUTER_FEE_VAULT, // not in the known-accounts set
    tipSol: 0.005,
  });

  it('keeps router and venue separate and still counts the decoded fee once', () => {
    const [event] = normalizeTransaction(WALLET, tx);
    expect(event).toMatchObject({
      eventType: 'BUY',
      confidence: 'CONFIRMED',
      source: 'AXIOM',
      venue: 'PUMP_AMM',
      quoteAmount: 0.8,
    });
    // Fee leg came from the decoded swap event (nativeFees), despite the
    // unknown vault address; it must not be double-counted or unattributed.
    expect(event.breakdown.platformFeeSol).toBeCloseTo(0.008, 9);
    expect(event.breakdown.tipSol).toBeCloseTo(0.005, 9);
    expect(event.breakdown.unattributedSol).toBeCloseTo(0, 9);
  });
});

describe('Pump AMM partial sell', () => {
  it('decodes exact proceeds with platform fee separated', () => {
    const [event] = normalizeTransaction(
      WALLET,
      swapSellTx(WALLET, MEME, {
        tokenAmount: 5_000_000, // partial position
        solAmount: 0.42,
        platformFeeSol: 0.0042,
        source: 'PUMP_AMM',
      }),
    );
    expect(event).toMatchObject({
      eventType: 'SELL',
      confidence: 'CONFIRMED',
      quoteMint: 'SOL',
      quoteAmount: 0.42,
      venue: 'PUMP_AMM',
    });
    expect(event.breakdown.platformFeeSol).toBeCloseTo(0.0042, 9);
    expect(event.breakdown.walletSolChange).toBeCloseTo(0.42 - 0.0042 - 0.000005, 9);
    expect(event.breakdown.unattributedSol).toBeCloseTo(0, 9);
  });
});

describe('Jupiter-routed and Raydium swaps', () => {
  it('Jupiter multi-leg token→token: two CONFIRMED events, venue from inner swaps', () => {
    const events = normalizeTransaction(
      WALLET,
      tokenToTokenSwapTx(WALLET, MEME, MEME2, { source: 'JUPITER', innerVenues: ['RAYDIUM'] }),
    );
    expect(events).toHaveLength(2);
    for (const event of events) {
      expect(event.source).toBe('JUPITER');
      expect(event.venue).toBe('RAYDIUM');
      expect(event.confidence).toBe('CONFIRMED');
      expect(event.signature).toBe(events[0].signature);
    }
  });

  it('direct Raydium SOL buy decodes with venue RAYDIUM', () => {
    const [event] = normalizeTransaction(
      WALLET,
      swapBuyTx(WALLET, MEME, { source: 'RAYDIUM', solAmount: 3.3, tokenAmount: 42 }),
    );
    expect(event).toMatchObject({ venue: 'RAYDIUM', quoteAmount: 3.3, confidence: 'CONFIRMED' });
  });
});

describe('fee and side-flow attribution', () => {
  it('splits network fee into base and priority', () => {
    const [event] = normalizeTransaction(
      WALLET,
      swapBuyTx(WALLET, MEME, { feeLamports: 505_000 }),
    );
    expect(event.breakdown.networkFeeSol).toBeCloseTo(0.000505, 9);
    expect(event.breakdown.priorityFeeSol).toBeCloseTo(0.0005, 9);
  });

  it('records associated-token-account rent separately', () => {
    const [event] = normalizeTransaction(
      WALLET,
      swapBuyTx(WALLET, MEME, { rentLamports: TOKEN_ACCOUNT_RENT_LAMPORTS }),
    );
    expect(event.breakdown.rentSol).toBeCloseTo(0.00203928, 9);
    expect(event.breakdown.unattributedSol).toBeCloseTo(0, 9);
  });

  it('classifies an unrelated SOL transfer in the same transaction without touching the quote', () => {
    const [event] = normalizeTransaction(
      WALLET,
      swapBuyTx(WALLET, MEME, { solAmount: 1.2, unrelatedOutSol: 0.25 }),
    );
    expect(event.quoteAmount).toBe(1.2);
    expect(event.breakdown.unrelatedSolOut).toBeCloseTo(0.25, 9);
    expect(event.breakdown.unattributedSol).toBeCloseTo(0, 9);
    expect(event.explanation).toContain('unrelated transfers out 0.25');
  });

  it('records a missing quote as unknown with the outflow unattributed (never guessed)', () => {
    const [event] = normalizeTransaction(
      WALLET,
      heuristicBuyTx(WALLET, MEME, { solAmount: 2.0 }),
    );
    expect(event.quoteAmount).toBeNull();
    expect(event.confidence).toBe('LIKELY');
    expect(event.breakdown.unattributedSol).toBeCloseTo(-2.0, 9);
    expect(event.breakdown.walletSolChange).toBeCloseTo(-2.000005, 9);
  });

  it('handles missing account data by reporting the wallet change as unknown', () => {
    const [event] = normalizeTransaction(
      WALLET,
      swapBuyTx(WALLET, MEME, { omitAccountData: true }),
    );
    expect(event.confidence).toBe('CONFIRMED'); // swap legs are still exact
    expect(event.breakdown.walletSolChange).toBeNull();
    expect(event.breakdown.unattributedSol).toBeNull();
  });
});
