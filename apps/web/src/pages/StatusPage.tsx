import { useCallback, useEffect, useState } from 'react';
import { api, type HealthResponse, type RpcStatus } from '../api';

export function StatusPage() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [rpc, setRpc] = useState<RpcStatus | null>(null);
  const [apiDown, setApiDown] = useState(false);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [h, r] = await Promise.all([
        api<HealthResponse>('/api/health'),
        api<RpcStatus>('/api/rpc/status'),
      ]);
      setHealth(h);
      setRpc(r);
      setApiDown(false);
    } catch {
      setApiDown(true);
      setHealth(null);
      setRpc(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div>
      <div className="toolbar">
        <button className="btn" onClick={() => void refresh()} disabled={loading}>
          {loading ? 'Checking…' : 'Refresh'}
        </button>
        {rpc && !rpc.configured && (
          <span className="status-warn">
            No Helius API key configured — set HELIUS_API_KEY in .env (backend only).
          </span>
        )}
      </div>

      <div className="cards">
        <div className="card">
          <div className="card-label">API</div>
          <div className={`card-value ${apiDown ? 'status-bad' : 'status-good'}`}>
            {apiDown ? 'Unreachable' : health ? 'Online' : '—'}
          </div>
        </div>
        <div className="card">
          <div className="card-label">Database</div>
          <div
            className={`card-value ${
              health?.db === 'ok' ? 'status-good' : health ? 'status-bad' : 'status-muted'
            }`}
          >
            {health ? (health.db === 'ok' ? 'Connected' : 'Error') : '—'}
          </div>
        </div>
        <div className="card">
          <div className="card-label">RPC configured</div>
          <div className={`card-value ${rpc?.configured ? 'status-good' : 'status-warn'}`}>
            {rpc ? (rpc.configured ? 'Yes' : 'No') : '—'}
          </div>
        </div>
        <div className="card">
          <div className="card-label">RPC health</div>
          <div
            className={`card-value ${
              rpc?.healthy === true
                ? 'status-good'
                : rpc?.healthy === false
                  ? 'status-bad'
                  : 'status-muted'
            }`}
          >
            {rpc ? (rpc.healthy === null ? 'N/A' : rpc.healthy ? 'Healthy' : 'Unhealthy') : '—'}
          </div>
        </div>
        <div className="card">
          <div className="card-label">Current slot</div>
          <div className="card-value">{rpc?.slot != null ? rpc.slot.toLocaleString() : '—'}</div>
        </div>
        <div className="card">
          <div className="card-label">RPC latency</div>
          <div className="card-value">{rpc?.latencyMs != null ? `${rpc.latencyMs} ms` : '—'}</div>
        </div>
        <div className="card">
          <div className="card-label">Cluster</div>
          <div className="card-value">{rpc?.cluster ?? '—'}</div>
        </div>
        <div className="card">
          <div className="card-label">API uptime</div>
          <div className="card-value">{health ? `${health.uptimeSec}s` : '—'}</div>
        </div>
      </div>

      <p className="hint" style={{ marginTop: 14 }}>
        The Helius API key stays on the backend. The dashboard only ever sees sanitized status
        fields — never the RPC URL.
      </p>
    </div>
  );
}
