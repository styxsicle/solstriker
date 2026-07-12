import { useCallback, useEffect, useState } from 'react';
import {
  api,
  type ActivityEventsResponse,
  type ActivitySummary,
  type SyncResponse,
  type SyncResult,
  type SyncStatusItem,
  type SyncStatusResponse,
  type Wallet,
  type WalletListResponse,
} from '../api';
import { useMode } from '../lib/mode';
import { formatTime, shortAddr } from '../lib/format';
import { walletDisplayName } from '../lib/wording';
import { PageHeader } from '../components/PageHeader';
import { EventList } from '../components/EventList';
import { ConfirmResyncModal } from '../components/ConfirmResyncModal';

const EVENT_TYPES = ['BUY', 'SELL', 'TOKEN_TRANSFER_IN', 'TOKEN_TRANSFER_OUT'] as const;
const MAX_SELECTED = 10;
const TX_CAP_CHOICES = [100, 200, 500];

function SummaryCard({ label, value, tone }: { label: string; value: number | undefined; tone?: string }) {
  return (
    <div className="card">
      <div className="card-label">{label}</div>
      <div className={`card-value ${tone ?? ''}`}>
        {value === undefined ? <span className="skeleton" /> : value.toLocaleString()}
      </div>
    </div>
  );
}

export function ActivityPage() {
  const { mode } = useMode();
  const [error, setError] = useState<string | null>(null);

  // Wallet picker
  const [walletSearch, setWalletSearch] = useState('');
  const [candidates, setCandidates] = useState<Wallet[]>([]);
  const [selected, setSelected] = useState<Wallet[]>([]);
  const [txCap, setTxCap] = useState(100);

  // Sync + status + summary
  const [syncing, setSyncing] = useState(false);
  const [syncResults, setSyncResults] = useState<SyncResult[] | null>(null);
  const [status, setStatus] = useState<SyncStatusResponse | null>(null);
  const [summary, setSummary] = useState<ActivitySummary | null>(null);
  const [resyncTarget, setResyncTarget] = useState<SyncStatusItem | null>(null);
  const [resyncBusy, setResyncBusy] = useState(false);

  // Events
  const [events, setEvents] = useState<ActivityEventsResponse | null>(null);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventPage, setEventPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState('');
  const [walletFilter, setWalletFilter] = useState('');

  const loadCandidates = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        enabled: 'true',
        includeDev: 'false',
        page: '1',
        pageSize: '25',
      });
      if (walletSearch.trim()) params.set('search', walletSearch.trim());
      setCandidates((await api<WalletListResponse>(`/api/wallets?${params.toString()}`)).items);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [walletSearch]);

  const loadStatus = useCallback(async () => {
    try {
      const [s, sum] = await Promise.all([
        api<SyncStatusResponse>('/api/activity/status'),
        api<ActivitySummary>('/api/activity/summary'),
      ]);
      setStatus(s);
      setSummary(sum);
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
      if (current.some((w) => w.id === wallet.id)) return current.filter((w) => w.id !== wallet.id);
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
        body: JSON.stringify({ walletIds: selected.map((w) => w.id), maxTransactions: txCap }),
      });
      setSyncResults(res.results);
      await Promise.all([loadStatus(), loadEvents()]);
    } catch (e) {
      const message = (e as Error).message;
      setError(
        message === 'provider_not_configured'
          ? 'No Helius API key is configured, so activity cannot be fetched. Add HELIUS_API_KEY to .env (backend only) and restart.'
          : message,
      );
    } finally {
      setSyncing(false);
    }
  }

  async function confirmResync() {
    if (!resyncTarget) return;
    setResyncBusy(true);
    setError(null);
    try {
      await api<SyncResponse>('/api/activity/resync', {
        method: 'POST',
        body: JSON.stringify({ walletIds: [resyncTarget.walletId], maxTransactions: txCap }),
      });
      setResyncTarget(null);
      await Promise.all([loadStatus(), loadEvents()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setResyncBusy(false);
    }
  }

  const providerConfigured = status?.providerConfigured ?? true;

  return (
    <div>
      <PageHeader
        title="Wallet activity"
        subtitle={
          mode === 'simple'
            ? 'Download and read the historical trades of the wallets you track. Nothing here is live — you choose when to fetch.'
            : 'Historical sync + decoded event stream. Max 10 wallets per request, 500 tx per wallet per run.'
        }
      />

      {error && (
        <p className="notice danger" role="alert">
          {error}
        </p>
      )}
      {!providerConfigured && (
        <p className="notice warn" role="note">
          Activity sync is unavailable: no Helius API key is configured. Existing stored activity
          is still shown below.
        </p>
      )}

      <section className="panel" aria-labelledby="activity-summary">
        <h2 id="activity-summary">Stored activity so far</h2>
        <div className="cards" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
          <SummaryCard label="Transactions checked" value={summary?.transactionsChecked} />
          <SummaryCard label="Events found" value={summary?.eventsStored} />
          <SummaryCard label="Buys" value={summary?.buys} tone="status-good" />
          <SummaryCard label="Sells" value={summary?.sells} tone="status-bad" />
          <SummaryCard
            label="Transfers"
            value={summary ? summary.transfersIn + summary.transfersOut : undefined}
          />
          <SummaryCard label="Unknown events" value={summary?.unknownConfidence} />
          <SummaryCard label="Confirmed" value={summary?.confirmed} tone="status-good" />
          <SummaryCard label="Likely" value={summary?.likely} tone="status-warn" />
          <SummaryCard
            label="Need re-sync (old decoder)"
            value={summary?.legacyEvents}
            tone={summary && summary.legacyEvents > 0 ? 'status-warn' : ''}
          />
        </div>
      </section>

      <section className="panel" aria-labelledby="activity-sync">
        <h2 id="activity-sync">Fetch wallet history</h2>
        <p className="panel-sub">
          <strong>Sync</strong> fetches newer activity or continues downloading older history.{' '}
          <strong>Re-sync</strong> deletes and re-downloads only one wallet's stored activity so it
          can be decoded again using the latest decoder. Recommendation: start with 1–5 wallets and
          100 transactions.
        </p>

        <div className="toolbar">
          <label className="field">
            Search enabled wallets
            <input
              type="text"
              value={walletSearch}
              onChange={(e) => setWalletSearch(e.target.value)}
              style={{ minWidth: 240 }}
            />
          </label>
          <span className="badge accent" style={{ alignSelf: 'flex-end' }}>
            {selected.length}/{MAX_SELECTED} selected
          </span>
        </div>

        {selected.length > 0 && (
          <div className="toolbar">
            {selected.map((w) => (
              <button
                key={w.id}
                className="badge good"
                style={{ cursor: 'pointer' }}
                title="Remove from selection"
                onClick={() => toggleSelect(w)}
              >
                {walletDisplayName(w)} ✕
              </button>
            ))}
          </div>
        )}

        <div className="table-wrap" style={{ maxHeight: 320 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col" style={{ width: 40 }}>
                  <span className="visually-hidden">Select</span>
                </th>
                <th scope="col">Wallet</th>
                <th scope="col">Address</th>
                <th scope="col">Groups</th>
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
                        aria-label={`Select ${w.label ?? shortAddr(w.address)}`}
                      />
                    </td>
                    <td>{walletDisplayName(w)}</td>
                    <td className="mono">{shortAddr(w.address)}</td>
                    <td>
                      {w.groups.map((g) => (
                        <span key={g} className="badge muted">
                          {g}
                        </span>
                      ))}
                    </td>
                  </tr>
                );
              })}
              {candidates.length === 0 && (
                <tr>
                  <td colSpan={4}>
                    <div className="empty-state">
                      No enabled wallets match. Import wallets on the Wallets page first.
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="toolbar" style={{ marginTop: 12 }}>
          <label className="field">
            Max transactions per wallet
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
            style={{ alignSelf: 'flex-end' }}
            disabled={selected.length === 0 || syncing || !providerConfigured}
            onClick={() => void runSync()}
          >
            {syncing
              ? 'Syncing… (this can take a while)'
              : `Sync ${selected.length || ''} wallet${selected.length === 1 ? '' : 's'}`}
          </button>
        </div>

        {syncResults && (
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Wallet</th>
                  <th scope="col">Result</th>
                  <th scope="col" className="num">Transactions</th>
                  <th scope="col" className="num">New events</th>
                  <th scope="col" className="num">Duplicates</th>
                  <th scope="col" className="num">New tokens</th>
                  <th scope="col">History</th>
                </tr>
              </thead>
              <tbody>
                {syncResults.map((r) => (
                  <tr key={r.walletId}>
                    <td className="mono">{shortAddr(r.address)}</td>
                    <td>
                      <span
                        className={`badge ${
                          r.status === 'ok' ? 'good' : r.status === 'locked' ? 'warn' : 'bad'
                        }`}
                      >
                        {r.status}
                        {r.error ? ` (${r.error})` : ''}
                      </span>
                    </td>
                    <td className="num">{r.transactionsProcessed}</td>
                    <td className="num">{r.eventsCreated}</td>
                    <td className="num">{r.duplicateEvents}</td>
                    <td className="num">{r.tokensDiscovered}</td>
                    <td>
                      {r.backfillComplete === null
                        ? '—'
                        : r.backfillComplete
                          ? 'complete'
                          : 'partial — sync again to continue'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel" aria-labelledby="activity-status">
        <h2 id="activity-status">Synced wallets</h2>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Wallet</th>
                <th scope="col">Address</th>
                <th scope="col">Status</th>
                <th scope="col">History</th>
                <th scope="col" className="num">Transactions</th>
                <th scope="col" className="num">Events</th>
                <th scope="col">Last sync</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {status?.items.map((s) => (
                <tr key={s.walletId}>
                  <td>{walletDisplayName(s)}</td>
                  <td className="mono">{shortAddr(s.address)}</td>
                  <td>
                    <span
                      className={`badge ${
                        s.status === 'error' ? 'bad' : s.status === 'syncing' ? 'warn' : 'good'
                      }`}
                    >
                      {s.status}
                      {s.lastError ? ` (${s.lastError})` : ''}
                    </span>
                  </td>
                  <td>{s.backfillComplete ? 'complete' : 'partial'}</td>
                  <td className="num">{s.totalTransactions.toLocaleString()}</td>
                  <td className="num">{s.totalEvents.toLocaleString()}</td>
                  <td className="status-muted">
                    {s.lastSyncAt ? formatTime(s.lastSyncAt) : '—'}
                  </td>
                  <td>
                    <button
                      className="btn secondary small"
                      disabled={resyncBusy || !providerConfigured}
                      onClick={() => setResyncTarget(s)}
                    >
                      Re-sync
                    </button>
                  </td>
                </tr>
              ))}
              {status && status.items.length === 0 && (
                <tr>
                  <td colSpan={8}>
                    <div className="empty-state">
                      Nothing synced yet. Select wallets above and fetch their history.
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel" aria-labelledby="activity-events">
        <h2 id="activity-events">
          Activity {events ? `(${events.total.toLocaleString()} events)` : ''}
        </h2>
        <div className="toolbar">
          <label className="field">
            Wallet
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
          </label>
          <label className="field">
            Event type
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
          </label>
          {eventsLoading && <span className="status-muted" style={{ alignSelf: 'flex-end' }}>Loading…</span>}
        </div>

        {events === null ? (
          <div className="empty-state">
            <span className="skeleton" style={{ width: '60%' }} />
          </div>
        ) : (
          <EventList events={events.items} mode={mode} />
        )}

        {events && events.total > events.pageSize && (
          <div className="pagination">
            <button
              className="btn secondary small"
              disabled={eventPage <= 1}
              onClick={() => setEventPage((p) => p - 1)}
            >
              ← Prev
            </button>
            <span>
              Page {eventPage} of {Math.max(1, Math.ceil(events.total / events.pageSize))}
            </span>
            <button
              className="btn secondary small"
              disabled={eventPage >= Math.ceil(events.total / events.pageSize)}
              onClick={() => setEventPage((p) => p + 1)}
            >
              Next →
            </button>
          </div>
        )}
      </section>

      {resyncTarget && (
        <ConfirmResyncModal
          walletName={resyncTarget.label ?? shortAddr(resyncTarget.address)}
          busy={resyncBusy}
          onConfirm={() => void confirmResync()}
          onCancel={() => setResyncTarget(null)}
        />
      )}
    </div>
  );
}
