/**
 * One-click Focus Wallet Preparation.
 *
 * A user-triggered preparation workflow — never background monitoring. It
 * runs the existing research pipeline, in order, for 1–5 explicitly selected
 * wallets: synchronize activity, reconstruct positions, analyze quality,
 * generate a strategy fingerprint. It never ranks wallets and never
 * recommends following, copying or trading anything.
 */
import { useState } from 'react';
import { api, type PrepareBatchResult, type PrepareWalletResult, type Wallet } from '../api';
import { shortAddr } from '../lib/format';
import { reasonText, stageLabel, type StageKind } from '../lib/prepareWording';
import { ConfirmPrepareModal } from './ConfirmPrepareModal';

const MAX_PREPARE_WALLETS = 5;
const DEFAULT_TRANSACTION_LIMIT = '500';

const STAGE_ORDER: { kind: StageKind; title: string }[] = [
  { kind: 'sync', title: 'Activity' },
  { kind: 'reconstruction', title: 'Reconstruction' },
  { kind: 'quality', title: 'Quality evidence' },
  { kind: 'fingerprint', title: 'Strategy fingerprint' },
];

function badgeClass(label: string): string {
  if (label === 'Failed — retry available') return 'badge bad';
  if (label === 'Already current' || label.endsWith('ready') || label === 'Synchronized' || label === 'Reconstructed') {
    return 'badge good';
  }
  if (label === 'Insufficient history') return 'badge warn';
  return 'badge muted';
}

