import { useCallback, useEffect, useState } from 'react';
import { api, type TokenListResponse } from '../api';

export function TokensPage() {
  const [data, setData] = useState<TokenListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api<TokenListResponse>('/api/tokens'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function seed() {
    setSeeding(true);
    try {
      await api('/api/dev/seed', { method: 'POST' });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSeeding(false);
    }
  }

  return (
    <div>
      <div className="notice">
        Live token discovery is <strong>not implemented yet</strong> (planned for a later phase).
        The records below are development seed data, clearly marked with source{' '}
        <code>dev-seed</code>.
      </div>

      {error && <div className="error-box">API error: {error}</div>}

      <div className="panel">
        <h2>Tokens ({data?.total ?? 0})</h2>
        <div className="toolbar">
          <button className="btn secondary" onClick={() => void seed()} disabled={seeding}>
            {seeding ? 'Seeding…' : 'Seed development data'}
          </button>
        </div>
        <table>
          <thead>
            <tr>
              <th>Token</th>
              <th>Symbol</th>
              <th>Mint</th>
              <th>Stage</th>
              <th>Source</th>
              <th>Discovered</th>
              <th>Last seen</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((t) => (
              <tr key={t.id}>
                <td>{t.name ?? <span className="status-muted">(unnamed)</span>}</td>
                <td>{t.symbol ?? '—'}</td>
                <td className="mono">
                  {t.mintAddress.slice(0, 4)}…{t.mintAddress.slice(-4)}
                </td>
                <td>
                  <span className={`pill stage-${t.stage}`}>{t.stage}</span>
                </td>
                <td>
                  <span className="pill">{t.source}</span>
                </td>
                <td className="status-muted">{new Date(t.discoveredAt).toLocaleString()}</td>
                <td className="status-muted">{new Date(t.lastSeenAt).toLocaleString()}</td>
              </tr>
            ))}
            {data && data.items.length === 0 && (
              <tr>
                <td colSpan={7} className="status-muted">
                  No tokens yet. Use “Seed development data” to populate sample records.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
