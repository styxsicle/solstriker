/**
 * Phase 2C-A — Focus Trader strategy-fingerprint presentation.
 *
 * Describes observed behavior only. No card ranks a wallet, claims ownership,
 * claims profitability, or suggests following, copying or trading anything.
 */
import type { DescriptorEvidence, FocusCohortMember, StrategyFingerprint, StrategyPattern } from '../api';
import { shortAddr } from '../lib/format';
import {
  calculatePortability,
  ILLUSTRATION_SHARES,
  PORTABILITY_STATE_TEXT,
  type Portability,
} from '../lib/portability';
import { descriptorText, durationText, warningText } from '../lib/strategyWording';

const unknown = 'Not enough reliable synchronized data.';

const round = (value: string | null, digits = 2) => {
  if (value === null) return unknown;
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? parsed.toLocaleString(undefined, { maximumFractionDigits: digits })
    : unknown;
};
const sol = (value: string | null, mode: string) =>
  value === null ? unknown : `${mode === 'quant' ? value : round(value, 6)} SOL`;
const percent = (value: string | null, mode: string) =>
  value === null ? unknown : `${mode === 'quant' ? value : round(value, 2)}%`;
const time = (value: string | null, mode: string) =>
  value === null ? unknown : mode === 'quant' ? `${value} seconds` : durationText(value);
const pctNumber = (value: number | null, digits = 2) =>
  value === null ? unknown : `${value.toFixed(digits)}%`;
const solNumber = (value: number | null, digits = 4) =>
  value === null ? unknown : `${value.toFixed(digits)} SOL`;

export const walletName = (fingerprint: {
  trackedWallet?: { address: string; label: string | null } | null;
  trackedWalletId: string;
}) =>
  fingerprint.trackedWallet?.label ??
  shortAddr(fingerprint.trackedWallet?.address ?? fingerprint.trackedWalletId);

function Field({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="market-field">
      <span className="market-field-label" title={title}>
        {label}
      </span>
      <span className="market-field-value mono" title={value}>
        {value}
      </span>
    </div>
  );
}

