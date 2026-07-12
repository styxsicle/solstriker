import { useEffect, useState } from 'react';
import { api, type ActivityEvent, type WalletEntryOutcome } from '../api';
import type { InterfaceMode } from '../lib/mode';
import { formatTime } from '../lib/format';
import {
  ENTRY_METHOD_TEXT,
  formatDelay,
  formatReturn,
  formatUsdPrice,
  isOutcomeEligible,
  NO_OUTCOME_TEXT,
  OUTCOME_WARNING,
  outcomeStatusText,
  returnTone,
} from '../lib/outcomes';

/**
 * Collapsed "Historical outcome" section for an eligible BUY event. Lazily
 * fetches the stored outcome (never triggers calculation). Renders nothing for
 * ineligible events (transfers/sells) so they never show an outcome panel.
 */
export function HistoricalOutcome({
  event,
  mode,
}: {
  event: ActivityEvent;
  mode: InterfaceMode;
}) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [outcome, setOutcome] = useState<WalletEntryOutcome | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!open || loaded) return;
    let cancelled = false;
    void (async () => {
      try {
        const data = await api<WalletEntryOutcome>(`/api/wallet-entry-outcomes/${event.id}`);
        if (!cancelled) setOutcome(data);
      } catch {
        if (!cancelled) setMissing(true);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, loaded, event.id]);

  if (!isOutcomeEligible(event)) return null;

  return (
    <div className="historical-outcome">
      <button
        className="btn ghost details-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? 'Hide historical outcome' : 'Historical outcome'}
      </button>
      {open && (
        <div className="outcome-body">
          {!loaded && <p className="status-muted">Loading…</p>}
          {loaded && (missing || outcome === null) && (
            <p className="status-muted">{NO_OUTCOME_TEXT}</p>
          )}
          {loaded && outcome && outcome.status === 'UNAVAILABLE' && (
            <p className="status-muted">{NO_OUTCOME_TEXT}</p>
          )}
          {loaded && outcome && outcome.status !== 'UNAVAILABLE' && (
            <OutcomeContent outcome={outcome} mode={mode} />
          )}
        </div>
      )}
    </div>
  );
}

function OutcomeContent({
  outcome,
  mode,
}: {
  outcome: WalletEntryOutcome;
  mode: InterfaceMode;
}) {
  const statusText = outcomeStatusText(outcome);
  return (
    <div>
      <p className="notice warn" role="note">
        {OUTCOME_WARNING}
      </p>
      {statusText && <p className="status-warn">{statusText}</p>}

      {mode === 'simple' ? (
        <div className="market-grid">
          <Field
            label="Estimated entry price"
            value={formatUsdPrice(outcome.entryPriceUsd)}
            title={ENTRY_METHOD_TEXT[outcome.entryPriceMethod]}
          />
          <Field label="Entry method" value={outcome.entryPriceMethod} />
          <Field label="Delay to first candle" value={formatDelay(outcome.entryDelaySeconds)} />
          <ReturnField label="After 5 minutes" value={outcome.return5mPct} />
          <ReturnField label="After 30 minutes" value={outcome.return30mPct} />
          <ReturnField label="After 1 hour" value={outcome.return1hPct} />
          <ReturnField label="After 4 hours" value={outcome.return4hPct} />
          <ReturnField label="After 24 hours" value={outcome.return24hPct} />
          <ReturnField label="Max gain (first hour)" value={outcome.maxReturn1hPct} />
          <ReturnField label="Max downside (first hour)" value={outcome.maxDrawdown1hPct} />
          <ReturnField label="Max gain (first 24h)" value={outcome.maxReturn24hPct} />
          <ReturnField label="Max downside (first 24h)" value={outcome.maxDrawdown24hPct} />
          <Field label="Time to max (24h)" value={formatDelay(outcome.timeToMax24hSeconds)} />
          <Field label="Coverage" value={outcome.status} />
          <Field label="Confidence" value={outcome.confidence} />
        </div>
      ) : (
        <dl className="kv">
          <QuantRow label="Pair" value={outcome.pairAddress} mono />
          <QuantRow label="Entry method" value={outcome.entryPriceMethod} />
          <QuantRow label="Entry candle" value={formatTime(outcome.entryCandleTime)} />
          <QuantRow label="Entry delay (s)" value={strOrDash(outcome.entryDelaySeconds)} />
          <QuantRow label="Entry price USD" value={outcome.entryPriceUsd} mono />
          <QuantRow label="price 1m" value={outcome.price1mUsd} mono />
          <QuantRow label="price 5m" value={outcome.price5mUsd} mono />
          <QuantRow label="price 15m" value={outcome.price15mUsd} mono />
          <QuantRow label="price 30m" value={outcome.price30mUsd} mono />
          <QuantRow label="price 1h" value={outcome.price1hUsd} mono />
          <QuantRow label="price 4h" value={outcome.price4hUsd} mono />
          <QuantRow label="price 24h" value={outcome.price24hUsd} mono />
          <QuantRow label="return 1m %" value={outcome.return1mPct} mono />
          <QuantRow label="return 5m %" value={outcome.return5mPct} mono />
          <QuantRow label="return 15m %" value={outcome.return15mPct} mono />
          <QuantRow label="return 30m %" value={outcome.return30mPct} mono />
          <QuantRow label="return 1h %" value={outcome.return1hPct} mono />
          <QuantRow label="return 4h %" value={outcome.return4hPct} mono />
          <QuantRow label="return 24h %" value={outcome.return24hPct} mono />
          <QuantRow label="max 1h %" value={outcome.maxReturn1hPct} mono />
          <QuantRow label="drawdown 1h %" value={outcome.maxDrawdown1hPct} mono />
          <QuantRow label="time→max 1h (s)" value={strOrDash(outcome.timeToMax1hSeconds)} />
          <QuantRow label="max 24h %" value={outcome.maxReturn24hPct} mono />
          <QuantRow label="drawdown 24h %" value={outcome.maxDrawdown24hPct} mono />
          <QuantRow label="time→max 24h (s)" value={strOrDash(outcome.timeToMax24hSeconds)} />
          <QuantRow label="coverage start" value={formatTime(outcome.coverageStart)} />
          <QuantRow label="coverage end" value={formatTime(outcome.coverageEnd)} />
          <QuantRow label="missing windows" value={String(outcome.missingWindowCount)} />
          <QuantRow label="status" value={outcome.status} />
          <QuantRow label="confidence" value={outcome.confidence} />
          <QuantRow label="calc version" value={String(outcome.calculationVersion)} />
          <QuantRow label="calculated at" value={formatTime(outcome.calculatedAt)} />
        </dl>
      )}
    </div>
  );
}

function strOrDash(n: number | null): string {
  return n === null ? '—' : String(n);
}

function Field({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="market-field">
      <span className="market-field-label" title={title}>
        {label}
      </span>
      <span className="market-field-value">{value}</span>
    </div>
  );
}

function ReturnField({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="market-field">
      <span className="market-field-label">{label}</span>
      <span className={`market-field-value status-${returnTone(value)}`}>{formatReturn(value)}</span>
    </div>
  );
}

function QuantRow({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div className="kv-row">
      <dt>{label}</dt>
      <dd className={mono ? 'mono' : undefined}>
        {value ?? <span className="status-muted">unknown</span>}
      </dd>
    </div>
  );
}