function ResultCard({ result, onRetry }: { result: PrepareWalletResult; onRetry: (walletId: string) => void }) {
  return (
    <article className="card prepare-result-card" aria-label={result.label ?? shortAddr(result.address)}>
      <h4>
        {result.label ?? shortAddr(result.address)} <span className="mono">{shortAddr(result.address)}</span>
      </h4>
      <p className="panel-sub">
        Stored events: {result.storedEventCountBefore} → {result.storedEventCountAfter}
        {result.backfillComplete ? ' · Full synchronized history' : ' · Partial synchronized history'}
      </p>
      <div className="prepare-stage-row">
        {STAGE_ORDER.map(({ kind, title }) => {
          const stage = result[kind];
          const label = stageLabel(kind, stage, false, kind === 'fingerprint' ? result.fingerprint.eligibleCycleCount : undefined);
          return (
            <div className="prepare-stage" key={kind}>
              <span className="prepare-stage-title">{title}</span>
              <span className={badgeClass(label)}>{label}</span>
              {stage.reason && <span className="prepare-stage-reason">{reasonText(stage.reason)}</span>}
            </div>
          );
        })}
      </div>
      {result.warningCodes.length > 0 && (
        <p className="notice info">{result.warningCodes.length} data-quality warning{result.warningCodes.length === 1 ? '' : 's'} were recorded for this wallet — see Wallet Intelligence and the Focus Trader fingerprint below for details.</p>
      )}
      {result.sanitizedError && (
        <div className="toolbar">
          <button className="btn secondary" onClick={() => onRetry(result.walletId)}>
            Retry this wallet
          </button>
        </div>
      )}
      <div className="toolbar">
        <button className="btn ghost" onClick={() => { window.location.hash = '/intelligence'; }}>
          View in Wallet Intelligence
        </button>
        <button
          className="btn ghost"
          onClick={() => {
            const id = result.fingerprint.fingerprintId;
            const el = id ? document.getElementById(`fingerprint-${id}`) : null;
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}
          disabled={!result.fingerprint.fingerprintId}
        >
          View Focus Trader fingerprint
        </button>
      </div>
    </article>
  );
}

export function PrepareWalletPanel({ wallets }: { wallets: Wallet[] }) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [syncTransactionLimit, setSyncTransactionLimit] = useState(DEFAULT_TRANSACTION_LIMIT);
  const [continueHistoricalSync, setContinueHistoricalSync] = useState(false);
  const [forceRefresh, setForceRefresh] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PrepareBatchResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggle(walletId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(walletId)) next.delete(walletId);
      else if (next.size < MAX_PREPARE_WALLETS) next.add(walletId);
      return next;
    });
  }

  async function runPrepare(walletIds: string[]) {
    setBusy(true);
    setError(null);
    try {
      const limit = Number(syncTransactionLimit);
      const response = await api<PrepareBatchResult>('/api/focus-wallets/prepare', {
        method: 'POST',
        body: JSON.stringify({
          walletIds,
          syncTransactionLimit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
          continueHistoricalSync,
          forceRefresh,
        }),
      });
      setResult((previous) => {
        if (!previous) return response;
        const merged = previous.results.filter((r) => !walletIds.includes(r.walletId));
        return {
          requestedWallets: merged.length + response.results.length,
          processedWallets: merged.length + response.processedWallets,
          failures: merged.filter((r) => r.sanitizedError).length + response.failures,
          results: [...merged, ...response.results],
        };
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  function retryWallet(walletId: string) {
    setSelected(new Set([walletId]));
    setConfirming(true);
  }

  const shown = wallets
    .filter(
      (wallet) =>
        !search.trim() ||
        (wallet.label ?? '').toLowerCase().includes(search.toLowerCase()) ||
        wallet.address.toLowerCase().includes(search.toLowerCase()),
    )
    .slice(0, 25);

  return (
    <section className="panel" aria-labelledby="prepare-wallets">
      <h2 id="prepare-wallets">Prepare wallet research</h2>
      <p className="notice info" role="note">
        This downloads public activity and prepares research data. It does not place trades,
        connect a wallet, or recommend copying the selected wallets.
      </p>
      {error && (
        <p className="notice danger" role="alert">
          {error}
        </p>
      )}

      <label className="field">
        Search tracked wallets
        <input
          aria-label="Search wallets to prepare"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Label or public address"
        />
      </label>
      <div className="wallet-picker">
        {shown.map((wallet) => (
          <label className="check" key={wallet.id}>
            <input
              type="checkbox"
              checked={selected.has(wallet.id)}
              disabled={!selected.has(wallet.id) && selected.size >= MAX_PREPARE_WALLETS}
              onChange={() => toggle(wallet.id)}
            />
            {wallet.emoji} {wallet.label ?? shortAddr(wallet.address)}{' '}
            <span className="mono">{shortAddr(wallet.address)}</span>
          </label>
        ))}
      </div>

      <label className="field">
        Transaction limit per wallet
        <input
          aria-label="Transaction limit per wallet"
          inputMode="numeric"
          value={syncTransactionLimit}
          onChange={(event) => setSyncTransactionLimit(event.target.value)}
        />
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={continueHistoricalSync}
          onChange={(event) => setContinueHistoricalSync(event.target.checked)}
        />
        Continue older history
      </label>
      <label className="check">
        <input type="checkbox" checked={forceRefresh} onChange={(event) => setForceRefresh(event.target.checked)} />
        Refresh completed analysis
      </label>

      <div className="toolbar">
        <span>{selected.size} / {MAX_PREPARE_WALLETS} selected</span>
        <button className="btn secondary" disabled={!selected.size} onClick={() => setSelected(new Set())}>
          Clear selection
        </button>
        <button className="btn" disabled={!selected.size || busy} aria-busy={busy} onClick={() => setConfirming(true)}>
          Prepare selected wallets
        </button>
      </div>

      {confirming && (
        <ConfirmPrepareModal
          walletCount={selected.size}
          busy={busy}
          onCancel={() => !busy && setConfirming(false)}
          onConfirm={() => void runPrepare([...selected])}
        />
      )}

      {result && (
        <>
          <div className="import-summary" role="status">
            <span>{result.processedWallets} processed</span>
            <span>{result.failures} failures</span>
          </div>
          <div className="prepare-results">
            {result.results.map((item) => (
              <ResultCard key={item.walletId} result={item} onRetry={retryWallet} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