function patternsOf(fingerprint: StrategyFingerprint, type: string): StrategyPattern[] {
  return (fingerprint.patterns ?? [])
    .filter((pattern) => pattern.patternType === type)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

function Distribution({
  title,
  patterns,
  mode,
  empty,
}: {
  title: string;
  patterns: StrategyPattern[];
  mode: string;
  empty: string;
}) {
  return (
    <div className="pattern-block">
      <h4>{title}</h4>
      {!patterns.length ? (
        <p className="empty-state">{empty}</p>
      ) : (
        <ul className="pattern-list">
          {patterns.map((pattern) => (
            <li key={pattern.id}>
              <span>{pattern.patternValue}</span>
              <span className="mono">
                {pattern.eligibleCount} of {pattern.totalCount} ({percent(pattern.percentage, mode)})
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Every descriptor expands into its formula, sample, threshold and warnings. */
function Descriptors({ evidence, mode }: { evidence: DescriptorEvidence[]; mode: string }) {
  if (!evidence.length) return <p className="empty-state">No descriptor reached its evidence threshold.</p>;
  return (
    <div className="descriptor-list">
      {evidence.map((item) => (
        <details key={item.code} className="card descriptor">
          <summary>
            <strong>{descriptorText(item.code)}</strong>{' '}
            <span className="badge muted">{item.sampleCount} eligible observations</span>
          </summary>
          <div className="market-grid">
            <Field label="Formula" value={item.formula} />
            <Field
              label="Sample"
              value={
                item.numerator !== null && item.denominator !== null
                  ? `${item.numerator} of ${item.denominator}`
                  : String(item.sampleCount)
              }
            />
            <Field label="Observed" value={item.observed === null ? unknown : mode === 'quant' ? item.observed : round(item.observed)} />
            <Field label="Threshold" value={item.threshold} />
            <Field label="Confidence" value={item.confidence} />
          </div>
          {item.warningCodes.length > 0 && (
            <ul className="warning-list">
              {item.warningCodes.map((code) => (
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
          )}
        </details>
      ))}
    </div>
  );
}

function Limitations({ codes, mode }: { codes: string[]; mode: string }) {
  const unique = [...new Set(codes)];
  if (!unique.length) return null;
  return (
    <details className="data-limitations">
      <summary>Evidence limitations ({unique.length})</summary>
      <ul>
        {unique.map((code) => (
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
    </details>
  );
}

function PortabilityCard({ portability, mode }: { portability: Portability; mode: string }) {
  const p = portability;
  return (
    <article className="card" aria-labelledby="portability-heading">
      <h3 id="portability-heading">Reference-bankroll illustration</h3>
      <p className="notice info">
        The app does not know this wallet’s historical total bankroll at the time of each trade. These
        figures illustrate what the observed structure would cost at your own reference bankroll. They
        are not a recommended position size and not a verdict on whether the strategy can be copied.
      </p>
      {p.states.includes('UNAVAILABLE') ? (
        <p className="empty-state">{PORTABILITY_STATE_TEXT.UNAVAILABLE}</p>
      ) : (
        <>
          <div className="market-grid">
            <Field label="Reference bankroll" value={solNumber(p.bankroll, 2)} />
            <Field label="Median first buy (observed)" value={solNumber(p.medianFirstBuySol)} />
            <Field label="Median first buy / bankroll" value={pctNumber(p.medianFirstBuyPctOfBankroll)} />
            <Field label="Median cycle cost (observed)" value={solNumber(p.medianCycleCostSol)} />
            <Field label="Median cycle cost / bankroll" value={pctNumber(p.medianCyclePctOfBankroll)} />
            <Field label="P75 cycle cost / bankroll" value={pctNumber(p.p75CyclePctOfBankroll)} />
            <Field label="Median entries per cycle" value={p.medianEntriesPerCycle === null ? unknown : String(p.medianEntriesPerCycle)} />
            <Field label="Median exits per cycle" value={p.medianExitsPerCycle === null ? unknown : String(p.medianExitsPerCycle)} />
            <Field label="Median known fees per cycle" value={solNumber(p.medianFeesPerCycleSol, 6)} />
            <Field label="One median position / bankroll" value={pctNumber(p.onePositionPctOfBankroll)} />
            <Field label="Two median positions / bankroll" value={pctNumber(p.twoPositionsPctOfBankroll)} />
            <Field
              label={`Observed max concurrency (${p.observedMaxConcurrentPositions}) / bankroll`}
              value={pctNumber(p.maxConcurrencyPctOfBankroll)}
            />
          </div>
          {p.medianCycleCostSol !== null && p.bankroll !== null && (
            <p>
              At a {p.bankroll} SOL reference bankroll, {p.observedMaxConcurrentPositions || 1} median-sized
              simultaneous position
              {(p.observedMaxConcurrentPositions || 1) === 1 ? '' : 's'} would use approximately{' '}
              {(p.medianCycleCostSol * (p.observedMaxConcurrentPositions || 1)).toFixed(4)} SOL before fees.
            </p>
          )}
          {p.feeIllustrations.length > 0 && (
            <div className="pattern-block">
              <h4>Fee burden at a proportionally scaled position</h4>
              <p className="panel-sub">
                Per-transaction costs stay roughly the same in SOL, so the same number of entries and exits
                costs a larger percentage of a smaller position.
              </p>
              <ul className="pattern-list">
                {p.feeIllustrations.map((illustration) => (
                  <li key={illustration.share}>
                    <span>
                      {(illustration.share * 100).toFixed(0)}% of bankroll (
                      {illustration.positionSol.toFixed(4)} SOL)
                    </span>
                    <span className="mono">
                      {mode === 'quant'
                        ? `${illustration.feeBurdenPct}%`
                        : `${illustration.feeBurdenPct.toFixed(2)}%`}{' '}
                      of position cost
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <ul className="capability-list">
            {p.states.map((state) => (
              <li key={state}>
                {mode === 'quant' && <span className="mono">{state}</span>} {PORTABILITY_STATE_TEXT[state]}
              </li>
            ))}
          </ul>
          <Limitations codes={p.warningCodes} mode={mode} />
        </>
      )}
    </article>
  );
}

export function StrategyFingerprintPanel({
  fingerprint,
  bankroll,
  mode,
}: {
  fingerprint: StrategyFingerprint;
  bankroll: number | null;
  mode: string;
}) {
  const f = fingerprint;
  const portability = calculatePortability(f, bankroll);
  const scaleIn = f.twoBuyCycleCount + f.multiBuyCycleCount;
  const scaleOut = f.twoSellCycleCount + f.multiSellCycleCount;

  return (
    <article className="panel strategy-fingerprint" aria-labelledby={`fingerprint-${f.id}`}>
      <h2 id={`fingerprint-${f.id}`}>{walletName(f)} — observed strategy fingerprint</h2>
      <p className="notice warn" role="note">
        Observed behavior does not prove ownership, insider status, lifetime profitability or that the
        strategy can be copied successfully.
      </p>

      {f.eligibleCycleCount === 0 ? (
        <p className="empty-state">
          No eligible position cycles were available for this wallet, so no strategy structure can be
          described. Synchronize and reconstruct more history first.
        </p>
      ) : (
        <div className="fingerprint-grid">
          <article className="card">
            <h3>Entry structure</h3>
            <p>
              {scaleIn} of {f.eligibleCycleCount} eligible cycles used more than one buy.
            </p>
            <p>Median observed buys per cycle: {f.medianBuysPerCycle ?? unknown}.</p>
            {f.medianFirstToSecondBuySeconds !== null && (
              <p>
                Median delay between the first and second buy:{' '}
                {mode === 'quant'
                  ? `${f.medianFirstToSecondBuySeconds} seconds`
                  : durationText(f.medianFirstToSecondBuySeconds)}
                .
              </p>
            )}
            <div className="market-grid">
              <Field label="Eligible cycles" value={String(f.eligibleCycleCount)} />
              <Field label="Eligible buys" value={String(f.eligibleBuyCount)} />
              <Field label="One buy" value={String(f.singleBuyCycleCount)} />
              <Field label="Two buys" value={String(f.twoBuyCycleCount)} />
              <Field label="Three or more buys" value={String(f.multiBuyCycleCount)} />
              <Field label="Median / mean buys per cycle" value={`${f.medianBuysPerCycle ?? '—'} / ${f.meanBuysPerCycle === null ? '—' : round(f.meanBuysPerCycle)}`} />
              <Field label="P25–P75 buys per cycle" value={`${f.p25BuysPerCycle ?? '—'} – ${f.p75BuysPerCycle ?? '—'}`} />
              <Field label="Median later scale-in gap" value={time(f.medianLaterBuyGapSeconds, mode)} />
              <Field label="Median first-buy share of cycle cost" value={percent(f.medianFirstBuySharePct, mode)} title="The first buy's SOL cost divided by the total known cost of the cycle." />
              <Field label="Median largest-buy share" value={percent(f.medianLargestBuySharePct, mode)} />
              <Field label="Cycles where the largest buy was first" value={String(f.largestBuyFirstCycleCount)} />
              <Field label="Cycles where later buys were larger" value={String(f.increasingSizeCycleCount)} />
            </div>
            <p className="panel-sub">
              Multiple buys are recorded as observed scale-in behavior. The app does not treat them as proof
              of conviction.
            </p>
            <Distribution title="Buys per cycle" patterns={patternsOf(f, 'ENTRY_COUNT')} mode={mode} empty="No eligible entry sample." />
            <Distribution title="First-to-second buy delay" patterns={patternsOf(f, 'ENTRY_TIMING')} mode={mode} empty="No observed scale-in timing." />
          </article>

          <article className="card">
            <h3>Exit structure</h3>
            <p>
              {scaleOut} of {f.cyclesWithSellCount} eligible cycles with a sell had more than one sell.
            </p>
            {f.medianFirstSellInventoryPct !== null && (
              <p>
                The first known sell removed a median {round(f.medianFirstSellInventoryPct)}% of observed
                inventory.
              </p>
            )}
            <div className="market-grid">
              <Field label="Cycles with at least one sell" value={String(f.cyclesWithSellCount)} />
              <Field label="Median sells per cycle" value={f.medianSellsPerCycle ?? unknown} />
              <Field label="One sell" value={String(f.singleSellCycleCount)} />
              <Field label="Two sells" value={String(f.twoSellCycleCount)} />
              <Field label="Three or more sells" value={String(f.multiSellCycleCount)} />
              <Field label="Partial first exits" value={String(f.partialFirstExitCycleCount)} title="Cycles where the first sell removed only part of the observed inventory." />
              <Field label="Observed fully closed" value={String(f.fullyClosedCycleCount)} />
              <Field label="Observed inventory still open" value={String(f.openCycleCount)} />
              <Field label="Median first-sell share of inventory" value={percent(f.medianFirstSellInventoryPct, mode)} />
              <Field label="Median largest-sell share" value={percent(f.medianLargestSellInventoryPct, mode)} />
              <Field label="Median remainder after the first sell" value={percent(f.medianRemainingAfterFirstSellPct, mode)} title="Observed inventory left after the first sell. The app does not call this a deliberate moonbag." />
              <Field label="Median first buy → first sell" value={time(f.medianFirstBuyToFirstSellSeconds, mode)} />
              <Field label="Median last buy → first sell" value={time(f.medianLastBuyToFirstSellSeconds, mode)} />
              <Field label="Median first sell → final sell" value={time(f.medianFirstSellToFinalSellSeconds, mode)} />
              <Field label="Transfer-affected cycles" value={String(f.transferAffectedCycleCount)} />
              <Field label="Unmatched sells" value={String(f.unmatchedSellCount)} />
            </div>
            <Distribution title="Sells per cycle" patterns={patternsOf(f, 'EXIT_COUNT')} mode={mode} empty="No eligible exit sample." />
            <Distribution title="First buy to first sell" patterns={patternsOf(f, 'EXIT_TIMING')} mode={mode} empty="No observed exit timing." />
          </article>

          <article className="card">
            <h3>Holding behavior</h3>
            <p className="panel-sub">
              The distribution below is descriptive. The app does not label this wallet a scalper, a holder
              or any other trader type.
            </p>
            <Distribution title="Observed cycle duration" patterns={patternsOf(f, 'HOLDING_DURATION')} mode={mode} empty="No closed cycles were observed." />
            <div className="market-grid">
              <Field label="Observed max concurrent positions" value={String(f.observedMaxConcurrentPositions)} />
              <Field label="Median concurrent positions" value={f.medianConcurrentPositions ?? unknown} />
            </div>
          </article>

          <article className="card">
            <h3>Position sizing</h3>
            <div className="market-grid">
              <Field label="Median first buy" value={sol(f.medianFirstBuySol, mode)} />
              <Field label="Median known cycle cost" value={sol(f.medianCycleCostSol, mode)} />
              <Field label="P75 known cycle cost" value={sol(f.p75CycleCostSol, mode)} />
            </div>
            <Distribution title="Known position sizes" patterns={patternsOf(f, 'POSITION_SIZE')} mode={mode} empty="No known position sizes." />
          </article>

          <article className="card">
            <h3>Fees</h3>
            <div className="market-grid">
              <Field label="Median known fees per buy" value={sol(f.medianFeePerBuySol, mode)} />
              <Field label="Median known fees per sell" value={sol(f.medianFeePerSellSol, mode)} />
              <Field label="Median known fees per cycle" value={sol(f.medianFeePerCycleSol, mode)} />
              <Field label="Median fee burden" value={percent(f.medianFeeBurdenPct, mode)} title="Median known cycle fees divided by known cycle cost." />
              <Field label="P75 fee burden" value={percent(f.p75FeeBurdenPct, mode)} />
              <Field label="Cycles above 1% / 2%" value={`${f.feeBurdenOver1PctCount} / ${f.feeBurdenOver2PctCount}`} />
              <Field label="Cycles above 5% / 10%" value={`${f.feeBurdenOver5PctCount} / ${f.feeBurdenOver10PctCount}`} />
              <Field label="Median legs per cycle" value={f.medianLegsPerCycle ?? unknown} />
              <Field label="Fee coverage" value={percent(f.feeCoveragePct, mode)} />
              <Field label="Cycles with missing fees" value={String(f.missingFeeCycleCount)} />
            </div>
            <p className="panel-sub">
              Fees count the network fee, platform/router fee and tips. The priority fee is already inside the
              network fee and is not counted twice, and refundable token-account rent is not treated as a
              trading loss.
            </p>
            <Distribution title="Fee burden per cycle" patterns={patternsOf(f, 'FEE_BURDEN')} mode={mode} empty="No known fee evidence." />
          </article>

          <article className="card">
            <h3>Venues and routers</h3>
            <p className="panel-sub">Counts are factual and are never ranked.</p>
            <Distribution title="Execution venues" patterns={patternsOf(f, 'VENUE')} mode={mode} empty="No venue evidence." />
            <Distribution title="Routers" patterns={patternsOf(f, 'ROUTER')} mode={mode} empty="No router evidence." />
          </article>

          <article className="card">
            <h3>Repeated-token behavior</h3>
            <p>
              {f.repeatedTokenCycleCount} of {f.eligibleCycleCount} eligible cycles involved a token this
              wallet traded more than once.
            </p>
            <div className="market-grid">
              <Field label="Distinct tokens" value={String(f.distinctTokenCount)} />
              <Field label="Tokens traded more than once" value={String(f.repeatedTokenCount)} />
              <Field label="Most cycles in one token" value={String(f.maxCyclesPerToken)} />
              <Field label="Median time between cycles in the same token" value={time(f.medianSecondsBetweenTokenCycles, mode)} />
            </div>
            <p className="panel-sub">Returning to a token is not evidence that the earlier cycle succeeded.</p>
          </article>

          <PortabilityCard portability={portability} mode={mode} />

          <article className="card">
            <h3>Evidence quality</h3>
            <div className="market-grid">
              <Field label="Eligible cycles" value={String(f.eligibleCycleCount)} />
              <Field label="Excluded cycles" value={String(f.excludedCycleCount)} />
              <Field label="Eligible coverage" value={percent(f.eligibleCoveragePct, mode)} />
              <Field label="Complete history" value={f.completeHistory ? 'Yes' : 'No — partial history'} />
              <Field label="Transfer-affected cycles" value={String(f.transferAffectedCycleCount)} />
              <Field label="Unknown-basis cycles" value={String(f.unknownBasisCycleCount)} />
              <Field label="Confidence" value={f.confidence} title="Confidence describes how complete the evidence is. It does not describe profitability." />
              <Field label="Status" value={f.status} />
            </div>
            <Limitations codes={f.warningCodes} mode={mode} />
          </article>

          <article className="card">
            <h3>Strategy descriptors</h3>
            <p className="panel-sub">
              Each descriptor expands to show its formula, sample count, threshold, confidence and warnings.
            </p>
            <Descriptors evidence={f.descriptorEvidence} mode={mode} />
          </article>
        </div>
      )}

      {mode === 'quant' && (
        <details className="quant-details" open>
          <summary>Quant Mode — exact calculation record</summary>
          <div className="table-wrap">
            <table className="data-table">
              <tbody>
                <tr>
                  <th scope="row">Fingerprint ID</th>
                  <td className="mono">{f.id}</td>
                </tr>
                <tr>
                  <th scope="row">Fingerprint run ID</th>
                  <td className="mono">{f.runId}</td>
                </tr>
                <tr>
                  <th scope="row">Reconstruction run ID</th>
                  <td className="mono">{f.reconstructionRunId}</td>
                </tr>
                <tr>
                  <th scope="row">Quality metric set ID</th>
                  <td className="mono">{f.qualityMetricSetId ?? 'none'}</td>
                </tr>
                <tr>
                  <th scope="row">Calculation version</th>
                  <td className="mono">{f.calculationVersion}</td>
                </tr>
                <tr>
                  <th scope="row">Eligible / excluded cycles</th>
                  <td className="mono">
                    {f.eligibleCycleCount} / {f.excludedCycleCount}
                  </td>
                </tr>
                <tr>
                  <th scope="row">Eligible buys / sells</th>
                  <td className="mono">
                    {f.eligibleBuyCount} / {f.eligibleSellCount}
                  </td>
                </tr>
                <tr>
                  <th scope="row">Scale-in numerator / denominator</th>
                  <td className="mono">
                    {scaleIn} / {f.eligibleCycleCount}
                  </td>
                </tr>
                <tr>
                  <th scope="row">Median buys per cycle (exact)</th>
                  <td className="mono">{f.medianBuysPerCycle ?? 'null'}</td>
                </tr>
                <tr>
                  <th scope="row">Median first buy SOL (exact)</th>
                  <td className="mono">{f.medianFirstBuySol ?? 'null'}</td>
                </tr>
                <tr>
                  <th scope="row">Median cycle cost SOL (exact)</th>
                  <td className="mono">{f.medianCycleCostSol ?? 'null'}</td>
                </tr>
                <tr>
                  <th scope="row">Median fee burden % (exact)</th>
                  <td className="mono">{f.medianFeeBurdenPct ?? 'null'}</td>
                </tr>
                <tr>
                  <th scope="row">Descriptor codes</th>
                  <td className="mono">{f.descriptorCodes.join(', ') || 'none'}</td>
                </tr>
                <tr>
                  <th scope="row">Warning codes</th>
                  <td className="mono">{f.warningCodes.join(', ') || 'none'}</td>
                </tr>
                <tr>
                  <th scope="row">Confidence</th>
                  <td className="mono">{f.confidence}</td>
                </tr>
                <tr>
                  <th scope="row">Calculated at</th>
                  <td className="mono">{f.calculatedAt}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Pattern type</th>
                  <th scope="col">Value</th>
                  <th scope="col">Eligible</th>
                  <th scope="col">Total</th>
                  <th scope="col">Percentage (exact)</th>
                  <th scope="col">Median size SOL</th>
                  <th scope="col">Median duration s</th>
                  <th scope="col">Median raw result SOL</th>
                  <th scope="col">Confidence</th>
                  <th scope="col">Warnings</th>
                </tr>
              </thead>
              <tbody>
                {(f.patterns ?? []).map((pattern) => (
                  <tr key={pattern.id}>
                    <td className="mono">{pattern.patternType}</td>
                    <td>{pattern.patternValue}</td>
                    <td className="mono">{pattern.eligibleCount}</td>
                    <td className="mono">{pattern.totalCount}</td>
                    <td className="mono">{pattern.percentage ?? 'null'}</td>
                    <td className="mono">{pattern.medianSizeSol ?? 'null'}</td>
                    <td className="mono">{pattern.medianDurationSeconds ?? 'null'}</td>
                    <td className="mono">{pattern.medianRawResultSol ?? 'null'}</td>
                    <td className="mono">{pattern.confidence}</td>
                    <td className="mono">{pattern.warningCodes.join(', ') || 'none'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </article>
  );
}

/**
 * Neutral cohort comparison. Rows keep the user's own order (primary first) and
 * are never sorted by any result.
 */
export function CohortComparison({
  members,
  fingerprints,
  bankroll,
  mode,
}: {
  members: FocusCohortMember[];
  fingerprints: Record<string, StrategyFingerprint | undefined>;
  bankroll: number | null;
  mode: string;
}) {
  return (
    <section className="panel" aria-labelledby="cohort-comparison">
      <h2 id="cohort-comparison">Cohort comparison</h2>
      <p className="notice warn" role="note">
        Cohort comparison is descriptive and does not prove shared ownership or recommend following any
        wallet.
      </p>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Wallet</th>
              <th scope="col">Role</th>
              <th scope="col">Eligible cycles</th>
              <th scope="col">Median buys / cycle</th>
              <th scope="col">Median sells / cycle</th>
              <th scope="col">Median first buy</th>
              <th scope="col">Median cycle cost</th>
              <th scope="col">Median hold to first sell</th>
              <th scope="col">Median first-sell share</th>
              <th scope="col">Fee burden</th>
              <th scope="col">Venues</th>
              <th scope="col">Data completeness</th>
              <th scope="col">Median cycle cost / bankroll</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => {
              const f = fingerprints[member.trackedWalletId];
              const label = member.wallet.label ?? shortAddr(member.wallet.address);
              if (!f) {
                return (
                  <tr key={member.id}>
                    <td>{label}</td>
                    <td>{member.role === 'PRIMARY' ? 'Primary' : 'Comparison'}</td>
                    <td colSpan={11}>No strategy fingerprint has been calculated for this wallet yet.</td>
                  </tr>
                );
              }
              const venues = new Set((f.patterns ?? []).filter((p) => p.patternType === 'VENUE').map((p) => p.patternValue));
              const portability = calculatePortability(f, bankroll);
              return (
                <tr key={member.id}>
                  <td>{label}</td>
                  <td>{member.role === 'PRIMARY' ? 'Primary' : 'Comparison'}</td>
                  <td className="mono">{f.eligibleCycleCount}</td>
                  <td className="mono">{f.medianBuysPerCycle ?? '—'}</td>
                  <td className="mono">{f.medianSellsPerCycle ?? '—'}</td>
                  <td className="mono">{sol(f.medianFirstBuySol, mode)}</td>
                  <td className="mono">{sol(f.medianCycleCostSol, mode)}</td>
                  <td className="mono">{time(f.medianFirstBuyToFirstSellSeconds, mode)}</td>
                  <td className="mono">{percent(f.medianFirstSellInventoryPct, mode)}</td>
                  <td className="mono">{percent(f.medianFeeBurdenPct, mode)}</td>
                  <td className="mono">{venues.size}</td>
                  <td>{f.completeHistory ? 'Complete synchronized history' : 'Incomplete history'}</td>
                  <td className="mono">{pctNumber(portability.medianCyclePctOfBankroll)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="panel-sub">
        Rows follow the cohort’s primary wallet and then the user-defined comparison order. They are never
        ordered by profit, quality or any ranking.
      </p>
    </section>
  );
}

export { ILLUSTRATION_SHARES };
