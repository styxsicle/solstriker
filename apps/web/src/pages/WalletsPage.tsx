import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type ImportSummary, type Wallet, type WalletListResponse } from '../api';
import { useMode } from '../lib/mode';
import { shortAddr } from '../lib/format';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import { WalletLabel } from '../components/WalletLabel';

const PAGE_SIZE = 50;
/** Files above this are confirmed before import (limits themselves unchanged). */
const LARGE_FILE_BYTES = 1_000_000;

export function WalletsPage() {
  const { mode } = useMode();
  const [data, setData] = useState<WalletListResponse | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState('');
  const [showDev, setShowDev] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const [importResult, setImportResult] = useState<ImportSummary | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [largeFile, setLargeFile] = useState<File | null>(null);

  const [manual, setManual] = useState({ address: '', label: '', group: '', notes: '' });
  const [manualMsg, setManualMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (search.trim()) params.set('search', search.trim());
      if (group) params.set('group', group);
      if (!showDev) params.set('includeDev', 'false');
      setData(await api<WalletListResponse>(`/api/wallets?${params.toString()}`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [page, search, group, showDev]);

  useEffect(() => {
    void load();
  }, [load]);

  async function importContent(file: File) {
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

  function startImport() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    if (file.size > LARGE_FILE_BYTES) {
      setLargeFile(file);
      return;
    }
    void importContent(file);
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
          ? 'That is not a valid Solana address. Addresses are 32–44 characters of letters and numbers.'
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

  const importSection = (
    <section className="panel" aria-labelledby="wallets-import">
      <h2 id="wallets-import">Import wallets</h2>
      <p className="panel-sub">
        1. Choose a file &nbsp;→&nbsp; 2. Review the supported formats &nbsp;→&nbsp; 3. Import
        public addresses &nbsp;→&nbsp; 4. See what was imported and what was skipped.
      </p>
      <details className="helper">
        <summary>Supported file formats</summary>
        <ul>
          <li>
            <strong>CSV</strong> — columns <code>address,label,group,notes</code> (only{' '}
            <code>address</code> is required; header optional).
          </li>
          <li>
            <strong>Plain text</strong> — one address per line; blank lines and <code>#</code>{' '}
            comments are skipped.
          </li>
          <li>
            <strong>Wallet-tracker JSON export</strong> — records with{' '}
            <code>trackedWalletAddress</code>, <code>name</code>, <code>emoji</code>,{' '}
            <code>groups</code>, and alert settings, even when saved as <code>.txt</code>. Names,
            emojis, and groups are preserved.
          </li>
        </ul>
        <p className="status-muted">
          Import files stay on this computer and are never committed to the project. Only public
          addresses belong here — never private keys or seed phrases.
        </p>
      </details>
      <div className="toolbar">
        <label className="field">
          Wallet file
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.txt,.json,text/plain,application/json"
            aria-label="Choose a wallet file to import"
          />
        </label>
        <button className="btn" onClick={startImport} disabled={importBusy}>
          {importBusy ? 'Importing…' : 'Import file'}
        </button>
      </div>
      {importResult && (
        <div className="import-summary" role="status">
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
        <p className="panel-sub" style={{ marginTop: 8 }}>
          First invalid rows:{' '}
          {importResult.invalidSamples
            .slice(0, 5)
            .map((s) => `line ${s.line} (${s.reason})`)
            .join(', ')}
        </p>
      )}
    </section>
  );

  const addOneWalletSection = (
    <section className="panel" aria-labelledby="wallets-add">
      <h2 id="wallets-add">Add one wallet</h2>
      <form onSubmit={(e) => void addManual(e)}>
        <div className="form-grid">
          <label className="field">
            Solana address (required)
            <input
              type="text"
              value={manual.address}
              onChange={(e) => setManual({ ...manual, address: e.target.value })}
              required
            />
          </label>
          <label className="field">
            Label
            <input
              type="text"
              value={manual.label}
              onChange={(e) => setManual({ ...manual, label: e.target.value })}
            />
          </label>
          <label className="field">
            Group
            <input
              type="text"
              value={manual.group}
              onChange={(e) => setManual({ ...manual, group: e.target.value })}
            />
          </label>
          <label className="field">
            Notes
            <input
              type="text"
              value={manual.notes}
              onChange={(e) => setManual({ ...manual, notes: e.target.value })}
            />
          </label>
        </div>
        <button className="btn" type="submit">
          Add wallet
        </button>
        {manualMsg && (
          <span role="status" style={{ marginLeft: 10, fontSize: 13 }}>
            {manualMsg}
          </span>
        )}
      </form>
    </section>
  );

  const rawTableSection = (
    <section className="panel" aria-labelledby="wallets-table">
      <h2 id="wallets-table">Wallet list</h2>
      {mode === 'simple' && (
        <p className="panel-sub">
          <strong>Enabled</strong>: included in future research and available for
          synchronization. <strong>Disabled</strong>: saved but excluded from selected
          operations. <strong>DEV</strong>: a synthetic development record, not a real wallet.
        </p>
      )}
      <div className="toolbar">
        <label className="field">
          Search
          <input
            type="text"
            placeholder="Address, label, notes…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            style={{ minWidth: 240 }}
          />
        </label>
        <label className="field">
          Group
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
        </label>
        <label className="check" style={{ alignSelf: 'flex-end' }}>
          <input
            type="checkbox"
            checked={showDev}
            onChange={(e) => {
              setShowDev(e.target.checked);
              setPage(1);
            }}
          />
          Show development records
        </label>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Wallet</th>
              <th scope="col">Address</th>
              <th scope="col">Groups</th>
              <th scope="col">Source</th>
              <th scope="col">Added</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((w) => (
              <tr key={w.id}>
                <td>
                  {w.emoji ? `${w.emoji} ` : ''}
                  {w.label ?? <span className="status-muted">(unlabeled)</span>}{' '}
                  {w.source === 'dev-seed' && <span className="badge warn">DEV</span>}
                </td>
                <td className="mono">{shortAddr(w.address)}</td>
                <td>
                  {w.groups.map((g) => (
                    <span key={g} className="badge muted">
                      {g}
                    </span>
                  ))}
                </td>
                <td>
                  <span className="badge muted">{w.source}</span>
                </td>
                <td className="status-muted">{new Date(w.createdAt).toLocaleDateString()}</td>
                <td>
                  <button
                    className={`badge ${w.enabled ? 'good' : 'muted'}`}
                    style={{ cursor: 'pointer' }}
                    onClick={() => void toggleEnabled(w.id, !w.enabled)}
                    aria-label={`${w.enabled ? 'Disable' : 'Enable'} wallet ${w.label ?? shortAddr(w.address)}`}
                  >
                    {w.enabled ? 'Enabled' : 'Disabled'}
                  </button>
                </td>
              </tr>
            ))}
            {data && data.items.length === 0 && (
              <tr>
                <td colSpan={6}>
                  <div className="empty-state">
                    No wallets match. Import a file or add one manually above.
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="pagination">
        <button className="btn secondary small" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          ← Prev
        </button>
        <span>
          Page {page} of {totalPages} ({data?.total ?? 0} matching)
        </span>
        <button
          className="btn secondary small"
          disabled={page >= totalPages}
          onClick={() => setPage((p) => p + 1)}
        >
          Next →
        </button>
      </div>
    </section>
  );

  return (
    <div>
      <PageHeader
        title={mode === 'simple' ? 'Wallets' : 'Tracked wallets'}
        subtitle={
          mode === 'simple'
            ? 'Search the public wallets saved in the research database. The application never needs a private key or seed phrase.'
            : 'Public addresses under research. Import, label, group, and enable/disable them.'
        }
      />

      {error && (
        <p className="notice danger" role="alert">
          {error}
        </p>
      )}

      {mode === 'quant' && (
        <div className="cards" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}>
          <div className="card">
            <div className="card-label">Total tracked wallets</div>
            <div className="card-value">
              {data ? data.stats.total.toLocaleString() : <span className="skeleton" />}
            </div>
          </div>
          <div className="card">
            <div className="card-label">Enabled wallets</div>
            <div className="card-value status-good">
              {data ? data.stats.enabled.toLocaleString() : <span className="skeleton" />}
            </div>
          </div>
        </div>
      )}

      {mode === 'simple' ? (
        <>
          <section className="panel" aria-labelledby="wallets-search">
            <h2 id="wallets-search">Search wallets</h2>
            <label className="field">
              Search
              <input
                type="text"
                placeholder="Label or public address"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            </label>
            <SimpleWalletList
              items={(data?.items ?? []).filter((w) => w.source !== 'dev-seed')}
              onToggle={(id, enabled) => void toggleEnabled(id, enabled)}
            />
            {data && data.total > data.pageSize && (
              <div className="pagination">
                <button className="btn secondary small" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  ← Prev
                </button>
                <span>
                  Page {page} of {totalPages} ({data.total} matching)
                </span>
                <button
                  className="btn secondary small"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next →
                </button>
              </div>
            )}
          </section>

          {addOneWalletSection}

          <details className="helper advanced-disclosure">
            <summary>Advanced wallet management</summary>
            {importSection}
            {rawTableSection}
          </details>
        </>
      ) : (
        <>
          {importSection}
          {addOneWalletSection}
          {rawTableSection}
        </>
      )}

      {largeFile && (
        <Modal
          title="Import a large file?"
          onClose={() => setLargeFile(null)}
          footer={
            <>
              <button className="btn secondary" onClick={() => setLargeFile(null)}>
                Cancel
              </button>
              <button
                className="btn"
                onClick={() => {
                  const file = largeFile;
                  setLargeFile(null);
                  void importContent(file);
                }}
              >
                Import anyway
              </button>
            </>
          }
        >
          <p>
            <strong>{largeFile.name}</strong> is {(largeFile.size / 1024).toFixed(0)} KB — larger
            than usual for a wallet list. Importing may take a moment, and every address will be
            validated before anything is saved. Duplicates are never created.
          </p>
        </Modal>
      )}
    </div>
  );
}

/**
 * Beginner-facing wallet list: label + address always shown together (so
 * wallets sharing the same label stay distinguishable), plain-language
 * availability status, and one obvious next action per wallet.
 */
function SimpleWalletList({
  items,
  onToggle,
}: {
  items: Wallet[];
  onToggle: (id: string, enabled: boolean) => void;
}) {
  if (!items.length) {
    return (
      <div className="empty-state">
        No wallets match. Import a file or add one manually below.
      </div>
    );
  }
  return (
    <ol className="token-cards" aria-label="Tracked wallets">
      {items.map((w) => (
        <li key={w.id} className="token-card">
          <div className="token-card-top">
            <span className="token-name">
              <WalletLabel wallet={w} />
            </span>
          </div>
          <p className={w.enabled ? 'status-good' : 'status-muted'}>
            {w.enabled ? 'Available for research' : 'Not included in research'}
          </p>
          <button
            className="btn secondary small"
            onClick={() => onToggle(w.id, !w.enabled)}
            aria-label={`${w.enabled ? 'Exclude' : 'Include'} wallet ${w.label ?? shortAddr(w.address)}`}
          >
            {w.enabled ? 'Exclude from research' : 'Include in research'}
          </button>
        </li>
      ))}
    </ol>
  );
}
