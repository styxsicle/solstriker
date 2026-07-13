import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  api,
  type BackfillRunResult,
  type MarketSnapshot,
  type RefreshRunResult,
  type TokenListResponse,
} from '../api';
import { HistoricalCoverage } from '../components/HistoricalCoverage';
import { useMode } from '../lib/mode';
import { formatTime, shortAddr } from '../lib/format';
import {
  confidenceLabel,
  formatPct,
  formatUsd,
  freshnessInfo,
  hasMarket,
  MARKET_DEFINITIONS,
  MISSING_FIELD_TEXT,
  NO_MARKET_DATA_TEXT,
  pctTone,
} from '../lib/market';
import { PageHeader } from '../components/PageHeader';

const MAX_SELECTED = 20;
const MAX_BACKFILL = 5;
const INTERVALS = ['1m', '5m', '15m', '1h'] as const;

/** Default backfill window: the last 24 hours (ISO, minute-bounded). */
function defaultRange(): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end.getTime() - 24 * 3600 * 1000);
  const toLocalInput = (d: Date) => d.toISOString().slice(0, 16);
  return { start: toLocalInput(start), end: toLocalInput(end) };
}

function sanitizedBackfillError(code: string): string {
  switch (code) {
    case 'provider_not_configured':
      return 'The historical market-data provider is not configured.';
    case 'invalid_range':
      return 'The end time must be after the start time.';
    case 'range_too_large':
      return 'That time range is too large for the selected interval. Choose a shorter range.';
    case 'rate_limited':
      return 'The historical provider temporarily rate-limited this request. Try again in a moment.';
    case 'timeout':
      return 'The historical data request timed out. Try again in a moment.';
    default:
      return 'Historical candles could not be collected.';
  }
}

function sanitizedRefreshError(code: string): string {
  switch (code) {
    case 'rate_limited':
      return 'The market-data provider temporarily rate-limited this request. Try again in a moment.';
    case 'timeout':
      return 'The market-data request timed out. Try again in a moment.';
    case 'network_error':
      return 'Could not reach the market-data provider. Check your connection and try again.';
    case 'not_found':
    case 'NOT_FOUND':
      return 'No supported Solana trading pair was found for this token.';
    default:
      return 'Market data could not be collected for this token.';
  }
}

/** A labelled value cell that never shows a bare dash in Simple Mode. */
function Field({
  label,
  value,
  title,
  tone,
}: {
  label: string;
  value: string;
  title?: string;
  tone?: string;
}) {
  return (
    <div className="market-field">
      <span className="market-field-label" title={title}>
        {label}
      </span>
      <span className={`market-field-value ${tone ?? ''}`}>{value}</span>
    </div>
  );
}

/** The small set of fields a beginner sees first. Everything else — provider
 * identity, pair-selection detail, raw snapshot status, exact timestamps —
 * moves into "More details" or Quant Mode. */
function SimpleMarket({ market }: { market: MarketSnapshot }) {
  const fresh = freshnessInfo(market.freshness);
  return (
    <>
      <div className="market-grid">
        <Field
          label="Price (USD)"
          value={market.priceUsd === null ? MISSING_FIELD_TEXT : formatUsd(market.priceUsd)}
        />
        <Field label="Market cap" value={formatUsd(market.marketCapUsd)} title={MARKET_DEFINITIONS.marketCap} />
        <Field label="Liquidity" value={formatUsd(market.liquidityUsd)} title={MARKET_DEFINITIONS.liquidity} />
        <Field label="Volume (24h)" value={formatUsd(market.volume24hUsd)} title={MARKET_DEFINITIONS.volume} />
        <Field
          label="Price change (24h)"
          value={formatPct(market.priceChange24hPct)}
          title={MARKET_DEFINITIONS.priceChange}
          tone={`status-${pctTone(market.priceChange24hPct)}`}
        />
        <Field label="Freshness" value={fresh.label} tone={`status-${fresh.tone}`} title={MARKET_DEFINITIONS.freshness} />
      </div>
      <details className="helper">
        <summary>More details</summary>
        <div className="market-grid">
          <Field label="FDV" value={formatUsd(market.fdvUsd)} title={MARKET_DEFINITIONS.fdv} />
          <Field
            label="Price change (1h)"
            value={formatPct(market.priceChange1hPct)}
            title={MARKET_DEFINITIONS.priceChange}
            tone={`status-${pctTone(market.priceChange1hPct)}`}
          />
          <Field label="DEX" value={market.dex ?? MISSING_FIELD_TEXT} />
          <Field
            label="Pair"
            value={market.pairAddress ? shortAddr(market.pairAddress) : MISSING_FIELD_TEXT}
          />
          <Field
            label="Last collected"
            value={formatTime(market.observedAt)}
            title={MARKET_DEFINITIONS.freshness}
          />
          <Field label="Provider" value={market.source} />
        </div>
      </details>
    </>
  );
}

