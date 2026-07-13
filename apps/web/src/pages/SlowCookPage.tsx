/**
 * Slow Cook V1 — patient, high-conviction research over explicitly selected
 * wallets.
 *
 * This is decision support, not a trading system: it never connects a
 * wallet, never signs anything, never buys or sells, and never claims a
 * guaranteed outcome. Every fact shown here traces back to stored activity
 * and each selected wallet's own deterministic Wallet Style Memory — never
 * to any wallet the user did not explicitly select.
 */
import { useState } from 'react';
import {
  api,
  type SlowCookCandidate,
  type SlowCookResult,
  type SlowCookWalletStyleMemory,
} from '../api';
import { PageHeader } from '../components/PageHeader';
import { WalletLabel } from '../components/WalletLabel';
import { useWalletSearch } from '../hooks/useWalletSearch';
import { useMode } from '../lib/mode';
import { shortAddr } from '../lib/format';
import { slowCookConfidenceText, slowCookHeadline, slowCookStateText } from '../lib/slowCookWording';
import type { PageId } from '../components/Sidebar';

const MAX_SLOW_COOK_WALLETS = 10;
const DEFAULT_LOOKBACK_DAYS = '30';
const DEFAULT_MINIMUM_WALLETS = '1';
const DEFAULT_LIMIT = '20';

function StyleMemoryCard({ memory }: { memory: SlowCookWalletStyleMemory }) {
  return (
    <article className="card" aria-label={memory.label ?? shortAddr(memory.address)}>
      <h4>
        {memory.label ?? shortAddr(memory.address)} <span className="mono">{shortAddr(memory.address)}</span>
      </h4>
      <ul>
        {memory.summarySentences.map((sentence, index) => (
          <li key={index}>{sentence}</li>
        ))}
      </ul>
    </article>
  );
}

