import { useState } from 'react';
import type { ActivityEvent } from '../api';
import type { InterfaceMode } from '../lib/mode';
import { exactAmount, formatTime, shortAddr, shortSig } from '../lib/format';
import {
  confidenceInfo,
  eventSentence,
  quoteUnverified,
  routerVenueText,
  UNKNOWN_QUOTE_TEXT,
  walletDisplayName,
} from '../lib/wording';
import { EventDetails } from './EventDetails';
import { HistoricalOutcome } from './HistoricalOutcome';

function typeClass(eventType: string): string {
  if (eventType === 'BUY') return 'good';
  if (eventType === 'SELL') return 'bad';
  return 'muted';
}

function typeLabel(eventType: string): string {
  switch (eventType) {
    case 'BUY':
      return 'Buy';
    case 'SELL':
      return 'Sell';
    case 'TOKEN_TRANSFER_IN':
      return 'Transfer in';
    case 'TOKEN_TRANSFER_OUT':
      return 'Transfer out';
    default:
      return eventType;
  }
}

interface EventListProps {
  events: ActivityEvent[];
  mode: InterfaceMode;
}

/** Simple Mode: readable activity cards. Quant Mode: full technical table. */
export function EventList({ events, mode }: EventListProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (events.length === 0) {
    return (
      <div className="empty-state">
        <p>No activity events recorded yet.</p>
        <p className="status-muted">
          Select wallets in the sync section above and fetch their history first.
        </p>
      </div>
    );
  }

  if (mode === 'simple') {
    return (
      <ol className="event-cards" aria-label="Wallet activity">
        {events.map((event) => {
          const conf = confidenceInfo(event.confidence);
          const expanded = expandedId === event.id;
          const venue = routerVenueText(event);
          return (
            <li key={event.id} className="event-card">
              <div className="event-card-top">
                <span className={`pill ${typeClass(event.eventType)}`}>
                  {typeLabel(event.eventType)}
                </span>
                <span className={`badge ${conf.tone}`} title={conf.text}>
                  <span aria-hidden="true">{conf.icon}</span> {conf.label}
                </span>
                <span className="status-muted event-time">{formatTime(event.blockTime)}</span>
              </div>
              <p className="event-sentence">{eventSentence(event)}</p>
              {quoteUnverified(event) && (
                <p className="status-warn event-warning">{UNKNOWN_QUOTE_TEXT}</p>
              )}
              <div className="event-card-meta">
                {event.token && (
                  <span>
                    Token:{' '}
                    <a
                      className="mono"
                      href={`https://solscan.io/token/${event.token.mintAddress}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {event.token.symbol ?? shortAddr(event.token.mintAddress)}
                    </a>
                  </span>
                )}
                {venue && <span>Via: {venue}</span>}
                <a
                  href={`https://solscan.io/tx/${event.signature}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View transaction ↗
                </a>
              </div>
              <button
                className="btn ghost details-toggle"
                aria-expanded={expanded}
                onClick={() => setExpandedId(expanded ? null : event.id)}
              >
                {expanded ? 'Hide details' : 'See details'}
              </button>
              {expanded && <EventDetails event={event} />}
              <HistoricalOutcome event={event} mode={mode} />
            </li>
          );
        })}
      </ol>
    );
  }

  // Quant Mode: dense technical table (all Phase 1C fields preserved).
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Time</th>
            <th scope="col">Wallet</th>
            <th scope="col">Type</th>
            <th scope="col">Token</th>
            <th scope="col" className="num">
              Amount
            </th>
            <th scope="col" className="num">
              Swap quote
            </th>
            <th scope="col" className="num">
              Wallet Δ SOL
            </th>
            <th scope="col">Router → venue</th>
            <th scope="col">Conf.</th>
            <th scope="col">Tx</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => {
            const conf = confidenceInfo(event.confidence);
            const expanded = expandedId === event.id;
            const unattributed =
              event.unattributedSol !== null && Math.abs(event.unattributedSol) > 1e-9;
            const rows = [
              <tr
                key={event.id}
                className="clickable"
                onClick={() => setExpandedId(expanded ? null : event.id)}
                title="Click for the full decoding breakdown"
              >
                <td className="status-muted">{formatTime(event.blockTime)}</td>
                <td>{walletDisplayName(event.wallet)}</td>
                <td>
                  <span className={`pill ${typeClass(event.eventType)}`}>{event.eventType}</span>
                </td>
                <td className="mono">
                  {event.token ? (
                    <a
                      href={`https://solscan.io/token/${event.token.mintAddress}`}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {event.token.symbol ?? shortAddr(event.token.mintAddress)}
                    </a>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="num">{exactAmount(event.tokenAmount)}</td>
                <td className="num">
                  {event.quoteAmount !== null ? (
                    `${exactAmount(event.quoteAmount)} ${
                      event.quoteMint === 'SOL' ? 'SOL' : (event.quoteMint ?? '')
                    }`
                  ) : quoteUnverified(event) ? (
                    <span className="status-warn">unknown</span>
                  ) : (
                    '—'
                  )}
                </td>
                <td
                  className={`num ${
                    event.walletSolChange !== null && event.walletSolChange < 0
                      ? 'status-bad'
                      : 'status-good'
                  }`}
                >
                  {event.walletSolChange !== null ? exactAmount(event.walletSolChange) : '—'}
                </td>
                <td className="status-muted">{routerVenueText(event) ?? '—'}</td>
                <td>
                  <span className={`badge ${conf.tone}`} title={conf.text}>
                    <span aria-hidden="true">{conf.icon}</span> {conf.label}
                  </span>
                  {(unattributed || event.decoderVersion < 2) && (
                    <span
                      className="status-warn"
                      title={
                        event.decoderVersion < 2
                          ? 'Legacy decoder — re-sync this wallet for exact amounts'
                          : `Unattributed SOL: ${event.unattributedSol}`
                      }
                    >
                      {' '}
                      ⚠
                    </span>
                  )}
                </td>
                <td className="mono">
                  <a
                    href={`https://solscan.io/tx/${event.signature}`}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {shortSig(event.signature)}
                  </a>
                </td>
              </tr>,
            ];
            if (expanded) {
              rows.push(
                <tr key={`${event.id}-detail`} className="detail-row">
                  <td colSpan={10}>
                    <EventDetails event={event} />
                    <HistoricalOutcome event={event} mode="quant" />
                  </td>
                </tr>,
              );
            }
            return rows;
          })}
        </tbody>
      </table>
    </div>
  );
}
