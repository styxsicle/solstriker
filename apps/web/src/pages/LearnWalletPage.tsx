/**
 * Simple Mode — Learn a wallet.
 *
 * The beginner-facing version of one-click wallet preparation. It reuses the
 * exact same backend endpoint and services as the Advanced "Prepare wallet
 * research" panel (`POST /api/focus-wallets/prepare`) — nothing here
 * duplicates the pipeline, only the wording and layout are simplified.
 *
 * Flow: search a wallet or paste an address → Learn this wallet → download
 * public trades → organize buys and sells → check past results → learn
 * trading style. It never ranks wallets, never recommends copying anyone, and
 * never begins a real download before the user confirms.
 */
import { useState } from 'react';
import { api, type PrepareBatchResult, type PrepareWalletResult } from '../api';
import { PageHeader } from '../components/PageHeader';
import { ConfirmPrepareModal } from '../components/ConfirmPrepareModal';
import { WalletLabel } from '../components/WalletLabel';
import { useWalletSearch } from '../hooks/useWalletSearch';
import { learnWalletSummary } from '../lib/prepareWording';
import type { PageId } from '../components/Sidebar';

const DEFAULT_TRANSACTION_LIMIT = '500';

function ResultSummary({ result, onNavigate }: { result: PrepareWalletResult; onNavigate: (page: PageId) => void }) {
  const { sentences, nextSteps, fullyLearned } = learnWalletSummary(result);
  return (
    <section className="panel" aria-labelledby="learn-result">
      <h2 id="learn-result">
        What happened with {result.label ?? 'this wallet'}
      </h2>
      <ul className="capability-list">
        {sentences.map((sentence) => (
          <li key={sentence}>{sentence}</li>
        ))}
      </ul>
      <p className="panel-sub">
        {fullyLearned
          ? 'Enough evidence was gathered to describe how this wallet trades.'
          : 'Not enough usable evidence exists yet to describe how this wallet trades.'}
      </p>
      <h3>Inspect next</h3>
      <ul className="capability-list">
        {nextSteps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ul>
      <div className="toolbar">
        <button className="btn secondary" onClick={() => onNavigate('intelligence')}>
          Open Wallet Intelligence
        </button>
        <button className="btn secondary" onClick={() => onNavigate('focus')}>
          Open Focus Trader Lab
        </button>
      </div>
    </section>
  );
}

export function LearnWalletPage({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  const { query: search, setQuery: setSearch, results: found, getWallet } = useWalletSearch({ includeDev: false });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [transactionLimit, setTransactionLimit] = useState(DEFAULT_TRANSACTION_LIMIT);
  const [continueHistoricalSync, setContinueHistoricalSync] = useState(false);
  const [forceRefresh, setForceRefresh] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PrepareWalletResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedWallet = selectedId ? getWallet(selectedId) : undefined;

  async function learnThisWallet() {
    if (!selectedId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const limit = Number(transactionLimit);
      const response = await api<PrepareBatchResult>('/api/focus-wallets/prepare', {
        method: 'POST',
        body: JSON.stringify({
          walletIds: [selectedId],
          syncTransactionLimit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
          continueHistoricalSync,
          forceRefresh,
        }),
      });
      setResult(response.results[0] ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Learn a wallet"
        subtitle="Search a wallet or paste an address, then download its public trades and learn how it appears to trade."
        actions={
          <button className="btn ghost" onClick={() => onNavigate('home')}>
            ← Back to Home
          </button>
        }
      />

      <p className="notice info" role="note">
        This downloads public activity and prepares research data. It does not place trades, connect a
        wallet, or recommend copying the selected wallet.
      </p>
      {error && (
        <p className="notice danger" role="alert">
          {error}
        </p>
      )}

      <section className="panel" aria-labelledby="learn-search">
        <h2 id="learn-search">Search a wallet or paste an address</h2>
        <label className="field">
          Wallet label or address
          <input
            aria-label="Search a wallet or paste an address"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Label or public address"
          />
        </label>
        <div className="wallet-picker">
          {found.map((wallet) => (
            <label className="check" key={wallet.id}>
              <input
                type="radio"
                name="learn-wallet"
                checked={selectedId === wallet.id}
                onChange={() => setSelectedId(wallet.id)}
              />
              <WalletLabel wallet={wallet} />
            </label>
          ))}
          {!found.length && <p className="empty-state">No tracked wallets match this search.</p>}
        </div>
        <p className="notice info" role="note">
          Similar labels do not prove that wallets share an owner. Choosing a wallet studies only that
          exact public address.
        </p>
      </section>

      {selectedWallet && (
        <section className="panel" aria-labelledby="learn-action">
          <h2 id="learn-action">
            Selected wallet: <WalletLabel wallet={selectedWallet} />
          </h2>
          <details className="helper">
            <summary>Advanced preparation options</summary>
            <label className="field">
              Transaction limit
              <input
                aria-label="Transaction limit per wallet"
                inputMode="numeric"
                value={transactionLimit}
                onChange={(event) => setTransactionLimit(event.target.value)}
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
              <input
                type="checkbox"
                checked={forceRefresh}
                onChange={(event) => setForceRefresh(event.target.checked)}
              />
              Refresh completed analysis
            </label>
          </details>
          <div className="toolbar">
            <button className="btn" disabled={busy} aria-busy={busy} onClick={() => setConfirming(true)}>
              Learn this wallet
            </button>
          </div>
        </section>
      )}

      {confirming && selectedWallet && (
        <ConfirmPrepareModal
          walletCount={1}
          busy={busy}
          onCancel={() => !busy && setConfirming(false)}
          onConfirm={() => void learnThisWallet()}
        />
      )}

      {result && <ResultSummary result={result} onNavigate={onNavigate} />}
    </div>
  );
}
