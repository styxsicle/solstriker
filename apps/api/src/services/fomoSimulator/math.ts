/**
 * FOMO Simulator V1 — paper-trade math.
 *
 * All persisted financial values are exact decimal strings computed with
 * Decimal.js (precision 48, ROUND_HALF_UP — the project-wide configuration
 * from services/walletPositions/math.ts). Native floats are never used for
 * persisted results. Values are stored unrounded at full precision; any
 * shortening happens only at display time in the frontend.
 *
 * Documented model (USD paper positions):
 *   entry fee              = notional × fee rate
 *   quote available        = notional − entry fee
 *   effective entry price  = raw entry price × (1 + entry slippage)
 *   token quantity         = quote available ÷ effective entry price
 *   gross exit value       = token quantity × raw exit price × (1 − exit slippage)
 *   exit fee               = gross exit value × fee rate
 *   net exit value         = gross exit value − exit fee
 *   simulated P/L          = net exit value − original notional
 *   return percent         = simulated P/L ÷ original notional × 100
 *
 * These are simulation assumptions, not real execution costs.
 */
import { D, exact } from '../walletPositions/math.js';

export interface SimulationAssumptions {
  /** Trading fee per side, percent (e.g. "0.3"). */
  feeRatePct: string;
  /** Entry slippage, percent (e.g. "1"). */
  entrySlippagePct: string;
  /** Exit slippage, percent (e.g. "1"). */
  exitSlippagePct: string;
}

export const DEFAULT_ASSUMPTIONS: SimulationAssumptions = {
  feeRatePct: '0.3',
  entrySlippagePct: '1',
  exitSlippagePct: '1',
};

export const DEFAULT_NOTIONAL_USD = '100';
export const MIN_NOTIONAL_USD = 1;
export const MAX_NOTIONAL_USD = 1_000_000;
/** Assumption percentages must be within [0, this] — validated on the backend. */
export const MAX_ASSUMPTION_PCT = 25;

const pctToRate = (pct: string) => D(pct).div(100);

export interface EntryComputation {
  entryFeeUsd: string;
  quoteAvailableUsd: string;
  effectiveEntryPriceUsd: string;
  tokenQuantity: string;
}

export function computeEntry(
  notionalUsd: string,
  rawEntryPriceUsd: string,
  assumptions: SimulationAssumptions,
): EntryComputation {
  const notional = D(notionalUsd);
  const entryFee = notional.mul(pctToRate(assumptions.feeRatePct));
  const quoteAvailable = notional.minus(entryFee);
  const effectivePrice = D(rawEntryPriceUsd).mul(D(1).plus(pctToRate(assumptions.entrySlippagePct)));
  const quantity = quoteAvailable.div(effectivePrice);
  return {
    entryFeeUsd: exact(entryFee)!,
    quoteAvailableUsd: exact(quoteAvailable)!,
    effectiveEntryPriceUsd: exact(effectivePrice)!,
    tokenQuantity: exact(quantity)!,
  };
}

export interface ExitComputation {
  grossExitValueUsd: string;
  exitFeeUsd: string;
  netExitValueUsd: string;
}

/** Also used for unrealized valuations: "what would this be worth if exited now?". */
export function computeExitValue(
  tokenQuantity: string,
  rawExitPriceUsd: string,
  assumptions: SimulationAssumptions,
): ExitComputation {
  const gross = D(tokenQuantity)
    .mul(D(rawExitPriceUsd))
    .mul(D(1).minus(pctToRate(assumptions.exitSlippagePct)));
  const exitFee = gross.mul(pctToRate(assumptions.feeRatePct));
  return {
    grossExitValueUsd: exact(gross)!,
    exitFeeUsd: exact(exitFee)!,
    netExitValueUsd: exact(gross.minus(exitFee))!,
  };
}

export function computePl(netValueUsd: string, notionalUsd: string): { plUsd: string; returnPct: string } {
  const pl = D(netValueUsd).minus(D(notionalUsd));
  return {
    plUsd: exact(pl)!,
    returnPct: exact(pl.div(D(notionalUsd)).mul(100))!,
  };
}