function CandidateCard({ candidate }: { candidate: SlowCookCandidate }) {
  const [expanded, setExpanded] = useState(false);
  const { mode } = useMode();
  const headline = slowCookHeadline(candidate.state, candidate.confidence);

  return (
    <article className="card action-card" aria-label={candidate.name ?? candidate.mintAddress}>
      <h3>
        {headline} — {candidate.name ?? candidate.symbol ?? shortAddr(candidate.mintAddress)}{' '}
        <span className="mono">{shortAddr(candidate.mintAddress)}</span>
      </h3>
      <p className="panel-sub">{slowCookStateText(candidate.state)}</p>
      <p className="panel-sub">{slowCookConfidenceText(candidate.confidence)}</p>

      <div className="pattern-block">
        <h4>Why this appeared</h4>
        <ul>
          {candidate.whyThisAppeared.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
      </div>

      <div className="pattern-block">
        <h4>How these wallets have behaved before</h4>
        <p>{candidate.styleMatchSummary}</p>
        <ul>
          {candidate.wallets.map((wallet) => (
            <li key={wallet.walletId}>
              {wallet.label ?? shortAddr(wallet.address)} <span className="mono">{shortAddr(wallet.address)}</span>
              {' — '}
              {wallet.buyCount} buy(s), {wallet.sellCount} sell(s)
              {wallet.hasOpenPosition ? ', currently has a reconstructed open position' : ''}.
              {wallet.styleMatch ? ` ${wallet.styleMatch}` : ' Not enough evidence to compare this wallet\'s current activity to its own history.'}
            </li>
          ))}
        </ul>
      </div>

      <div className="pattern-block">
        <h4>What changes the call?</h4>
        <ul>
          {candidate.whatCouldInvalidate.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
      </div>

      <div className="pattern-block">
        <h4>Market context</h4>
        {candidate.market ? (
          <ul>
            <li>Price: {candidate.market.priceUsd ?? 'Unavailable'}</li>
            <li>Liquidity: {candidate.market.liquidityUsd ?? 'Unavailable'}</li>
            <li>Market cap: {candidate.market.marketCapUsd ?? 'Unavailable'}</li>
            <li>24h volume: {candidate.market.volume24hUsd ?? 'Unavailable'}</li>
            <li>
              {candidate.market.freshness === 'STALE' ? 'Stale snapshot' : 'Snapshot'} observed{' '}
              {candidate.market.observedAt ? new Date(candidate.market.observedAt).toLocaleString() : 'at an unknown time'}
            </li>
          </ul>
        ) : (
          <p className="empty-state">No market data has been collected for this token yet.</p>
        )}
      </div>

      <button className="btn ghost" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
        {expanded ? 'Hide details' : 'Show more evidence'}
      </button>

      {expanded && (
        <div className="pattern-block">
          <h4>Evidence detail</h4>
          <ul>
            <li>Wallets with evidence: {candidate.walletInterest.walletsWithEvidenceCount}</li>
            <li>Recent buys: {candidate.walletInterest.recentBuyCount}</li>
            <li>Wallets with an open position: {candidate.walletInterest.openPositionWalletCount}</li>
            <li>Repeat-buy wallets: {candidate.accumulation.repeatBuyWalletCount}</li>
            <li>Detected sells: {candidate.distributionPressure.detectedSellCount}</li>
            <li>Distribution pressure: {candidate.distributionPressure.label}</li>
            <li>
              Data quality: {candidate.dataQuality.contributingWalletsCurrentCount} wallet(s) with current research,{' '}
              {candidate.dataQuality.contributingWalletsStaleOrMissingCount} with stale or missing research
            </li>
          </ul>
        </div>
      )}

      {mode === 'quant' && (
        <div className="table-wrap">
          <table className="data-table">
            <tbody>
              <tr>
                <th scope="row">Token ID</th>
                <td className="mono">{candidate.tokenId}</td>
              </tr>
              <tr>
                <th scope="row">Confidence score</th>
                <td className="mono">{candidate.confidenceScore}</td>
              </tr>
              <tr>
                <th scope="row">Confidence components</th>
                <td className="mono">{JSON.stringify(candidate.confidenceComponents)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}

export function SlowCookPage({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  const { mode } = useMode();
  const { query: search, setQuery: setSearch, results: found, getWallet } = useWalletSearch({ includeDev: false });
  const [selected, setSelected] = useState<string[]>([]);
  const [lookbackDays, setLookbackDays] = useState(DEFAULT_LOOKBACK_DAYS);
  const [minimumWallets, setMinimumWallets] = useState(DEFAULT_MINIMUM_WALLETS);
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [includeLowerConfidence, setIncludeLowerConfidence] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SlowCookResult | null>(null);

  function toggle(walletId: string) {
    setSelected((current) =>
      current.includes(walletId)
        ? current.filter((id) => id !== walletId)
        : current.length >= MAX_SLOW_COOK_WALLETS
          ? current
          : [...current, walletId],
    );
  }

  function remove(walletId: string) {
    setSelected((current) => current.filter((id) => id !== walletId));
  }

  async function run() {
    if (!selected.length || busy) return;
    setBusy(true);
    setError(null);
    try {
      const lookback = Number(lookbackDays);
      const minWallets = Number(minimumWallets);
      const limitNum = Number(limit);
      const response = await api<SlowCookResult>('/api/slow-cook/analyze', {
        method: 'POST',
        body: JSON.stringify({
          walletIds: selected,
          lookbackDays: Number.isFinite(lookback) && lookback > 0 ? lookback : undefined,
          minimumWallets: Number.isFinite(minWallets) && minWallets > 0 ? minWallets : undefined,
          limit: Number.isFinite(limitNum) && limitNum > 0 ? limitNum : undefined,
          includeLowerConfidence,
        }),
      });
      setResult(response);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Selected wallets stay visible even if the current search no longer matches them.
  const pinned = selected
    .filter((id) => !found.some((wallet) => wallet.id === id))
    .flatMap((id) => {
      const wallet = getWallet(id);
      return wallet ? [wallet] : [];
    });
  const shown = [...pinned, ...found];

  const unpreparedOnly =
    result !== null && result.walletsWithUsableStyle === 0 && result.candidatesFound === 0;
  const weakEvidenceOnly =
    result !== null && !unpreparedOnly && result.candidatesFound === 0 && !includeLowerConfidence;

  return (
    <div>
      <PageHeader
        title="Slow Cook"
        subtitle="Patient, high-conviction setups from selected wallets' real stored activity and their own trading history."
      />

      <p className="notice warn" role="note">
        This is research, not a trading system. It never connects a wallet, never signs anything, never buys or
        sells, and never guarantees a profit. Historical behavior does not predict a wallet's next action.
      </p>

      {error && (
        <p className="notice danger" role="alert">
          Something went wrong while analyzing these wallets.{' '}
          <button className="btn secondary" onClick={() => void run()}>
            Try again
          </button>
        </p>
      )}

      <section className="panel" aria-labelledby="slow-cook-selection">
        <h2 id="slow-cook-selection">Selected wallets</h2>
        <p className="panel-sub">
          Only wallets you select here can affect results — no other tracked wallet's activity is used.
        </p>
        <label className="field">
          Search tracked wallets
          <input
            aria-label="Search tracked wallets"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Label or public address"
          />
        </label>
        <div className="wallet-picker">
          {!shown.length && <p className="empty-state">No tracked wallets match this search.</p>}
          {shown.map((wallet) => (
            <label className="check" key={wallet.id}>
              <input
                type="checkbox"
                checked={selected.includes(wallet.id)}
                disabled={!selected.includes(wallet.id) && selected.length >= MAX_SLOW_COOK_WALLETS}
                onChange={() => toggle(wallet.id)}
              />
              <WalletLabel wallet={wallet} />
            </label>
          ))}
        </div>

        {selected.length > 0 && (
          <ul className="pattern-list">
            {selected.map((walletId) => {
              const wallet = getWallet(walletId);
              return (
                <li key={walletId}>
                  <span>{wallet ? <WalletLabel wallet={wallet} /> : walletId}</span>
                  <button className="btn secondary" aria-label={`Remove ${wallet?.label ?? walletId}`} onClick={() => remove(walletId)}>
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="toolbar">
          <span>{selected.length} / {MAX_SLOW_COOK_WALLETS} selected</span>
        </div>

        <details className="helper advanced-disclosure">
          <summary>Research settings</summary>
          <label className="field">
            Lookback (days)
            <input
              aria-label="Lookback days"
              inputMode="numeric"
              value={lookbackDays}
              onChange={(event) => setLookbackDays(event.target.value)}
            />
          </label>
          <label className="field">
            Minimum wallets
            <input
              aria-label="Minimum wallets"
              inputMode="numeric"
              value={minimumWallets}
              onChange={(event) => setMinimumWallets(event.target.value)}
            />
          </label>
          <label className="field">
            Candidate limit
            <input
              aria-label="Candidate limit"
              inputMode="numeric"
              value={limit}
              onChange={(event) => setLimit(event.target.value)}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={includeLowerConfidence}
              onChange={(event) => setIncludeLowerConfidence(event.target.checked)}
            />
            Include weaker evidence
          </label>
        </details>

        {!selected.length && <p className="status-warn">Select at least one wallet to search for slow-cook setups.</p>}

        <div className="toolbar">
          <button className="btn" disabled={!selected.length || busy} aria-busy={busy} onClick={() => void run()}>
            {busy ? 'Searching…' : 'Find slow-cook setups'}
          </button>
        </div>
      </section>

      {result && (
        <section className="panel" aria-labelledby="slow-cook-results">
          <h2 id="slow-cook-results">Results</h2>

          {unpreparedOnly && (
            <div className="empty-state">
              <p>None of the selected wallets have prepared research data yet.</p>
              <p className="status-muted">
                Prepare wallet research on the Learn a wallet page, then try again.
              </p>
              <button className="btn secondary" onClick={() => onNavigate('learn-wallet')}>
                Go to Learn a wallet
              </button>
            </div>
          )}

          {!unpreparedOnly && weakEvidenceOnly && (
            <div className="empty-state">
              <p>Only weak-evidence setups were found for the selected wallets.</p>
              <p className="status-muted">
                Turn on &quot;Include weaker evidence&quot; in Research settings to see them.
              </p>
            </div>
          )}

          {!unpreparedOnly && !weakEvidenceOnly && result.candidatesFound === 0 && (
            <p className="empty-state">No slow-cook setups were found for the selected wallets in this lookback window.</p>
          )}

          {result.candidates.map((candidate) => (
            <CandidateCard candidate={candidate} key={candidate.tokenId} />
          ))}

          <div className="pattern-block">
            <h3>Wallet style memory</h3>
            <p className="panel-sub">
              Each selected wallet's style is described separately, based only on that wallet's own history —
              styles are never averaged together.
            </p>
            {result.styleMemories.map((memory) => (
              <StyleMemoryCard memory={memory} key={memory.walletId} />
            ))}
          </div>

          {mode === 'quant' && (
            <div className="table-wrap">
              <table className="data-table">
                <tbody>
                  <tr>
                    <th scope="row">Methodology version</th>
                    <td className="mono">{result.calculationVersion}</td>
                  </tr>
                  <tr>
                    <th scope="row">Analyzed at</th>
                    <td className="mono">{result.analyzedAt}</td>
                  </tr>
                  <tr>
                    <th scope="row">Options</th>
                    <td className="mono">{JSON.stringify(result.options)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
