import type { ActivityEvent } from '../api';
import { exactAmount, shortAddr, solAmount } from '../lib/format';
import { confidenceInfo } from '../lib/wording';

function Row({ label, value, warn }: { label: string; value: React.ReactNode; warn?: boolean }) {
  return (
    <div className="kv-row">
      <dt>{label}</dt>
      <dd className={warn ? 'status-warn' : undefined}>{value}</dd>
    </div>
  );
}

const NOT_AVAILABLE = <span className="status-muted">not available</span>;

function sol(value: number | null): React.ReactNode {
  return value === null ? NOT_AVAILABLE : solAmount(value);
}

/**
 * Full decoding breakdown for one event. Shown in both modes — Simple Mode
 * users open it via “See details”. Only real stored fields; unknowns are
 * labeled, never guessed.
 */
export function EventDetails({ event }: { event: ActivityEvent }) {
  const conf = confidenceInfo(event.confidence);
  const swapIn =
    event.swapInAmount !== null
      ? `${exactAmount(event.swapInAmount)} ${
          event.swapInMint === 'SOL' ? 'SOL' : shortAddr(event.swapInMint ?? '')
        }`
      : null;
  const swapOut =
    event.swapOutAmount !== null
      ? `${exactAmount(event.swapOutAmount)} ${
          event.swapOutMint === 'SOL' ? 'SOL' : shortAddr(event.swapOutMint ?? '')
        }`
      : null;
  const unattributed =
    event.unattributedSol !== null && Math.abs(event.unattributedSol) > 1e-9;

  return (
    <div className="event-details">
      {event.decoderVersion < 2 && (
        <p className="notice warn" role="note">
          ⚠ This event was stored by an older decoder version and may include fees in its
          amounts. Re-sync this wallet to decode it again exactly.
        </p>
      )}
      {event.explanation && <p className="event-explanation">{event.explanation}</p>}

      <dl className="kv">
        <Row label="Exact token amount" value={exactAmount(event.tokenAmount)} />
        <Row label="Swap input" value={swapIn ?? NOT_AVAILABLE} />
        <Row label="Swap output" value={swapOut ?? NOT_AVAILABLE} />
        <Row label="Total wallet SOL change" value={sol(event.walletSolChange)} />
        <Row label="Network fee" value={sol(event.networkFeeSol)} />
        <Row label="Priority fee" value={sol(event.priorityFeeSol)} />
        <Row label="Platform / router fees" value={sol(event.platformFeeSol)} />
        <Row label="Tips" value={sol(event.tipSol)} />
        <Row label="Token-account rent" value={sol(event.rentSol)} />
        <Row
          label="Unrelated transfers"
          value={
            event.unrelatedSolIn === null && event.unrelatedSolOut === null
              ? NOT_AVAILABLE
              : `in ${solAmount(event.unrelatedSolIn ?? 0)} / out ${solAmount(event.unrelatedSolOut ?? 0)}`
          }
        />
        <Row
          label="Unattributed SOL"
          warn={unattributed}
          value={
            event.unattributedSol === null ? (
              NOT_AVAILABLE
            ) : unattributed ? (
              <>
                {solAmount(event.unattributedSol)} — this part of the balance change could not be
                explained
              </>
            ) : (
              solAmount(event.unattributedSol)
            )
          }
        />
        <Row label="Router / application" value={event.source ?? NOT_AVAILABLE} />
        <Row label="Execution venue" value={event.venue ?? NOT_AVAILABLE} />
        <Row
          label="Confidence"
          value={
            <>
              <span aria-hidden="true">{conf.icon}</span> {conf.label} — {conf.text}
            </>
          }
        />
        <Row label="Decoder version" value={`v${event.decoderVersion}`} />
        <Row
          label="Transaction"
          value={
            <a
              className="mono"
              href={`https://solscan.io/tx/${event.signature}`}
              target="_blank"
              rel="noreferrer"
            >
              {event.signature.slice(0, 16)}… (open in explorer)
            </a>
          }
        />
      </dl>
    </div>
  );
}
