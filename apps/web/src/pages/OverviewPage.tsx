import { useCallback, useEffect, useState } from 'react';
import {
  api,
  type HealthResponse,
  type OverviewResponse,
  type RpcStatus,
} from '../api';
import { useMode } from '../lib/mode';
import { PageHeader } from '../components/PageHeader';

const DONE_CAPABILITIES = [
  'Import public wallet addresses',
  'Fetch historical wallet activity',
  'Decode many token buys and sells',
  'Separate swap amounts from fees',
  'Store discovered tokens',
  'Collect current token market snapshots',
  'Collect historical price candles',
  'Measure market outcomes after a wallet buy',
];

const NOT_IMPLEMENTED = [
  'Live monitoring',
  'Wallet rankings',
  'Token price analysis',
  'Predictions',
  'Contract safety analysis',
  'Alerts',
  'Trading',
];

function Value({ value }: { value: React.ReactNode }) {
  return value === undefined || value === null ? <span className="skeleton" /> : <>{value}</>;
}

export function OverviewPage() {
  const { mode } = useMode();
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [rpc, setRpc] = useState<RpcStatus | null>(null);
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [apiDown, setApiDown] = useState(false);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [h, r, o] = await Promise.all([
        api<HealthResponse>('/api/health'),
        api<RpcStatus>('/api/rpc/status'),
        api<OverviewResponse>('/api/overview'),
      ]);
      setHealth(h);
      setRpc(r);
      setOverview(o);
      setApiDown(false);
    } catch {
      setApiDown(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const appOk = !apiDown && health?.status === 'ok' && health?.db === 'ok';
  const rpcOk = rpc?.configured === true && rpc?.healthy === true;

  return (
    <div>
      <PageHeader
        title="Overview"
        subtitle="What this research app can currently see and do."
        actions={
          <button className="btn secondary" onClick={() => void refresh()} disabled={loading}>
            {loading ? 'Checking…' : 'Refresh'}
          </button>
        }
      />

      <p className="notice info" role="note">
        <strong>Historical research only.</strong> The app does not currently predict coins,
        monitor wallets live, connect to a trading wallet, or execute trades.
      </p>

      {apiDown && (
        <p className="notice danger" role="alert">
          The backend API is unreachable. Start it with <code>npm run dev</code> from the project
          root, then refresh.
        </p>
      )}

      <section className="panel" aria-labelledby="overview-app">
        <h2 id="overview-app">
          Application{' '}
          <span className={`badge ${appOk ? 'good' : 'bad'}`}>
            {appOk ? '✔ working' : apiDown ? '✖ unreachable' : '… checking'}
          </span>
        </h2>
        {mode === 'simple' ? (
          <p className="panel-sub">
            {appOk
              ? 'The application and its saved data are available.'
              : 'The application or its saved data are not reachable right now.'}
          </p>
        ) : (
          <div className="cards">
            <div className="card">
              <div className="card-label">API state</div>
              <div className={`card-value ${apiDown ? 'status-bad' : 'status-good'}`}>
                <Value value={apiDown ? 'Unreachable' : health ? 'Online' : null} />
              </div>
            </div>
            <div className="card">
              <div className="card-label">Database state</div>
              <div className={`card-value ${health?.db === 'ok' ? 'status-good' : 'status-bad'}`}>
                <Value value={health ? (health.db === 'ok' ? 'Connected' : 'Error') : null} />
              </div>
            </div>
            <div className="card">
              <div className="card-label">Uptime</div>
              <div className="card-value">
                <Value value={health ? `${health.uptimeSec}s` : null} />
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="panel" aria-labelledby="overview-solana">
        <h2 id="overview-solana">
          Solana connection{' '}
          <span className={`badge ${rpcOk ? 'good' : rpc?.configured === false ? 'warn' : 'bad'}`}>
            {rpc === null
              ? '… checking'
              : rpcOk
                ? '✔ connected'
                : rpc.configured
                  ? '✖ unhealthy'
                  : '! not configured'}
          </span>
        </h2>
        {mode === 'simple' ? (
          <p className="panel-sub">
            {rpcOk
              ? 'The app can currently communicate with the Solana blockchain.'
              : rpc?.configured === false
                ? 'No blockchain access key is configured yet, so new activity cannot be fetched. Existing saved data still works.'
                : 'The app could not reach the Solana blockchain just now.'}
          </p>
        ) : (
          <div className="cards">
            <div className="card">
              <div className="card-label">RPC configured</div>
              <div className={`card-value ${rpc?.configured ? 'status-good' : 'status-warn'}`}>
                <Value value={rpc ? (rpc.configured ? 'Yes' : 'No') : null} />
              </div>
            </div>
            <div className="card">
              <div className="card-label">RPC health</div>
              <div
                className={`card-value ${
                  rpc?.healthy === true ? 'status-good' : rpc?.healthy === false ? 'status-bad' : 'status-muted'
                }`}
              >
                <Value
                  value={rpc ? (rpc.healthy === null ? 'N/A' : rpc.healthy ? 'Healthy' : 'Unhealthy') : null}
                />
              </div>
            </div>
            <div className="card">
              <div className="card-label">Cluster</div>
              <div className="card-value">
                <Value value={rpc?.cluster} />
              </div>
            </div>
            <div className="card">
              <div className="card-label">Current slot</div>
              <div className="card-value">
                <Value value={rpc?.slot != null ? rpc.slot.toLocaleString() : rpc ? '—' : null} />
              </div>
            </div>
            <div className="card">
              <div className="card-label">Latency</div>
              <div className="card-value">
                <Value value={rpc?.latencyMs != null ? `${rpc.latencyMs} ms` : rpc ? '—' : null} />
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="panel" aria-labelledby="overview-db">
        <h2 id="overview-db">Research database</h2>
        {mode === 'simple' && (
          <p className="panel-sub">
            Everything below is real saved research data — public wallet addresses you imported and
            the historical activity fetched for them.
          </p>
        )}
        <div className="cards">
          <div className="card">
            <div className="card-label">Tracked wallets</div>
            <div className="card-value">
              <Value value={overview?.wallets.total.toLocaleString()} />
            </div>
          </div>
          <div className="card">
            <div className="card-label">Enabled wallets</div>
            <div className="card-value status-good">
              <Value value={overview?.wallets.enabled.toLocaleString()} />
            </div>
          </div>
          <div className="card">
            <div className="card-label">Wallets with synced activity</div>
            <div className="card-value">
              <Value value={overview?.activity.syncedWallets.toLocaleString()} />
            </div>
          </div>
          <div className="card">
            <div className="card-label">Stored wallet events</div>
            <div className="card-value">
              <Value value={overview?.activity.storedEvents.toLocaleString()} />
            </div>
          </div>
          <div className="card">
            <div className="card-label">Discovered tokens</div>
            <div className="card-value">
              <Value value={overview?.tokens.total.toLocaleString()} />
            </div>
          </div>
        </div>
      </section>

      <section className="panel" aria-labelledby="overview-market">
        <h2 id="overview-market">Token market data</h2>
        {mode === 'simple' && (
          <p className="panel-sub">
            Market snapshots are collected manually, one small batch at a time, on the Tokens page.
            These counts describe how much current market data has been collected — they are not
            predictions.
          </p>
        )}
        <div className="cards" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' }}>
          <div className="card">
            <div className="card-label">Non-development tokens</div>
            <div className="card-value">
              <Value value={overview?.market?.nonDevTokens.toLocaleString()} />
            </div>
          </div>
          <div className="card">
            <div className="card-label">With a market snapshot</div>
            <div className="card-value status-good">
              <Value value={overview?.market?.withSnapshots.toLocaleString()} />
            </div>
          </div>
          <div className="card">
            <div className="card-label">Never collected</div>
            <div className="card-value">
              <Value value={overview?.market?.neverRefreshed.toLocaleString()} />
            </div>
          </div>
          <div className="card">
            <div className="card-label">Fresh data</div>
            <div className="card-value status-good">
              <Value value={overview?.market?.fresh.toLocaleString()} />
            </div>
          </div>
          <div className="card">
            <div className="card-label">Aging data</div>
            <div className="card-value status-warn">
              <Value value={overview?.market?.aging.toLocaleString()} />
            </div>
          </div>
          <div className="card">
            <div className="card-label">Stale data</div>
            <div className="card-value status-bad">
              <Value value={overview?.market?.stale.toLocaleString()} />
            </div>
          </div>
          <div className="card">
            <div className="card-label">Partial latest snapshot</div>
            <div className="card-value">
              <Value value={overview?.market?.partialLatest.toLocaleString()} />
            </div>
          </div>
          <div className="card">
            <div className="card-label">Last collected</div>
            <div className="card-value" style={{ fontSize: 14 }}>
              <Value
                value={
                  overview
                    ? overview.market.lastSuccessfulRefreshAt
                      ? new Date(overview.market.lastSuccessfulRefreshAt).toLocaleString()
                      : 'Never'
                    : null
                }
              />
            </div>
            {overview?.market?.lastRunStatus && (
              <div className="card-note">Last run: {overview.market.lastRunStatus}</div>
            )}
          </div>
        </div>
      </section>

      <section className="panel" aria-labelledby="overview-historical">
        <h2 id="overview-historical">Historical candles &amp; entry outcomes</h2>
        {mode === 'simple' && (
          <p className="panel-sub">
            Historical price candles and post-buy outcomes are collected manually. These describe
            the market pair after each tracked-wallet buy — they are not wallet profits,
            predictions, or recommendations.
          </p>
        )}
        <div className="cards" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' }}>
          <div className="card">
            <div className="card-label">Tokens with candle history</div>
            <div className="card-value">
              <Value value={overview?.historical?.tokensWithCandles.toLocaleString()} />
            </div>
          </div>
          <div className="card">
            <div className="card-label">Stored candles</div>
            <div className="card-value">
              <Value value={overview?.historical?.totalCandles.toLocaleString()} />
            </div>
          </div>
          <div className="card">
            <div className="card-label">Eligible buy events</div>
            <div className="card-value">
              <Value value={overview?.historical?.eligibleBuyEvents.toLocaleString()} />
            </div>
          </div>
          <div className="card">
            <div className="card-label">Buys with complete outcome</div>
            <div className="card-value status-good">
              <Value value={overview?.historical?.buysWithCompleteOutcome.toLocaleString()} />
            </div>
          </div>
          <div className="card">
            <div className="card-label">Buys with partial outcome</div>
            <div className="card-value status-warn">
              <Value value={overview?.historical?.buysWithPartialOutcome.toLocaleString()} />
            </div>
          </div>
          <div className="card">
            <div className="card-label">Buys without outcome</div>
            <div className="card-value">
              <Value value={overview?.historical?.buysWithoutOutcome.toLocaleString()} />
            </div>
          </div>
          <div className="card">
            <div className="card-label">Candle range</div>
            <div className="card-value" style={{ fontSize: 13 }}>
              <Value
                value={
                  overview
                    ? overview.historical?.earliestCandle
                      ? `${new Date(overview.historical.earliestCandle).toLocaleDateString()} → ${
                          overview.historical.latestCandle
                            ? new Date(overview.historical.latestCandle).toLocaleDateString()
                            : '—'
                        }`
                      : 'None yet'
                    : null
                }
              />
            </div>
            {overview?.historical?.lastBackfillStatus && (
              <div className="card-note">Last backfill: {overview.historical.lastBackfillStatus}</div>
            )}
          </div>
        </div>
      </section>

      <section className="panel" aria-labelledby="overview-positions">
        <h2 id="overview-positions">Wallet position reconstruction</h2>
        <p className="panel-sub">FIFO accounting from synchronized events. Incomplete positions remain explicit and wallets are not ranked.</p>
        <div className="cards">
          <div className="card"><div className="card-label">Wallets reconstructed</div><div className="card-value"><Value value={overview?.positions?.walletsReconstructed.toLocaleString()} /></div></div>
          <div className="card"><div className="card-label">Total positions</div><div className="card-value"><Value value={overview?.positions?.totalPositions.toLocaleString()} /></div></div>
          <div className="card"><div className="card-label">Closed / open</div><div className="card-value"><Value value={overview ? `${overview.positions.closedPositions} / ${overview.positions.openPositions}` : null} /></div></div>
          <div className="card"><div className="card-label">Incomplete positions</div><div className="card-value"><Value value={overview?.positions?.incompletePositions.toLocaleString()} /></div></div>
          <div className="card"><div className="card-label">FIFO matches</div><div className="card-value"><Value value={overview?.positions?.totalMatches.toLocaleString()} /></div></div>
          <div className="card"><div className="card-label">Profiles generated</div><div className="card-value"><Value value={overview?.positions?.profilesGenerated.toLocaleString()} /></div>{overview?.positions?.latestRunStatus&&<div className="card-note">Last run: {overview.positions.latestRunStatus}</div>}</div>
        </div>
      </section>

      <section className="panel" aria-labelledby="overview-capabilities">
        <h2 id="overview-capabilities">Current capabilities</h2>
        <div className="cards" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          <div className="card">
            <div className="card-label">Working today</div>
            <ul className="capability-list" style={{ marginTop: 8 }}>
              {DONE_CAPABILITIES.map((c) => (
                <li key={c}>
                  <span className="status-good" aria-hidden="true">✔</span> {c}
                </li>
              ))}
            </ul>
          </div>
          <div className="card">
            <div className="card-label">Not implemented yet</div>
            <ul className="capability-list" style={{ marginTop: 8 }}>
              {NOT_IMPLEMENTED.map((c) => (
                <li key={c}>
                  <span className="status-muted" aria-hidden="true">○</span>{' '}
                  <span className="status-muted">{c}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
