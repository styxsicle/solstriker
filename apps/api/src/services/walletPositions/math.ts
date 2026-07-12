import { Decimal } from 'decimal.js';

Decimal.set({ precision: 48, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -30, toExpPos: 40 });

export const D = (value: Decimal.Value) => new Decimal(value);
export const exact = (value: Decimal | null): string | null => value?.toFixed() ?? null;
export const pct = (numerator: Decimal | null, denominator: Decimal | null): string | null => {
  if (numerator === null || denominator === null || denominator.isZero()) return null;
  return numerator.div(denominator).mul(100).toFixed();
};

export function quantile(values: Decimal[], q: number): Decimal | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a.comparedTo(b));
  const index = (sorted.length - 1) * q;
  const low = Math.floor(index);
  const fraction = D(index - low);
  return sorted[low].plus((sorted[Math.ceil(index)] ?? sorted[low]).minus(sorted[low]).mul(fraction));
}

export function sum(values: (Decimal | null)[]): Decimal | null {
  const known = values.filter((v): v is Decimal => v !== null);
  return known.length === 0 ? null : known.reduce((a, b) => a.plus(b), D(0));
}
