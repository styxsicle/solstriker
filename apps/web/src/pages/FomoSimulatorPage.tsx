/**
 * FOMO Simulator V1 — paper calls only.
 *
 * Tests Slow Cook's calls with simulated USD positions against already-stored
 * market data. No real trade is ever placed: no wallet connection, no
 * signing, no automatic execution, no copy trading. Historical backtesting
 * is a later, not-yet-built phase — this page only reports what Solstriker's
 * own recorded calls would have done so far.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, type FomoSummary, type PaperCallRecord, type PaperPositionRecord } from '../api';
import { PageHeader } from '../components/PageHeader';
import { useMode } from '../lib/mode';
import { shortAddr } from '../lib/format';
import { formatPlUsd, formatReturnPct, paperActionHeadline, plClass } from '../lib/fomoWording';

function SummaryCard({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <article className="card">
      <p className="panel-sub">{label}</p>
      <p className={`stat-value ${valueClass ?? ''}`}>{value}</p>
    </article>
  );
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'never';
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)} minute(s) ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} hour(s) ago`;
  return `${Math.round(seconds / 86400)} day(s) ago`;
}

function tokenLabel(entity: { tokenName: string | null; tokenSymbol: string | null; tokenMint: string }): string {
  return entity.tokenName ?? entity.tokenSymbol ?? shortAddr(entity.tokenMint);
}

function latestCallFor(calls: PaperCallRecord[], positionId: string): PaperCallRecord | null {
  const matches = calls.filter((c) => c.paperPositionId === positionId);
  if (!matches.length) return null;
  return matches.reduce((latest, call) => (call.createdAt > latest.createdAt ? call : latest));
}

function OpenTradeCard({ position, calls }: { position: PaperPositionRecord; calls: PaperCallRecord[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const { mode } = useMode();
  const latestCall = latestCallFor(calls, position.id);
  const conviction = latestCall?.conviction ?? 'LOW';
  const action = latestCall?.action ?? 'HOLD';

  return (
    <article className="card action-card" aria-label={tokenLabel(position)}>
      <h3>
        {paperActionHeadline(action, conviction)}
        <br />
        <span className={plClass(position.unrealizedPlUsd)}>{formatPlUsd(position.unrealizedPlUsd)}</span>{' '}
        <span className={plClass(position.unrealizedPlUsd)}>{formatReturnPct(position.unrealizedReturnPct)}</span>
      </h3>
      <ul>
        <li>Token: {tokenLabel(position)}</li>
        <li>Entry price: {position.entryPriceUsd}</li>
        <li>Current stored price: {position.latestValueUsd === null ? 'Not yet valued' : `${position.latestValueUsd} (net)`}</li>
        <li>Simulated amount: ${position.notionalUsd}</li>
        <li>Entry time: {new Date(position.openedAt).toLocaleString()}</li>
        <li>
          Last valuation: {position.latestValuationAt ? `${timeAgo(position.latestValuationAt)}` : 'The latest stored market price is old.'}
        </li>
        <li>Wallets: {position.walletIds.length}</li>
        {latestCall?.reasons[0] && <li>{latestCall.reasons[0]}</li>}
        {position.exitSignalPendingReason && <li className="status-warn">{position.exitSignalPendingReason}</li>}
      </ul>

      <div className="toolbar">
        {['why', 'invalidate', 'history', 'assumptions'].map((section) => (
          <button
            key={section}
            className="btn ghost"
            aria-expanded={expanded === section}
            onClick={() => setExpanded((current) => (current === section ? null : section))}
          >
            {section === 'why' && 'Why?'}
            {section === 'invalidate' && 'What changes the call?'}
            {section === 'history' && 'Call history'}
            {section === 'assumptions' && 'Simulation assumptions'}
          </button>
        ))}
      </div>

      {expanded === 'why' && (
        <ul>{(latestCall?.reasons ?? []).map((line, i) => <li key={i}>{line}</li>)}</ul>
      )}
      {expanded === 'invalidate' && (
        <ul>{(latestCall?.invalidation ?? []).map((line, i) => <li key={i}>{line}</li>)}</ul>
      )}
      {expanded === 'history' && (
        <ul>
          {calls
            .filter((c) => c.paperPositionId === position.id)
            .map((c) => (
              <li key={c.id}>
                {c.action} — {new Date(c.createdAt).toLocaleString()}
              </li>
            ))}
        </ul>
      )}
      {expanded === 'assumptions' && (
        <ul>
          <li>Trading fee per side: {position.feeRatePct}%</li>
          <li>Entry slippage: {position.entrySlippagePct}%</li>
          <li>Exit slippage: {position.exitSlippagePct}%</li>
          <li className="status-muted">Paper simulation only. No real trade was placed.</li>
        </ul>
      )}

      {mode === 'quant' && (
        <div className="table-wrap">
          <table className="data-table">
            <tbody>
              <tr><th scope="row">Position ID</th><td className="mono">{position.id}</td></tr>
              <tr><th scope="row">Cohort key</th><td className="mono">{position.cohortKey}</td></tr>
              <tr><th scope="row">Methodology version</th><td className="mono">{position.methodologyVersion}</td></tr>
              <tr><th scope="row">Token quantity</th><td className="mono">{position.tokenQuantity}</td></tr>
              <tr><th scope="row">Effective entry price</th><td className="mono">{position.effectiveEntryPriceUsd}</td></tr>
              <tr><th scope="row">Entry fee</th><td className="mono">{position.entryFeeUsd}</td></tr>
              <tr><th scope="row">Entry snapshot ID</th><td className="mono">{position.entrySnapshotId}</td></tr>
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}

function ClosedTradeCard({ position }: { position: PaperPositionRecord }) {
  const { mode } = useMode();
  return (
    <article className="card action-card" aria-label={tokenLabel(position)}>
      <h3>
        EXIT
        <br />
        Final result:{' '}
        <span className={plClass(position.realizedPlUsd)}>{formatPlUsd(position.realizedPlUsd)}</span>{' '}
        <span className={plClass(position.realizedPlUsd)}>{formatReturnPct(position.realizedReturnPct)}</span>
      </h3>
      <ul>
        <li>Token: {tokenLabel(position)}</li>
        <li>Entry: {position.entryPriceUsd} at {new Date(position.openedAt).toLocaleString()}</li>
        <li>Exit: {position.exitPriceUsd ?? 'Unavailable'} at {position.closedAt ? new Date(position.closedAt).toLocaleString() : 'Unavailable'}</li>
        <li>Fee per side: {position.feeRatePct}% · Entry slippage: {position.entrySlippagePct}% · Exit slippage: {position.exitSlippagePct}%</li>
      </ul>
      {mode === 'quant' && (
        <div className="table-wrap">
          <table className="data-table">
            <tbody>
              <tr><th scope="row">Position ID</th><td className="mono">{position.id}</td></tr>
              <tr><th scope="row">Gross exit value</th><td className="mono">{position.grossExitValueUsd}</td></tr>
              <tr><th scope="row">Exit fee</th><td className="mono">{position.exitFeeUsd}</td></tr>
              <tr><th scope="row">Net exit value</th><td className="mono">{position.netExitValueUsd}</td></tr>
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}

export function FomoSimulatorPage() {
  const { mode } = useMode();
  const [summary, setSummary] = useState<FomoSummary | null>(null);
  const [positions, setPositions] = useState<PaperPositionRecord[]>([]);
  const [calls, setCalls] = useState<PaperCallRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryRes, positionsRes, callsRes] = await Promise.all([
        api<FomoSummary>('/api/fomo-simulator/summary'),
        api<{ items: PaperPositionRecord[] }>('/api/fomo-simulator/positions'),
        api<{ items: PaperCallRecord[] }>('/api/fomo-simulator/calls'),
      ]);
      setSummary(summaryRes);
      setPositions(positionsRes.items);
      setCalls(callsRes.items);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const open = positions.filter((p) => p.status === 'OPEN');
  const closed = positions.filter((p) => p.status === 'CLOSED');
  const positionedIds = new Set(positions.map((p) => p.id));
  const callsWithoutPositions = calls.filter((c) => !c.paperPositionId || !positionedIds.has(c.paperPositionId));
  const noRecordedCalls = !loading && !error && calls.length === 0;

  return (
    <div>
      <PageHeader
        title="FOMO Simulator"
        subtitle="Test Solstriker's calls with paper money and see exactly what would have happened."
      />
      <p className="notice warn" role="note">
        Paper simulation only. No real trade was placed.
      </p>

      {error && (
        <p className="notice danger" role="alert">
          Something went wrong loading the FOMO Simulator.{' '}
          <button className="btn secondary" onClick={() => void load()}>
            Try again
          </button>
        </p>
      )}

      {noRecordedCalls && (
        <div className="empty-state">
          <p>No paper calls yet.</p>
          <p className="status-muted">Run Slow Cook and record a call to begin testing Solstriker.</p>
        </div>
      )}

      {summary && (
        <div className="cards">
          <SummaryCard label="Net P/L" value={formatPlUsd(summary.netPlUsd)} valueClass={plClass(summary.netPlUsd)} />
          <SummaryCard label="Open trades" value={String(summary.openTradeCount)} />
          <SummaryCard label="Closed trades" value={String(summary.closedTradeCount)} />
          <SummaryCard
            label="Win rate"
            value={summary.winRatePct === null ? 'Not enough data' : `${summary.winRatePct}%`}
          />
          <SummaryCard
            label="High-conviction P/L"
            value={formatPlUsd(summary.highConvictionPlUsd)}
            valueClass={plClass(summary.highConvictionPlUsd)}
          />
        </div>
      )}

      {summary && (
        <p className="panel-sub">
          Realized: {formatPlUsd(summary.realizedPlUsd)} · Unrealized: {formatPlUsd(summary.unrealizedPlUsd)}
        </p>
      )}

      {open.length > 0 && (
        <section className="panel" aria-labelledby="fomo-open">
          <h2 id="fomo-open">Open trades</h2>
          {open.map((position) => (
            <OpenTradeCard position={position} calls={calls} key={position.id} />
          ))}
        </section>
      )}

      {closed.length > 0 && (
        <section className="panel" aria-labelledby="fomo-closed">
          <h2 id="fomo-closed">Closed trades</h2>
          {closed.length === 0 && summary?.closedTradeCount === 0 && (
            <p className="empty-state">Win rate will appear after at least one priced paper trade closes.</p>
          )}
          {closed.map((position) => (
            <ClosedTradeCard position={position} key={position.id} />
          ))}
        </section>
      )}

      {closed.length === 0 && summary && summary.closedTradeCount === 0 && open.length > 0 && (
        <p className="empty-state">Win rate will appear after at least one priced paper trade closes.</p>
      )}

      {callsWithoutPositions.length > 0 && (
        <section className="panel" aria-labelledby="fomo-no-position">
          <h2 id="fomo-no-position">Calls without positions</h2>
          <p className="panel-sub">AVOID, NO TRADE, and unpriced BUY calls — never counted in P/L or win rate.</p>
          <ul className="pattern-list">
            {callsWithoutPositions.map((call) => (
              <li key={call.id}>
                <span>
                  {call.action.replace('_', ' ')} — {tokenLabel({ tokenName: call.tokenName, tokenSymbol: call.tokenSymbol, tokenMint: call.tokenMint })}
                  {call.priced === false && call.unpricedReason
                    ? ` — This call was recorded, but no usable market price was available for a simulation.`
                    : ''}
                </span>
                <span className="status-muted">{new Date(call.createdAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {summary && mode === 'quant' && (
        <div className="table-wrap">
          <table className="data-table">
            <tbody>
              <tr><th scope="row">Methodology version</th><td className="mono">{summary.methodologyVersion}</td></tr>
              <tr><th scope="row">Total calls</th><td className="mono">{summary.calls.total}</td></tr>
              <tr><th scope="row">BUY / HOLD / EXIT / AVOID / NO_TRADE</th><td className="mono">{summary.calls.buy} / {summary.calls.hold} / {summary.calls.exit} / {summary.calls.avoid} / {summary.calls.noTrade}</td></tr>
              <tr><th scope="row">Unpriced calls</th><td className="mono">{summary.calls.unpriced}</td></tr>
              <tr><th scope="row">Winning closed trades</th><td className="mono">{summary.winningClosedCount ?? '—'}</td></tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