export function TokensPage() {
  const { mode } = useMode();
  const [data, setData] = useState<TokenListResponse | null>(null);
  const [search, setSearch] = useState('');
  const [showDev, setShowDev] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState<RefreshRunResult | null>(null);
  const [interval, setInterval] = useState<(typeof INTERVALS)[number]>('1m');
  const [range, setRange] = useState(defaultRange);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState<BackfillRunResult | null>(null);
  const [backfillError, setBackfillError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ withMarket: 'true' });
      if (!showDev) params.set('includeDev', 'false');
      setData(await api<TokenListResponse>(`/api/tokens?${params.toString()}`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [showDev]);

  useEffect(() => {
    void load();
  }, [load]);

  const eligible = useMemo(
    () => (data?.items ?? []).filter((t) => t.source !== 'dev-seed'),
    [data],
  );

  // Every token is already loaded (the backend returns the full list, no
  // pagination), so a client-side filter here is a real search over all
  // discovered tokens — not the "first page only" bug pattern. Respects the
  // existing includeDev fetch param rather than unconditionally excluding
  // development records.
  const searched = useMemo(() => {
    const source = data?.items ?? [];
    const needle = search.trim().toLowerCase();
    if (!needle) return source;
    return source.filter(
      (t) =>
        (t.name ?? '').toLowerCase().includes(needle) ||
        (t.symbol ?? '').toLowerCase().includes(needle) ||
        t.mintAddress.toLowerCase().includes(needle),
    );
  }, [data, search]);

  function toggle(id: string, isDev: boolean) {
    if (isDev) return; // dev tokens are never refreshable
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_SELECTED) next.add(id);
      return next;
    });
  }

  function selectVisible() {
    setSelected(new Set(eligible.slice(0, MAX_SELECTED).map((t) => t.id)));
  }

  function clearSelection() {
    setSelected(new Set());
  }

  async function refreshSelected() {
    if (selected.size === 0 || refreshing) return;
    setRefreshing(true);
    setError(null);
    setRefreshResult(null);
    try {
      const result = await api<RefreshRunResult>('/api/token-metrics/refresh', {
        method: 'POST',
        body: JSON.stringify({ tokens: [...selected] }),
      });
      setRefreshResult(result);
      setSelected(new Set());
      await load();
    } catch (e) {
      const code = (e as Error).message;
      setError(
        code === 'provider_not_configured'
          ? 'The market-data provider is not configured.'
          : sanitizedRefreshError(code),
      );
    } finally {
      setRefreshing(false);
    }
  }

  async function backfillSelected() {
    if (selected.size === 0 || selected.size > MAX_BACKFILL || backfilling) return;
    const startMs = new Date(range.start).getTime();
    const endMs = new Date(range.end).getTime();
    if (!(endMs > startMs)) {
      setBackfillError('The end time must be after the start time.');
      return;
    }
    setBackfilling(true);
    setBackfillError(null);
    setBackfillResult(null);
    try {
      const result = await api<BackfillRunResult>('/api/historical-market/backfill', {
        method: 'POST',
        body: JSON.stringify({
          tokens: [...selected],
          interval,
          start: new Date(range.start).toISOString(),
          end: new Date(range.end).toISOString(),
        }),
      });
      setBackfillResult(result);
    } catch (e) {
      setBackfillError(sanitizedBackfillError((e as Error).message));
    } finally {
      setBackfilling(false);
    }
  }

  const atLimit = selected.size >= MAX_SELECTED;

  const snapshotSection = (
    <section className="panel" aria-labelledby="tokens-refresh">
      <h2 id="tokens-refresh">Collect market snapshots</h2>
      <p className="panel-sub">
        Select up to <strong>{MAX_SELECTED} tokens</strong> and collect a current market snapshot
        for each. Start with 1–5 tokens. Development tokens cannot be refreshed.
      </p>
      <div className="toolbar" role="group" aria-label="Snapshot selection controls">
        <button className="btn secondary" onClick={selectVisible} disabled={eligible.length === 0}>
          Select visible tokens
        </button>
        <button className="btn secondary" onClick={clearSelection} disabled={selected.size === 0}>
          Clear selection
        </button>
        <span className={`badge ${atLimit ? 'warn' : 'muted'}`} aria-live="polite">
          {selected.size} / {MAX_SELECTED} selected
        </span>
        <button
          className="btn"
          onClick={() => void refreshSelected()}
          disabled={selected.size === 0 || refreshing}
          aria-busy={refreshing}
        >
          {refreshing ? 'Collecting…' : `Refresh ${selected.size || ''} selected`}
        </button>
      </div>
      {atLimit && (
        <p className="panel-sub" role="status">
          You have reached the {MAX_SELECTED}-token maximum for one refresh.
        </p>
      )}
      {refreshResult && (
        <div className="import-summary" role="status">
          <span className="status-good">
            <strong>{refreshResult.complete}</strong> complete
          </span>
          <span className="status-warn">
            <strong>{refreshResult.partial}</strong> partial
          </span>
          <span className="status-muted">
            <strong>{refreshResult.notFound}</strong> no pair found
          </span>
          <span className="status-bad">
            <strong>{refreshResult.failed}</strong> failed
          </span>
          <span className="status-muted">provider: {refreshResult.provider}</span>
        </div>
      )}
    </section>
  );

  const backfillSection = (
    <section className="panel" aria-labelledby="tokens-backfill">
      <h2 id="tokens-backfill">Collect historical candles</h2>
      <p className="panel-sub">
        Download historical price candles for a token's current market pair, then later measure
        what happened after each tracked-wallet buy. Uses the tokens selected above (max{' '}
        <strong>{MAX_BACKFILL}</strong>; start with 1–2). This is historical evidence only — not a
        prediction.
      </p>
      {backfillError && (
        <p className="notice danger" role="alert">
          {backfillError}
        </p>
      )}
      <div className="toolbar" role="group" aria-label="Historical backfill controls">
        <label className="field">
          Interval
          <select
            value={interval}
            onChange={(e) => setInterval(e.target.value as (typeof INTERVALS)[number])}
          >
            {INTERVALS.map((iv) => (
              <option key={iv} value={iv}>
                {iv}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Start (UTC)
          <input
            type="datetime-local"
            value={range.start}
            onChange={(e) => setRange((r) => ({ ...r, start: e.target.value }))}
          />
        </label>
        <label className="field">
          End (UTC)
          <input
            type="datetime-local"
            value={range.end}
            onChange={(e) => setRange((r) => ({ ...r, end: e.target.value }))}
          />
        </label>
        <button
          className="btn"
          style={{ alignSelf: 'flex-end' }}
          onClick={() => void backfillSelected()}
          disabled={selected.size === 0 || selected.size > MAX_BACKFILL || backfilling}
          aria-busy={backfilling}
        >
          {backfilling ? 'Collecting…' : `Backfill ${selected.size || ''} selected`}
        </button>
      </div>
      {selected.size > MAX_BACKFILL && (
        <p className="panel-sub status-warn" role="status">
          Select at most {MAX_BACKFILL} tokens to backfill candles.
        </p>
      )}
      {backfillResult && (
        <div className="import-summary" role="status">
          <span className="status-good">
            <strong>{backfillResult.complete}</strong> complete
          </span>
          <span className="status-warn">
            <strong>{backfillResult.partial}</strong> partial
          </span>
          <span className="status-muted">
            <strong>{backfillResult.notFound}</strong> no pair/candles
          </span>
          <span className="status-bad">
            <strong>{backfillResult.failed}</strong> failed
          </span>
          <span className="status-muted">
            <strong>{backfillResult.candlesInserted}</strong> candles added
          </span>
          <span className="status-muted">
            <strong>{backfillResult.gapCount}</strong> gaps
          </span>
        </div>
      )}
    </section>
  );

  return (
    <div>
      <PageHeader
        title={mode === 'simple' ? 'Coin Check' : 'Tokens'}
        subtitle="Tokens appear here only after they are discovered through synchronized wallet activity — this is not a live token scanner."
      />

      <p className="notice warn" role="note">
        <strong>Full token safety checks are not built yet.</strong> Contract safety, bundle
        analysis, holder analysis, creator-history analysis, sellability checks and price
        predictions are all <strong>not implemented</strong>. Market snapshots below are collected
        manually and are historical evidence only.
      </p>

      {error && (
        <p className="notice danger" role="alert">
          {error}
        </p>
      )}

      {mode === 'simple' ? (
        <>
          <section className="panel" aria-labelledby="tokens-search">
            <h2 id="tokens-search">Search discovered tokens</h2>
            <label className="field">
              Search
              <input
                type="text"
                placeholder="Name, symbol or mint address"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <SimpleTokenList
              tokens={searched}
              selected={selected}
              atLimit={atLimit}
              onToggle={toggle}
            />
          </section>

          <details className="helper advanced-disclosure">
            <summary>Advanced token research options</summary>
            {snapshotSection}
            {backfillSection}
            <section className="panel">
              <label className="check">
                <input
                  type="checkbox"
                  checked={showDev}
                  onChange={(e) => {
                    setShowDev(e.target.checked);
                    setSelected(new Set());
                  }}
                />
                Show development records
              </label>
            </section>
          </details>
        </>
      ) : (
        <>
          {snapshotSection}
          {backfillSection}

          <section className="panel" aria-labelledby="tokens-table">
            <div className="toolbar" style={{ justifyContent: 'space-between' }}>
              <h2 id="tokens-table">Discovered tokens {data ? `(${data.total.toLocaleString()})` : ''}</h2>
              <label className="check">
                <input
                  type="checkbox"
                  checked={showDev}
                  onChange={(e) => {
                    setShowDev(e.target.checked);
                    setSelected(new Set());
                  }}
                />
                Show development records
              </label>
            </div>
            <QuantTokenTable
              tokens={data?.items ?? null}
              selected={selected}
              atLimit={atLimit}
              onToggle={toggle}
            />
          </section>
        </>
      )}
    </div>
  );
}

interface ListProps {
  tokens: TokenListResponse['items'] | null;
  selected: Set<string>;
  atLimit: boolean;
  onToggle: (id: string, isDev: boolean) => void;
}

function SimpleTokenList({ tokens, selected, atLimit, onToggle }: ListProps) {
  if (tokens && tokens.length === 0) {
    return (
      <div className="empty-state">
        <p>No tokens discovered yet.</p>
        <p className="status-muted">
          Sync wallet activity on the Activity page — tokens that tracked wallets trade will appear
          here automatically.
        </p>
      </div>
    );
  }
  return (
    <ol className="token-cards" aria-label="Discovered tokens">
      {tokens?.map((t) => {
        const isDev = t.source === 'dev-seed';
        const checked = selected.has(t.id);
        return (
          <li key={t.id} className="token-card">
            <div className="token-card-top">
              {!isDev && (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!checked && atLimit}
                    onChange={() => onToggle(t.id, isDev)}
                    aria-label={`Select ${t.symbol ?? shortAddr(t.mintAddress)} for refresh`}
                  />
                </label>
              )}
              <span className="token-name">
                {t.name ?? <span className="status-muted">(name not fetched yet)</span>}
                {t.symbol && <span className="token-symbol"> {t.symbol}</span>}
              </span>
              {isDev && <span className="badge warn">DEV</span>}
              <a
                className="mono token-mint"
                href={`https://solscan.io/token/${t.mintAddress}`}
                target="_blank"
                rel="noreferrer"
              >
                {shortAddr(t.mintAddress)}
              </a>
            </div>
            {hasMarket(t.market) ? (
              <SimpleMarket market={t.market} />
            ) : (
              <p className="status-muted token-no-market">{NO_MARKET_DATA_TEXT}</p>
            )}
            {!isDev && <HistoricalCoverage mint={t.mintAddress} />}
          </li>
        );
      })}
    </ol>
  );
}

function decimalOrDash(value: string | null): React.ReactNode {
  return value === null ? <span className="status-muted">unknown</span> : value;
}

function QuantTokenTable({ tokens, selected, atLimit, onToggle }: ListProps) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">
              <span className="visually-hidden">Select</span>
            </th>
            <th scope="col">Name</th>
            <th scope="col">Symbol</th>
            <th scope="col">Mint</th>
            <th scope="col">Stage</th>
            <th scope="col">Source</th>
            <th scope="col" className="num">Price USD</th>
            <th scope="col" className="num">Price SOL</th>
            <th scope="col" className="num">Market cap</th>
            <th scope="col" className="num">FDV</th>
            <th scope="col" className="num">Liquidity</th>
            <th scope="col" className="num">Vol 5m</th>
            <th scope="col" className="num">Vol 1h</th>
            <th scope="col" className="num">Vol 6h</th>
            <th scope="col" className="num">Vol 24h</th>
            <th scope="col" className="num">Buys/Sells 24h</th>
            <th scope="col" className="num">Δ 5m</th>
            <th scope="col" className="num">Δ 1h</th>
            <th scope="col" className="num">Δ 6h</th>
            <th scope="col" className="num">Δ 24h</th>
            <th scope="col">DEX</th>
            <th scope="col">Pair</th>
            <th scope="col">Base</th>
            <th scope="col">Quote</th>
            <th scope="col">Status</th>
            <th scope="col">Conf.</th>
            <th scope="col">Selection</th>
            <th scope="col">Provider</th>
            <th scope="col">Observed</th>
            <th scope="col">Fetched</th>
            <th scope="col">Age (s)</th>
            <th scope="col">Freshness</th>
            <th scope="col">Discovered</th>
            <th scope="col">Last seen</th>
          </tr>
        </thead>
        <tbody>
          {tokens?.map((t) => {
            const isDev = t.source === 'dev-seed';
            const checked = selected.has(t.id);
            const m = t.market ?? null;
            return (
              <tr key={t.id}>
                <td>
                  {!isDev && (
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!checked && atLimit}
                      onChange={() => onToggle(t.id, isDev)}
                      aria-label={`Select ${t.symbol ?? shortAddr(t.mintAddress)} for refresh`}
                    />
                  )}
                </td>
                <td>
                  {t.name ?? <span className="status-muted">—</span>}{' '}
                  {isDev && <span className="badge warn">DEV</span>}
                </td>
                <td>{t.symbol ?? '—'}</td>
                <td className="mono">
                  <a href={`https://solscan.io/token/${t.mintAddress}`} target="_blank" rel="noreferrer">
                    {shortAddr(t.mintAddress)}
                  </a>
                </td>
                <td>
                  <span
                    className={`badge ${
                      t.stage === 'MIGRATED' ? 'good' : t.stage === 'FINAL_STRETCH' ? 'warn' : 'muted'
                    }`}
                  >
                    {t.stage}
                  </span>
                </td>
                <td>
                  <span className="badge muted">{t.source}</span>
                </td>
                <td className="num mono">{decimalOrDash(m?.priceUsd ?? null)}</td>
                <td className="num mono">{decimalOrDash(m?.priceSol ?? null)}</td>
                <td className="num mono">{decimalOrDash(m?.marketCapUsd ?? null)}</td>
                <td className="num mono">{decimalOrDash(m?.fdvUsd ?? null)}</td>
                <td className="num mono">{decimalOrDash(m?.liquidityUsd ?? null)}</td>
                <td className="num mono">{decimalOrDash(m?.volume5mUsd ?? null)}</td>
                <td className="num mono">{decimalOrDash(m?.volume1hUsd ?? null)}</td>
                <td className="num mono">{decimalOrDash(m?.volume6hUsd ?? null)}</td>
                <td className="num mono">{decimalOrDash(m?.volume24hUsd ?? null)}</td>
                <td className="num mono">
                  {m ? `${m.buys24h ?? '—'} / ${m.sells24h ?? '—'}` : <span className="status-muted">—</span>}
                </td>
                <td className="num mono">{decimalOrDash(m?.priceChange5mPct ?? null)}</td>
                <td className="num mono">{decimalOrDash(m?.priceChange1hPct ?? null)}</td>
                <td className="num mono">{decimalOrDash(m?.priceChange6hPct ?? null)}</td>
                <td className="num mono">{decimalOrDash(m?.priceChange24hPct ?? null)}</td>
                <td>{m?.dex ?? <span className="status-muted">—</span>}</td>
                <td className="mono">{m?.pairAddress ? shortAddr(m.pairAddress) : '—'}</td>
                <td className="mono">{m?.baseMint ? shortAddr(m.baseMint) : '—'}</td>
                <td className="mono">{m?.quoteMint ? shortAddr(m.quoteMint) : '—'}</td>
                <td>{m ? <span className="badge muted">{m.status}</span> : '—'}</td>
                <td>{m ? confidenceLabel(m.confidence) : '—'}</td>
                <td className="mono">{m?.selectionReason ?? '—'}</td>
                <td>{m?.source ?? '—'}</td>
                <td className="status-muted">{m ? formatTime(m.observedAt) : '—'}</td>
                <td className="status-muted">{m ? formatTime(m.fetchedAt) : '—'}</td>
                <td className="num">{m?.ageSeconds ?? '—'}</td>
                <td>{m ? freshnessInfo(m.freshness).label : <span className="status-muted">Never collected</span>}</td>
                <td className="status-muted">{new Date(t.discoveredAt).toLocaleString()}</td>
                <td className="status-muted">{new Date(t.lastSeenAt).toLocaleString()}</td>
              </tr>
            );
          })}
          {tokens && tokens.length === 0 && (
            <tr>
              <td colSpan={34}>
                <div className="empty-state">No tokens discovered yet.</div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
