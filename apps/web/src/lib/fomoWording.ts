/**
 * FOMO Simulator V1 — display wording only. Actions and convictions are
 * always derived by the backend; this module just formats them.
 */
import type { PaperAction, PaperConviction } from '../api';

/** "BUY — HIGH CONVICTION", "EXIT", "NO TRADE" — the direct, lead answer. */
export function paperActionHeadline(action: PaperAction, conviction: PaperConviction): string {
  const label = action.replace('_', ' ');
  // Direction-free actions stand alone; conviction only qualifies BUY/HOLD.
  if (action === 'BUY' || action === 'HOLD') return `${label} — ${conviction} CONVICTION`;
  return label;
}

/** "+$18.40" / "-$16.70" — display rounding only; stored values stay exact. */
export function formatPlUsd(value: string | null): string {
  if (value === null) return '—';
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '—';
  const sign = amount > 0 ? '+' : amount < 0 ? '-' : '';
  return `${sign}$${Math.abs(amount).toFixed(2)}`;
}

/** "+18.4%" / "-16.7%" — display rounding only. */
export function formatReturnPct(value: string | null): string {
  if (value === null) return '—';
  const pct = Number(value);
  if (!Number.isFinite(pct)) return '—';
  const sign = pct > 0 ? '+' : pct < 0 ? '-' : '';
  return `${sign}${Math.abs(pct).toFixed(1)}%`;
}

export function plClass(value: string | null): string {
  if (value === null) return '';
  const amount = Number(value);
  return amount > 0 ? 'status-good' : amount < 0 ? 'status-warn' : '';
}
