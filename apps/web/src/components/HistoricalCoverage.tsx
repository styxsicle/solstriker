import { useEffect, useState } from 'react';
import { api, type TokenCandleCoverage } from '../api';
import { formatTime, shortAddr } from '../lib/format';

/**
 * Lazily-loaded candle-coverage summary for a token. Read-only; never triggers
 * a backfill. Shows the stored series for the token's most-recent pair/interval.
 */
export function HistoricalCoverage({ mint }: { mint: string }) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [coverage, setCoverage] = useState<TokenCandleCoverage | null>(null);

  useEffect(() => {
    if (!open || loaded) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await api<{ coverage: TokenCandleCoverage }>(
          `/api/historical-market/${mint}/coverage`,
        );
        if (!cancelled) setCoverage(res.coverage);
      } catch {
        if (!cancelled) setCoverage(null);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, loaded, mint]);

  return (
    <div className="historical-coverage">
      <button
        className="btn ghost details-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? 'Hide candle coverage' : 'Candle coverage'}
      </button>
      {open && (
        <div className="coverage-body">
          {!loaded && <span className="status-muted">Loading…</span>}
          {loaded && (!coverage || coverage.status === 'NONE') && (
            <span className="status-muted">No historical candles collected for this token yet.</span>
          )}
          {loaded && coverage && coverage.status !== 'NONE' && (
            <div className="market-grid">
              <Field label="Pair" value={coverage.pairAddress ? shortAddr(coverage.pairAddress) : '—'} />
              <Field label="Interval" value={coverage.interval ?? '—'} />
              <Field label="Candles" value={coverage.candleCount.toLocaleString()} />
              <Field label="Gaps" value={coverage.gapCount.toLocaleString()} />
              <Field label="Earliest" value={formatTime(coverage.earliestCandle)} />
              <Field label="Latest" value={formatTime(coverage.latestCandle)} />
              <Field label="Last backfill" value={formatTime(coverage.lastBackfillAt)} />
              <Field label="Status" value={coverage.status} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="market-field">
      <span className="market-field-label">{label}</span>
      <span className="market-field-value">{value}</span>
    </div>
  );
}
