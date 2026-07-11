import { useCallback, useEffect, useState } from 'react';
import {
  api,
  type ActivityEventsResponse,
  type SyncResponse,
  type SyncResult,
  type SyncStatusResponse,
  type Wallet,
  type WalletListResponse,
} from '../api';

const EVENT_TYPES = ['BUY', 'SELL', 'TOKEN_TRANSFER_IN', 'TOKEN_TRANSFER_OUT'] as const;
const MAX_SELECTED = 10;
const TX_CAP_CHOICES = [100, 200, 500];

function shortAddr(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

function typeClass(eventType: string): string {
  if (eventType === 'BUY') return 'status-good';
  if (eventType === 'SELL') return 'status-bad';
  return 'status-muted';
}

function formatAmount(value: number | null): string {
  if (value === null) return '—';
  if (Math.abs(value) >= 1000) {
    return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function formatSol(value: number | null): string {
  if (value === null) return '—';
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 9 })} SOL`;
}

function confidenceClass(confidence: string | null): string {
  if (confidence === 'CONFIRMED') return 'status-good';
  if (confidence === 'LIKELY') return 'status-warn';
  return 'status-muted';
}

function hasUnattributed(value: number | null): boolean {
  return value !== null && Math.abs(value) > 1e-9;
}

export function ActivityPage() {
  const [error, setError] = useState<string | null>(null);

  // Wallet picker
  const [walletSearch, setWalletSearch] = useState('');
  const [candidates, setCandidates] = useState<Wallet[]>([]);
  const [selected, setSelected] = useState<Wallet[]>([]);
  const [txCap, setTxCap] = useState(200);

  // Sync
  const [syncing, setSyncing] = useState(false);
  const [syncResults, setSyncResults] = useState<SyncResult[] | null>(null);

  // Status + events
  const [status, setStatus] = useState<SyncStatusResponse | null>(null);
  const [events, setEvents] = useState<ActivityEventsResponse | null>(null);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventPage, setEventPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState('');
  const [walletFilter, setWalletFilter] = useState('');
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [resyncingId, setResyncingId] = useState<string | null>(null);

  const loadCandidates = useCallback(async () => {
    try {
      const params = new URLSearchParams({ enabled: 'true', page: '1', pageSize: '25' });
      if (walletSearch.trim()) params.set('search', walletSearch.trim());
      const res = await api<WalletListResponse>(`/api/wallets?${params.toString()}`);
      setCandidates(res.items);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [walletSearch]);

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await api<SyncStatusResponse>('/api/activity/status'));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const loadEvents = useCallback(async () => {
    setEventsLoading(true);
    try {
      const params = new URLSearchParams({ page: String(eventPage), pageSize: '50' });
      if (typeFilter) params.set('eventType', typeFilter);
      if (walletFilter) params.set('walletId', walletFilter);
      setEvents(await api<ActivityEventsResponse>(`/api/activity/events?${params.toString()}`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEventsLoading(false);
    }
  }, [eventPage, typeFilter, walletFilter]);

  useEffect(() => {
    void loadCandidates();
  }, [loadCandidates]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  function toggleSelect(wallet: Wallet) {
    setSelected((current) => {
      if (current.some((w) => w.id === wallet.id)) {
        return current.filter((w) => w.id !== wallet.id);
      }
      if (current.length >= MAX_SELECTED) return current;
      return [...current, wallet];
    });
  }

  async function runSync() {
    if (selected.length === 0 || syncing) return;
    setSyncing(true);
    setSyncResults(null);
    setError(null);
    try {
      const res = await api<SyncResponse>('/api/activity/sync', {
        method: 'POST',
        body: JSON.stringify({
          walletIds: selected.map((w) => w.id),
          maxTransactions: txCap,
        }),
      });
      setSyncResults(res.results);
      await Promise.all([loadStatus(), loadEvents()]);
    } catch (e) {
      const message = (e as Error).message;
      setError(
        message === 'provider_not_configured'
          ? 'No Helius API key configured — set HELIUS_API_KEY in .env to enable activity sync.'
          : message,
      );
    } finally {
      setSyncing(false);
    }
  }

  async function resyncWallet(walletId: string, label: string) {
    const confirmed = window.confirm(
      `Re-sync "${label}"? This clears this wallet's stored events and re-fetches its history with the current decoder. Other wallets are not affected.`,
    );
    if (!confirmed) return;
    setResyncingId(walletId);
    setError(null);
    try {
      await api<SyncResponse>('/api/activity/resync', {
        method: 'POST',
        body: JSON.stringify({ walletIds: [walletId], maxTransactions: txCap }),
      });
      await Promise.all([loadStatus(), loadEvents()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setResyncingId(null);
    }
  }

  const providerConfigured = status?.providerConfigured ?? true;
  const labelFor = (w: { label: string | null; emoji: string | null; address: string }) =>
    `${w.emoji ? `${w.emoji} ` : ''}${w.label ?? shortAddr(w.address)}`;

  return (
    <div>
      <div className="notice">
        Historical, read-only sync. Select up to <strong>{MAX_SELECTED} wallets per run</strong>{' '}
        (start with 1–5) — with 1,000+ tracked wallets, bulk syncing is deliberately not
        supported in this phase. Live monitoring is a later phase.
      </div>

      {!providerConfigured && (
        <div className="error-box">
          Activity sync is unavailable: no Helius API key is configured. Add{' '}
          <code>HELIUS_API_KEY</code> to the root <code>.env</code> (backend only) and restart.
        </div>
      )}
      {error && <div className="error-box">Error: {error}</div>}

      <div className="panel">
        <h2>Select wallets to sync</h2>
        <div className="toolbar">
          <input
            type="text"
            placeholder="Search enabled wallets…"
            value={walletSearch}
            onChange={(e) => setWalletSearch(e.target.value)}
            style={{ minWidth: 260 }}
          />
          <span className="hint" style={{ margin: 0 }}>
            {selected.length}/{MAX_SELECTED} selected
          </span>
        </div>

        {selected.length > 0 && (
          <div className="toolbar" style={{ flexWrap: 'wrap' }}>
            {selected.map((w) => (
              <button
                key={w.id}
                className="toggle on"
                title="Remove from selection"
                onClick={() => toggleSelect(w)}
              >
                {labelFor(w)} ✕
              </button>
            ))}
          </div>
        )}

        <table>
          <thead>
            <tr>
              <th style={{ width: 40 }}></th>
              <th>Wallet</th>
              <th>Address</th>
              <th>Groups</th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((w) => {
              const checked = selected.some((s) => s.id === w.id);
              const full = !checked && selected.length >= MAX_SELECTED;
              return (
                <tr key={w.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={full}
                      onChange={() => toggleSelect(w)}
                    />
                  </td>
                  <td>{labelFor(w)}</td>
                  <td className="mono">{shortAddr(w.address)}</td>
                  <td>
                    {w.groups.map((g) => (
                      <span key={g} className="pill">
                        {g}
                      </span>
                    ))}
                  </td>
                </tr>
              );
            })}
            {candidates.length === 0 && (
              <tr>
                <td colSpan={4} className="status-muted">
                  No enabled wallets match. Import wallets on the Tracked wallets tab first.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="toolbar" style={{ marginTop: 12 }}>
          <label className="hint" style={{ margin: 0 }}>
            Max transactions per wallet:{' '}
            <select value={txCap} onChange={(e) => setTxCap(Number(e.target.value))}>
              {TX_CAP_CHOICES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <button
            className="btn"
            disabled={selected.length === 0 || syncing || !providerConfigured}
            onClick={() => void runSync()}
          >
            {syncing
              ? 'Syncing… (this can take a while)'
              : `Sync ${selected.length || ''} wallet${selected.length === 1 ? '' : 's'}`}
          </button>
        </div>

        {syncResults && (
          <table style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Wallet</th>
                <th>Status</th>
                <th>Transactions</th>
                <th>Events created</th>
                <th>Duplicates</th>
                <th>New tokens</th>
                <th>Backfill</th>
              </tr>
            </thead>
            <tbody>
              {syncResults.map((r) => (
                <tr key={r.walletId}>
                  <td className="mono">{shortAddr(r.address)}</td>
                  <td>
                    <span
                      className={
                        r.status === 'ok'
                          ? 'status-good'
                          : r.status === 'locked'
                            ? 'status-warn'
                            : 'status-bad'
                      }
                    >
                      {r.status}
                      {r.error ? ` (${r.error})` : ''}
                    </span>
                  </td>
                  <td>{r.transactionsProcessed}</td>
                  <td>{r.eventsCreated}</td>
                  <td>{r.duplicateEvents}</td>
                  <td>{r.tokensDiscovered}</td>
                  <td>
                    {r.backfillComplete === null ? '—' : r.backfillComplete ? 'complete' : 'partial — sync again to continue'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <h2>Sync status</h2>
        <div className="toolbar">
          <button className="btn secondary" onClick={() => void loadStatus()}>
            Refresh
          </button>
        </div>
        <table>
          <thead>
            <tr>
              <th>Wallet</th>
              <th>Address</th>
              <th>Status</th>
              <th>Backfill</th>
              <th>Transactions</th>
              <th>Events</th>
              <th>Last sync</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {status?.items.map((s) => (
              <tr key={s.walletId}>
                <td>{labelFor(s)}</td>
                <td className="mono">{shortAddr(s.address)}</td>
                <td>
                  <span
                    className={
                      s.status === 'error'
                        ? 'status-bad'
                        : s.status === 'syncing'
                          ? 'status-warn'
                          : 'status-good'
                    }
                  >
                    {s.status}
                    {s.lastError ? ` (${s.lastError})` : ''}
                  </span>
                </td>
                <td>{s.backfillComplete ? 'complete' : 'partial'}</td>
                <td>{s.totalTransactions.toLocaleString()}</td>
                <td>{s.totalEvents.toLocaleString()}</td>
                <td className="status-muted">
                  {s.lastSyncAt ? new Date(s.lastSyncAt).toLocaleString() : '—'}
                </td>
                <td>
                  <button
                    className="toggle"
                    title="Clear this wallet's events and re-fetch with the current decoder"
                    disabled={resyncingId !== null || !providerConfigured}
                    onClick={() => void resyncWallet(s.walletId, s.label ?? shortAddr(s.address))}
                  >
                    {resyncingId === s.walletId ? 'Re-syncing…' : 'Re-sync'}
                  </button>
                </td>
              </tr>
            ))}
            {status && status.items.length === 0 && (
              <tr>
                <td colSpan={8} className="status-muted">
                  Nothing synced yet. Select wallets above and run a sync.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <p className="hint">
          Events stored before the current decoder are marked in the feed below; use Re-sync to
          re-decode a wallet's history (raw transaction payloads are not stored locally, so
          re-decoding requires re-fetching).
        </p>
      </div>

      <div className="panel">
        <h2>Wallet events {events ? `(${events.total.toLocaleString()})` : ''}</h2>
        <div className="toolbar">
          <select
            value={walletFilter}
            onChange={(e) => {
              setWalletFilter(e.target.value);
              setEventPage(1);
            }}
          >
            <option value="">All synced wallets</option>
            {status?.items.map((s) => (
              <option key={s.walletId} value={s.walletId}>
                {s.label ?? shortAddr(s.address)}
              </option>
            ))}
          </select>
          <select
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value);
              setEventPage(1);
            }}
          >
            <option value="">All event types</option>
            {EVENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          {eventsLoading && <span className="status-muted">Loading…</span>}
        </div>

        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Wallet</th>
              <th>Type</th>
              <th>Token</th>
              <th>Amount</th>
              <th>Swap quote</th>
              <th>Wallet Δ SOL</th>
              <th>Router → venue</th>
              <th>Conf.</th>
              <th>Tx</th>
            </tr>
          </thead>
          <tbody>
            {events?.items.map((e) => {
              const isTrade = e.eventType === 'BUY' || e.eventType === 'SELL';
              const quoteUnknown = isTrade && e.quoteAmount === null;
              const warn = hasUnattributed(e.unattributedSol) || e.decoderVersion < 2;
              const expanded = expandedEventId === e.id;
              return [
                <tr
                  key={e.id}
                  onClick={() => setExpandedEventId(expanded ? null : e.id)}
                  style={{ cursor: 'pointer' }}
                  title="Click for the full decoding breakdown"
                >
                  <td className="status-muted">
                    {e.blockTime ? new Date(e.blockTime).toLocaleString() : '—'}
                  </td>
                  <td>{labelFor(e.wallet)}</td>
                  <td>
                    <span className={`pill ${typeClass(e.eventType)}`}>{e.eventType}</span>
                  </td>
                  <td className="mono">
                    {e.token ? (
                      <a
                        href={`https://solscan.io/token/${e.token.mintAddress}`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(ev) => ev.stopPropagation()}
                      >
                        {e.token.symbol ?? shortAddr(e.token.mintAddress)}
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>{formatAmount(e.tokenAmount)}</td>
                  <td>
                    {e.quoteAmount !== null ? (
                      `${formatAmount(e.quoteAmount)} ${
                        e.quoteMint === 'SOL' ? 'SOL' : (e.quoteMint ?? '')
                      }`
                    ) : quoteUnknown ? (
                      <span className="status-warn">unknown</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className={e.walletSolChange !== null && e.walletSolChange < 0 ? 'status-bad' : 'status-good'}>
                    {e.walletSolChange !== null ? formatAmount(e.walletSolChange) : '—'}
                  </td>
                  <td className="status-muted">
                    {e.source && e.venue && e.source !== e.venue
                      ? `${e.source} → ${e.venue}`
                      : (e.venue ?? e.source ?? '—')}
                  </td>
                  <td>
                    <span className={`pill ${confidenceClass(e.confidence)}`}>
                      {e.confidence ?? 'v1'}
                    </span>
                    {warn && (
                      <span
                        className="status-warn"
                        title={
                          e.decoderVersion < 2
                            ? 'Decoded by the legacy decoder — re-sync this wallet for exact amounts'
                            : `Unattributed SOL difference: ${formatSol(e.unattributedSol)}`
                        }
                      >
                        {' '}
                        ⚠
                      </span>
                    )}
                  </td>
                  <td className="mono">
                    <a
                      href={`https://solscan.io/tx/${e.signature}`}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(ev) => ev.stopPropagation()}
                    >
                      {e.signature.slice(0, 8)}…
                    </a>
                  </td>
                </tr>,
                expanded ? (
                  <tr key={`${e.id}-detail`}>
                    <td colSpan={10} style={{ background: 'var(--panel-2)' }}>
                      <div style={{ padding: '10px 6px', fontSize: 13, lineHeight: 1.7 }}>
                        {e.decoderVersion < 2 && (
                          <div className="status-warn" style={{ marginBottom: 6 }}>
                            ⚠ Legacy event (decoder v1): amounts may include fees. Re-sync this
                            wallet to re-decode with exact swap legs.
                          </div>
                        )}
                        {e.explanation && <div style={{ marginBottom: 8 }}>{e.explanation}</div>}
                        <div className="import-summary" style={{ marginTop: 0 }}>
                          <span>
                            swap in <strong>{e.swapInAmount !== null ? `${formatAmount(e.swapInAmount)} ${e.swapInMint === 'SOL' ? 'SOL' : (e.swapInMint ? shortAddr(e.swapInMint) : '')}` : 'unknown'}</strong>
                          </span>
                          <span>
                            swap out <strong>{e.swapOutAmount !== null ? `${formatAmount(e.swapOutAmount)} ${e.swapOutMint === 'SOL' ? 'SOL' : (e.swapOutMint ? shortAddr(e.swapOutMint) : '')}` : 'unknown'}</strong>
                          </span>
                          <span>
                            wallet Δ <strong>{formatSol(e.walletSolChange)}</strong>
                          </span>
                          <span>
                            network fee <strong>{formatSol(e.networkFeeSol)}</strong>
                          </span>
                          <span>
                            priority fee <strong>{formatSol(e.priorityFeeSol)}</strong>
                          </span>
                          <span>
                            platform fee <strong>{formatSol(e.platformFeeSol)}</strong>
                          </span>
                          <span>
                            tip <strong>{formatSol(e.tipSol)}</strong>
                          </span>
                          <span>
                            rent <strong>{formatSol(e.rentSol)}</strong>
                          </span>
                          <span>
                            unrelated in/out{' '}
                            <strong>
                              {formatSol(e.unrelatedSolIn)} / {formatSol(e.unrelatedSolOut)}
                            </strong>
                          </span>
                          <span className={hasUnattributed(e.unattributedSol) ? 'status-warn' : ''}>
                            unattributed <strong>{formatSol(e.unattributedSol)}</strong>
                          </span>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : null,
              ];
            })}
            {events && events.items.length === 0 && (
              <tr>
                <td colSpan={10} className="status-muted">
                  No events recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {events && events.total > events.pageSize && (
          <div className="pagination">
            <button
              className="btn secondary"
              disabled={eventPage <= 1}
              onClick={() => setEventPage((p) => p - 1)}
            >
              ← Prev
            </button>
            <span>
              Page {eventPage} of {Math.max(1, Math.ceil(events.total / events.pageSize))}
            </span>
            <button
              className="btn secondary"
              disabled={eventPage >= Math.ceil(events.total / events.pageSize)}
              onClick={() => setEventPage((p) => p + 1)}
            >
              Next →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
