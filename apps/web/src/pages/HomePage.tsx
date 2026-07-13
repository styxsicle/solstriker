/**
 * Simple Mode — Home.
 *
 * Answers "what can I do here" within seconds: four large action cards, then
 * a small research-status summary. The large technical dashboards (RPC
 * status, candle runs, metric sets, reconstruction/fingerprint run detail)
 * intentionally stay out of Simple Mode — they remain in Quant Mode and on
 * the Overview page reachable from Advanced.
 */
import { useEffect, useState } from 'react';
import { api, type OverviewResponse } from '../api';
import { PageHeader } from '../components/PageHeader';
import type { PageId } from '../components/Sidebar';

interface ActionCardProps {
  title: string;
  description: string;
  buttonLabel?: string;
  onClick?: () => void;
  disabled?: boolean;
  disabledNote?: string;
  extraNote?: string;
}

function ActionCard({ title, description, buttonLabel, onClick, disabled, disabledNote, extraNote }: ActionCardProps) {
  return (
    <article className="card action-card">
      <h3>{title}</h3>
      <p>{description}</p>
      {extraNote && <p className="status-muted">{extraNote}</p>}
      {disabled ? (
        <>
          <button className="btn secondary" disabled aria-disabled="true">
            Coming later
          </button>
          {disabledNote && <p className="status-muted">{disabledNote}</p>}
        </>
      ) : (
        <button className="btn" onClick={onClick}>
          {buttonLabel}
        </button>
      )}
    </article>
  );
}

export function HomePage({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  const [overview, setOverview] = useState<OverviewResponse | null>(null);

  useEffect(() => {
    void api<OverviewResponse>('/api/overview')
      .then(setOverview)
      .catch(() => setOverview(null));
  }, []);

  return (
    <div>
      <PageHeader
        title="Home"
        subtitle="Historical research only. This app never connects a wallet, never signs transactions, and never trades."
      />

      <div className="cards action-cards">
        <ActionCard
          title="Learn a wallet"
          description="Download public trades and learn how a selected wallet appears to buy, add, sell, size positions, and manage trades."
          buttonLabel="Learn a wallet"
          onClick={() => onNavigate('learn-wallet')}
        />
        <ActionCard
          title="Check a coin"
          description="View currently available market information for a token discovered by tracked-wallet activity."
          buttonLabel="Check a coin"
          onClick={() => onNavigate('tokens')}
          extraNote="Full contract safety, bundle analysis, holder analysis, creator analysis, sellability checks and predictions are not implemented yet."
        />
        <ActionCard
          title="See new opportunities"
          description="Automatically discovering new trading opportunities is not implemented yet."
          disabled
          disabledNote="This app does not currently discover live opportunities."
        />
        <ActionCard
          title="View tracked wallets"
          description="Search the public wallets saved in the research database."
          buttonLabel="View wallets"
          onClick={() => onNavigate('wallets')}
        />
      </div>

      <section className="panel" aria-labelledby="home-status">
        <h2 id="home-status">Research status</h2>
        <div className="cards">
          <div className="card">
            <div className="card-label">Tracked wallets</div>
            <div className="card-value">
              {overview ? overview.wallets.total.toLocaleString() : <span className="skeleton" />}
            </div>
          </div>
          <div className="card">
            <div className="card-label">Wallets with downloaded activity</div>
            <div className="card-value">
              {overview ? overview.activity.syncedWallets.toLocaleString() : <span className="skeleton" />}
            </div>
          </div>
          <div className="card">
            <div className="card-label">Wallets with completed research</div>
            <div className="card-value">
              {overview ? overview.positions.walletsReconstructed.toLocaleString() : <span className="skeleton" />}
            </div>
          </div>
          <div className="card">
            <div className="card-label">Discovered tokens</div>
            <div className="card-value">
              {overview ? overview.tokens.total.toLocaleString() : <span className="skeleton" />}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
