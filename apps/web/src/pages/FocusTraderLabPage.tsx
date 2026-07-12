/**
 * Phase 2C-A — Focus Trader Strategy Lab.
 *
 * Studies how USER-SELECTED public wallets appear to enter, size, manage and
 * exit observed positions. Nothing on this page ranks wallets, claims common
 * ownership, claims profitability, or recommends following, copying or trading.
 * Prerequisites are never satisfied automatically: the lab reads stored
 * evidence and tells the user what is missing.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  api,
  type FocusCohort,
  type StrategyAnalysisResult,
  type StrategyFingerprint,
  type Wallet,
  type WalletListResponse,
} from '../api';
import { PageHeader } from '../components/PageHeader';
import { CohortComparison, StrategyFingerprintPanel, walletName } from '../components/StrategyFingerprint';
import { PrepareWalletPanel } from '../components/PrepareWalletPanel';
import { useMode } from '../lib/mode';
import { shortAddr } from '../lib/format';
import { BANKROLL_STORAGE_KEY, DEFAULT_REFERENCE_BANKROLL_SOL } from '../lib/portability';
import { readinessText, warningText } from '../lib/strategyWording';

const MAX_MEMBERS = 10;
const MAX_COMPARISONS = MAX_MEMBERS - 1;

export function FocusTraderLabPage() {
  const { mode } = useMode();
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [search, setSearch] = useState('');
  const [cohorts, setCohorts] = useState<FocusCohort[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [active, setActive] = useState<FocusCohort | null>(null);
  const [fingerprints, setFingerprints] = useState<StrategyFingerprint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  // Cohort form
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [primary, setPrimary] = useState<string | null>(null);
  const [comparisons, setComparisons] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<StrategyAnalysisResult | null>(null);

  const stored = window.localStorage.getItem(BANKROLL_STORAGE_KEY) ?? DEFAULT_REFERENCE_BANKROLL_SOL;
  const [bankroll, setBankroll] = useState(stored);
  const bankrollNumber = Number(bankroll);
  const validBankroll = Number.isFinite(bankrollNumber) && bankrollNumber > 0;

  const loadCohorts = useCallback(async () => {
    const response = await api<{ items: FocusCohort[] }>('/api/focus-cohorts?pageSize=100');
    setCohorts(response.items);
    return response.items;
  }, []);

  const loadFingerprints = useCallback(async () => {
    const response = await api<{ items: StrategyFingerprint[] }>('/api/wallet-strategies?pageSize=100');
    setFingerprints(response.items);
  }, []);

  useEffect(() => {
    void api<WalletListResponse>('/api/wallets?pageSize=200&includeDev=false')
      .then((response) => setWallets(response.items))
      .catch((e) => setError((e as Error).message));
    void loadCohorts().catch((e) => setError((e as Error).message));
    void loadFingerprints().catch(() => setFingerprints([]));
  }, [loadCohorts, loadFingerprints]);

  useEffect(() => {
    if (!activeId) {
      setActive(null);
      return;
    }
    void api<FocusCohort>(`/api/focus-cohorts/${activeId}`)
      .then(setActive)
      .catch((e) => setError((e as Error).message));
  }, [activeId]);

  function changeBankroll(value: string) {
    setBankroll(value);
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) window.localStorage.setItem(BANKROLL_STORAGE_KEY, value);
  }

  function togglePrimary(walletId: string) {
    setPrimary((current) => (current === walletId ? null : walletId));
    setComparisons((current) => current.filter((id) => id !== walletId));
  }

  function toggleComparison(walletId: string) {
    setComparisons((current) =>
      current.includes(walletId)
        ? current.filter((id) => id !== walletId)
        : current.length >= MAX_COMPARISONS || walletId === primary
          ? current
          : [...current, walletId],
    );
  }

  function move(walletId: string, delta: number) {
    setComparisons((current) => {
      const index = current.indexOf(walletId);
      const next = index + delta;
      if (index < 0 || next < 0 || next >= current.length) return current;
      const copy = [...current];
      [copy[index], copy[next]] = [copy[next], copy[index]];
      return copy;
    });
  }

  function resetForm() {
    setName('');
    setDescription('');
    setPrimary(null);
    setComparisons([]);
    setEditingId(null);
  }

  async function saveCohort() {
    if (!primary || !name.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        members: [
          { trackedWalletId: primary, role: 'PRIMARY' as const, displayOrder: 0 },
          ...comparisons.map((walletId, index) => ({
            trackedWalletId: walletId,
            role: 'COMPARISON' as const,
            displayOrder: index,
          })),
        ],
      };
      const saved = editingId
        ? await api<FocusCohort>(`/api/focus-cohorts/${editingId}`, {
            method: 'PATCH',
            body: JSON.stringify(payload),
          })
        : await api<FocusCohort>('/api/focus-cohorts', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
      await loadCohorts();
      setActiveId(saved.id);
      setStatus(editingId ? 'Focus cohort updated.' : 'Focus cohort saved.');
      resetForm();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function editCohort(cohort: FocusCohort) {
    setEditingId(cohort.id);
    setName(cohort.name);
    setDescription(cohort.description ?? '');
    setPrimary(cohort.members.find((m) => m.role === 'PRIMARY')?.trackedWalletId ?? null);
    setComparisons(
      cohort.members.filter((m) => m.role === 'COMPARISON').map((m) => m.trackedWalletId),
    );
  }

  async function deleteCohort(cohortId: string) {
    setError(null);
    try {
      await api(`/api/focus-cohorts/${cohortId}`, { method: 'DELETE' });
      setConfirmDelete(null);
      if (activeId === cohortId) setActiveId(null);
      if (editingId === cohortId) resetForm();
      await loadCohorts();
      setStatus('Focus cohort deleted. No wallet or research record was deleted.');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function analyzeCohort() {
    if (!active || analyzing) return;
    const analyzable = active.members.filter(
      (member) => active.readiness?.[member.trackedWalletId]?.canAnalyze,
    );
    if (!analyzable.length) return;
    setAnalyzing(true);
    setError(null);
    try {
      const result = await api<StrategyAnalysisResult>('/api/wallet-strategies/analyze', {
        method: 'POST',
        // Primary first, then the user's comparison order.
        body: JSON.stringify({ walletIds: analyzable.map((member) => member.trackedWalletId) }),
      });
      setAnalysis(result);
      await loadFingerprints();
      setActive(await api<FocusCohort>(`/api/focus-cohorts/${active.id}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAnalyzing(false);
    }
  }

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return wallets.slice(0, 25);
    return wallets
      .filter(
        (wallet) =>
          (wallet.label ?? '').toLowerCase().includes(needle) ||
          wallet.address.toLowerCase().includes(needle),
      )
      .slice(0, 25);
  }, [wallets, search]);

  const byWallet = useMemo(() => {
    const map: Record<string, StrategyFingerprint | undefined> = {};
    for (const fingerprint of fingerprints) map[fingerprint.trackedWalletId] = fingerprint;
    return map;
  }, [fingerprints]);

  const primaryMember = active?.members.find((member) => member.role === 'PRIMARY') ?? null;
  const primaryFingerprint = primaryMember ? byWallet[primaryMember.trackedWalletId] : undefined;
  const analyzableCount =
    active?.members.filter((member) => active.readiness?.[member.trackedWalletId]?.canAnalyze).length ?? 0;

  return (
    <div>
      <PageHeader
        title="Focus Trader Lab"
        subtitle="Study how selected public wallets appear to enter, size, manage and exit observed positions."
      />

      <p className="notice warn" role="note">
        Observed behavior does not prove ownership, insider status, lifetime profitability or that the
        strategy can be copied successfully.
      </p>
      {error && (
        <p className="notice danger" role="alert">
          {error}
        </p>
      )}
      {status && (
        <p className="notice info" role="status">
          {status}
        </p>
      )}

      <PrepareWalletPanel wallets={wallets} />

      <section className="panel" aria-labelledby="cohort-setup">
        <h2 id="cohort-setup">Focus cohort setup</h2>
        <p className="panel-sub">
          A focus cohort is a user-selected wallet group for research. Choose one primary wallet and up to{' '}
          {MAX_COMPARISONS} comparison wallets ({MAX_MEMBERS} members in total).
        </p>
        <p className="notice info" role="note">
          Similar labels do not prove that wallets share an owner. Wallets are never added automatically, and
          saving a cohort never synchronizes, reconstructs or analyzes a wallet.
        </p>

        <label className="field">
          Cohort name
          <input
            aria-label="Cohort name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="For example: Focus cohort A"
          />
        </label>
        <label className="field">
          Notes (optional)
          <input
            aria-label="Cohort notes"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Why these wallets were grouped — possibly related, not proven"
          />
        </label>
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
          {shown.map((wallet) => {
            const isPrimary = primary === wallet.id;
            const isComparison = comparisons.includes(wallet.id);
            return (
              <div className="wallet-choice" key={wallet.id}>
                <span>
                  {wallet.emoji} {wallet.label ?? shortAddr(wallet.address)}{' '}
                  <span className="mono">{shortAddr(wallet.address)}</span>
                </span>
                <span className="toolbar">
                  <label className="check">
                    <input
                      type="radio"
                      name="primary-wallet"
                      checked={isPrimary}
                      onChange={() => togglePrimary(wallet.id)}
                    />
                    Primary
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={isComparison}
                      disabled={isPrimary || (!isComparison && comparisons.length >= MAX_COMPARISONS)}
                      onChange={() => toggleComparison(wallet.id)}
                    />
                    Comparison
                  </label>
                </span>
              </div>
            );
          })}
        </div>

        {comparisons.length > 0 && (
          <div className="pattern-block">
            <h3>Comparison order</h3>
            <ol className="pattern-list">
              {comparisons.map((walletId, index) => {
                const wallet = wallets.find((w) => w.id === walletId);
                const label = wallet?.label ?? shortAddr(wallet?.address ?? walletId);
                return (
                  <li key={walletId}>
                    <span>
                      {index + 1}. {label}
                    </span>
                    <span className="toolbar">
                      <button
                        className="btn secondary"
                        disabled={index === 0}
                        aria-label={`Move ${label} up`}
                        onClick={() => move(walletId, -1)}
                      >
                        ↑
                      </button>
                      <button
                        className="btn secondary"
                        disabled={index === comparisons.length - 1}
                        aria-label={`Move ${label} down`}
                        onClick={() => move(walletId, 1)}
                      >
                        ↓
                      </button>
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        )}

        <div className="toolbar">
          <span>
            {primary ? 1 : 0} primary · {comparisons.length} / {MAX_COMPARISONS} comparison wallets
          </span>
          <button className="btn secondary" onClick={resetForm} disabled={saving}>
            Clear
          </button>
          <button
            className="btn"
            disabled={!primary || !name.trim() || saving}
            aria-busy={saving}
            onClick={() => void saveCohort()}
          >
            {saving ? 'Saving…' : editingId ? 'Update cohort' : 'Save cohort'}
          </button>
        </div>
        {!primary && <p className="status-warn">Select exactly one primary wallet to save a cohort.</p>}
      </section>

      <section className="panel" aria-labelledby="cohort-list">
        <h2 id="cohort-list">Saved focus cohorts</h2>
        {!cohorts.length ? (
          <p className="empty-state">No focus cohort has been created yet.</p>
        ) : (
          <ul className="pattern-list">
            {cohorts.map((cohort) => (
              <li key={cohort.id}>
                <span>
                  <strong>{cohort.name}</strong> — {cohort.memberCount} wallets
                  {cohort.description ? ` · ${cohort.description}` : ''}
                </span>
                <span className="toolbar">
                  <button
                    className={`btn ${activeId === cohort.id ? '' : 'secondary'}`}
                    aria-pressed={activeId === cohort.id}
                    onClick={() => setActiveId(cohort.id)}
                  >
                    Open
                  </button>
                  <button className="btn secondary" onClick={() => editCohort(cohort)}>
                    Edit
                  </button>
                  <button className="btn secondary" onClick={() => setConfirmDelete(cohort.id)}>
                    Delete
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        {confirmDelete && (
          <div className="notice warn" role="alertdialog" aria-label="Confirm cohort deletion">
            <p>
              Delete this focus cohort? Only the cohort and its membership are removed. No tracked wallet,
              stored activity, reconstruction, quality record or strategy fingerprint is deleted.
            </p>
            <div className="toolbar">
              <button className="btn secondary" onClick={() => setConfirmDelete(null)}>
                Cancel
              </button>
              <button className="btn danger" onClick={() => void deleteCohort(confirmDelete)}>
                Confirm delete
              </button>
            </div>
          </div>
        )}
      </section>

      {active && (
        <>
          <section className="panel" aria-labelledby="cohort-readiness">
            <h2 id="cohort-readiness">Data readiness — {active.name}</h2>
            <ul className="warning-list">
              {active.warningCodes.map((code) => (
                <li key={code}>
                  {mode === 'quant' ? (
                    <>
                      <span className="mono">{code}</span> — {warningText(code)}
                    </>
                  ) : (
                    warningText(code)
                  )}
                </li>
              ))}
            </ul>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Wallet</th>
                    <th scope="col">Address</th>
                    <th scope="col">Role</th>
                    <th scope="col">Sync completeness</th>
                    <th scope="col">Stored events</th>
                    <th scope="col">Reconstruction</th>
                    <th scope="col">Quality analysis</th>
                    <th scope="col">Strategy fingerprint</th>
                    <th scope="col">Eligible cycles</th>
                  </tr>
                </thead>
                <tbody>
                  {active.members.map((member) => {
                    const readiness = active.readiness?.[member.trackedWalletId];
                    return (
                      <tr key={member.id}>
                        <td>{member.wallet.label ?? shortAddr(member.wallet.address)}</td>
                        <td className="mono">{shortAddr(member.wallet.address)}</td>
                        <td>{member.role === 'PRIMARY' ? 'Primary' : 'Comparison'}</td>
                        <td>
                          {!readiness?.synchronized
                            ? 'Never synchronized'
                            : readiness.backfillComplete
                              ? 'Complete synchronized history'
                              : 'Partial history'}
                        </td>
                        <td className="mono">{readiness?.storedEventCount ?? 0}</td>
                        <td>{readiness?.reconstructionStatus ?? 'NONE'}</td>
                        <td>{readiness?.qualityStatus ?? 'NONE'}</td>
                        <td>{readiness?.fingerprintStatus ?? 'NONE'}</td>
                        <td className="mono">{readiness?.eligibleCycleCount ?? '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <ul className="capability-list">
              {active.members.map((member) => {
                const readiness = active.readiness?.[member.trackedWalletId];
                if (!readiness?.missingPrerequisites.length) return null;
                return (
                  <li key={member.id}>
                    <strong>{member.wallet.label ?? shortAddr(member.wallet.address)}</strong>:{' '}
                    {readiness.missingPrerequisites.map((code) => readinessText(code)).join(' ')}
                  </li>
                );
              })}
            </ul>
            <p className="panel-sub">
              The lab never synchronizes, reconstructs or analyzes prerequisites automatically. Use the
              existing Activity and Wallet Intelligence pages to do that explicitly.
            </p>
          </section>

          <section className="panel" aria-labelledby="analyze-cohort">
            <h2 id="analyze-cohort">Analyze cohort members</h2>
            <p className="panel-sub">
              Calculates a strategy fingerprint for the cohort members that already have a completed
              reconstruction (maximum {MAX_MEMBERS}; the primary wallet is analyzed first). There is no
              analyze-all-wallets action.
            </p>
            <div className="toolbar">
              <span>
                {analyzableCount} of {active.members.length} members have the required reconstruction.
              </span>
              <button
                className="btn"
                disabled={!analyzableCount || analyzing}
                aria-busy={analyzing}
                onClick={() => void analyzeCohort()}
              >
                {analyzing ? 'Analyzing…' : `Analyze ${analyzableCount} cohort member${analyzableCount === 1 ? '' : 's'}`}
              </button>
            </div>
            {!analyzableCount && (
              <p className="status-warn" role="note">
                No cohort member has a completed reconstruction yet, so no strategy fingerprint can be
                calculated.
              </p>
            )}
            {analysis && (
              <div className="import-summary" role="status">
                <span>{analysis.fingerprintsCreated} fingerprints</span>
                <span>{analysis.patternsCreated} pattern rows</span>
                <span>{analysis.eligibleCycles} eligible cycles</span>
                <span>{analysis.excludedCycles} excluded cycles</span>
                <span>{analysis.warnings} warnings</span>
                <span>{analysis.failures} failures</span>
              </div>
            )}
          </section>

          <section className="panel" aria-labelledby="reference-bankroll">
            <h2 id="reference-bankroll">Reference bankroll</h2>
            <p className="panel-sub">
              A local comparison setting only, stored in this browser. No wallet is connected, no balance is
              fetched, and this value is never saved to the database.
            </p>
            <label className="field">
              Reference bankroll (SOL)
              <input
                aria-label="Reference bankroll (SOL)"
                inputMode="decimal"
                value={bankroll}
                onChange={(event) => changeBankroll(event.target.value)}
              />
            </label>
            {!validBankroll && (
              <p className="status-warn" role="alert">
                Enter a reference bankroll greater than zero.
              </p>
            )}
          </section>

          {primaryFingerprint ? (
            <StrategyFingerprintPanel
              fingerprint={primaryFingerprint}
              bankroll={validBankroll ? bankrollNumber : null}
              mode={mode}
            />
          ) : (
            <section className="panel">
              <h2>Primary-wallet strategy fingerprint</h2>
              <p className="empty-state">
                {primaryMember
                  ? `No strategy fingerprint has been calculated for ${walletName({
                      trackedWallet: primaryMember.wallet,
                      trackedWalletId: primaryMember.trackedWalletId,
                    })} yet.`
                  : 'This cohort has no primary wallet.'}
              </p>
            </section>
          )}

          <CohortComparison
            members={active.members}
            fingerprints={byWallet}
            bankroll={validBankroll ? bankrollNumber : null}
            mode={mode}
          />

          {mode === 'quant' && (
            <section className="panel" aria-labelledby="cohort-quant">
              <h2 id="cohort-quant">Quant Mode — cohort record</h2>
              <div className="table-wrap">
                <table className="data-table">
                  <tbody>
                    <tr>
                      <th scope="row">Cohort ID</th>
                      <td className="mono">{active.id}</td>
                    </tr>
                    {active.members.map((member) => (
                      <tr key={member.id}>
                        <th scope="row">Member ID / role</th>
                        <td className="mono">
                          {member.id} · {member.role} · order {member.displayOrder} · wallet{' '}
                          {member.trackedWalletId}
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <th scope="row">Fingerprint run ID</th>
                      <td className="mono">{analysis?.runId ?? primaryFingerprint?.runId ?? 'none'}</td>
                    </tr>
                    <tr>
                      <th scope="row">Calculation version</th>
                      <td className="mono">{primaryFingerprint?.calculationVersion ?? 'none'}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
