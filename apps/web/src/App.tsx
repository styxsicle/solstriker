import { useState } from 'react';
import { StatusPage } from './pages/StatusPage';
import { WalletsPage } from './pages/WalletsPage';
import { TokensPage } from './pages/TokensPage';
import { ActivityPage } from './pages/ActivityPage';

type Tab = 'status' | 'wallets' | 'tokens' | 'activity';

export function App() {
  const [tab, setTab] = useState<Tab>('status');

  return (
    <div className="app">
      <header className="app-header">
        <h1>Memecoin Lab</h1>
        <span className="phase">Phase 1A — research &amp; paper-trading foundation (local only)</span>
      </header>

      <nav className="tabs">
        <button className={tab === 'status' ? 'active' : ''} onClick={() => setTab('status')}>
          System status
        </button>
        <button className={tab === 'wallets' ? 'active' : ''} onClick={() => setTab('wallets')}>
          Tracked wallets
        </button>
        <button className={tab === 'tokens' ? 'active' : ''} onClick={() => setTab('tokens')}>
          Tokens
        </button>
        <button className={tab === 'activity' ? 'active' : ''} onClick={() => setTab('activity')}>
          Activity
        </button>
      </nav>

      {tab === 'status' && <StatusPage />}
      {tab === 'wallets' && <WalletsPage />}
      {tab === 'tokens' && <TokensPage />}
      {tab === 'activity' && <ActivityPage />}

      <p className="footer-note">
        Read-only research tooling. This app never asks for private keys or seed phrases and never
        signs transactions.
      </p>
    </div>
  );
}
