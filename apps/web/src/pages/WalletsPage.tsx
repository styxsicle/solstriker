import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type ImportSummary, type WalletListResponse } from '../api';

const PAGE_SIZE = 50;

export function WalletsPage() {
  const [data, setData] = useState<WalletListResponse | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState('');
  const [error, setError] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const [importResult, setImportResult] = useState<ImportSummary | null>(null);
  const [importBusy, setImportBusy] = useState(false);

  const [manual, setManual] = useState({ address: '', label: '', group: '', notes: '' });
  const [manualMsg, setManualMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (search.trim()) params.set('search', search.trim());
      if (group) params.set('group', group);
      setData(await api<WalletListResponse>(`/api/wallets?${params.toString()}`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [page, search, group]);

  useEffect(() => {
    void load();
  }, [load]);

  async function importFile() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setImportBusy(true);
    setError(null);
    try {
      const content = await file.text();
      const result = await api<ImportSummary>('/api/wallets/import', {
        method: 'POST',
        body: JSON.stringify({ content, filename: file.name }),
      });
      setImportResult(result);
      if (fileRef.current) fileRef.current.value = '';
      setPage(1);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setImportBusy(false);
    }
  }

  async function addManual(e: React.FormEvent) {
    e.preventDefault();
    setManualMsg(null);
    try {
      await api('/api/wallets', {
        method: 'POST',
        body: JSON.stringify({
          address: manual.address.trim(),
          label: manual.label.trim() || undefined,
          group: manual.group.trim() || undefined,
          notes: manual.notes.trim() || undefined,
        }),
      });
      setManual({ address: '', label: '', group: '', notes: '' });
      setManualMsg('Wallet added.');
      await load();
    } catch (err) {
      const msg = (err as Error).message;
      setManualMsg(
        msg === 'invalid_address'
          ? 'Invalid Solana address.'
          : msg === 'duplicate_address'
            ? 'That address is already tracked.'
            : `Failed: ${msg}`,
      );
    }
  }

  async function toggleEnabled(id: string, enabled: boolean) {
    try {
      await api(`/api/wallets/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled }) });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div>
      <div className="cards" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
        <div className="card">
          <div className="card-label">Total tracked wallets</div>
          <div className="card-value">{data ? data.stats.total.toLocaleString() : '—'}</div>
        </div>
        <div className="card">
          <div className="card-label">Enabled wallets</div>
          <div className="card-value status-good">
            {data ? data.stats.enabled.toLocaleString() : '—'}
          </div>
        </div>
      </div>

      {error && <div className="error-box">API error: {error}</div>}

      <div className="panel">
        <h2>Import wallets</h2>
        <p className="hint">
          Supports CSV (<code>address,label,group,notes</code>), plain text (one address per
          line), and JSON wallet-tracker exports (<code>trackedWalletAddress</code> /{' '}
          <code>name</code> / <code>groups</code> / alert settings — even when saved as{' '}
          <code>.txt</code>). Import files stay local and are never committed to the repository.
          Never paste private keys or seed phrases here — only public addresses.
        </p>
        <div className="toolbar">
          <input ref={fileRef} type="file" accept=".csv,.txt,.json,text/plain,application/json" />
          <button className="btn" onClick={() => void importFile()} disabled={importBusy}>
            {importBusy ? 'Importing…' : 'Import file'}
          </button>
        </div>
        {importResult && (
          <div className="import-summary">
            <span className="status-good">
              <strong>{importResult.imported}</strong> imported
            </span>
            <span className="status-warn">
              <strong>{importResult.duplicates}</strong> duplicates
            </span>
            <span className="status-bad">
              <strong>{importResult.invalid}</strong> invalid
            </span>
            <span className="status-muted">
              <strong>{importResult.skipped}</strong> skipped
            </span>
            <span className="status-muted">format: {importResult.format}</span>
          </div>
        )}
        {importResult && importResult.invalidSamples.length > 0 && (
          <p className="hint">
            First invalid rows:{' '}
            {importResult.invalidSamples
              .slice(0, 5)
              .map((s) => `line ${s.line} (${s.reason})`)
              .join(', ')}
          </p>
        )}
      </div>

      <div className="panel">
        <h2>Add wallet manually</h2>
        <form onSubmit={(e) => void addManual(e)}>
          <div className="form-grid">
            <input
              type="text"
              placeholder="Solana address (required)"
              value={manual.address}
              onChange={(e) => setManual({ ...manual, address: e.target.value })}
              required
            />
            <input
              type="text"
              placeholder="Label"
              value={manual.label}
              onChange={(e) => setManual({ ...manual, label: e.target.value })}
            />
            <input
              type="text"
              placeholder="Group"
              value={manual.group}
              onChange={(e) => setManual({ ...manual, group: e.target.value })}
            />
            <input
              type="text"
              placeholder="Notes"
              value={manual.notes}
              onChange={(e) => setManual({ ...manual, notes: e.target.value })}
            />
          </div>
          <button className="btn" type="submit">
            Add wallet
          </button>
          {manualMsg && <span style={{ marginLeft: 10, fontSize: 13 }}>{manualMsg}</span>}
        </form>
      </div>

      <div className="panel">
        <h2>Tracked wallets</h2>
        <div className="toolbar">
          <input
            type="text"
            placeholder="Search address, label, notes…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            style={{ minWidth: 260 }}
          />
          <select
            value={group}
            onChange={(e) => {
              setGroup(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All groups</option>
            {data?.groups.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>

        <table>
          <thead>
            <tr>
              <th>Wallet</th>
              <th>Address</th>
              <th>Groups</th>
              <th>Source</th>
              <th>Added</th>
              <th>Enabled</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((w) => (
              <tr key={w.id}>
                <td>
                  {w.emoji ? `${w.emoji} ` : ''}
                  {w.label ?? <span className="status-muted">(unlabeled)</span>}
                </td>
                <td className="mono">
                  {w.address.slice(0, 4)}…{w.address.slice(-4)}
                </td>
                <td>
                  {w.groups.map((g) => (
                    <span key={g} className="pill">
                      {g}
                    </span>
                  ))}
                </td>
                <td>
                  <span className="pill">{w.source}</span>
                </td>
                <td className="status-muted">{new Date(w.createdAt).toLocaleDateString()}</td>
                <td>
                  <button
                    className={`toggle ${w.enabled ? 'on' : ''}`}
                    onClick={() => void toggleEnabled(w.id, !w.enabled)}
                  >
                    {w.enabled ? 'Enabled' : 'Disabled'}
                  </button>
                </td>
              </tr>
            ))}
            {data && data.items.length === 0 && (
              <tr>
                <td colSpan={6} className="status-muted">
                  No wallets match. Import a file or add one manually above.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="pagination">
          <button
            className="btn secondary"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            ← Prev
          </button>
          <span>
            Page {page} of {totalPages} ({data?.total ?? 0} matching)
          </span>
          <button
            className="btn secondary"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next →
          </button>
        </div>
      </div>
    </div>
  );
}
