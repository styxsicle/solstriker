import { useEffect, useState } from 'react';
import { ModeProvider } from './lib/mode';
import { PAGES, Sidebar, type PageId } from './components/Sidebar';
import { ModeToggle } from './components/ModeToggle';
import { OverviewPage } from './pages/OverviewPage';
import { WalletsPage } from './pages/WalletsPage';
import { ActivityPage } from './pages/ActivityPage';
import { TokensPage } from './pages/TokensPage';
import { HelpPage } from './pages/HelpPage';
import { WalletIntelligencePage } from './pages/WalletIntelligencePage';
import { FocusTraderLabPage } from './pages/FocusTraderLabPage';

function pageFromHash(): PageId {
  const hash = window.location.hash.replace(/^#\/?/, '');
  return (PAGES.some((p) => p.id === hash) ? hash : 'overview') as PageId;
}

export function App() {
  return (
    <ModeProvider>
      <Shell />
    </ModeProvider>
  );
}

function Shell() {
  const [page, setPage] = useState<PageId>(() => pageFromHash());

  useEffect(() => {
    const onHash = () => setPage(pageFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const navigate = (next: PageId) => {
    window.location.hash = `/${next}`;
    setPage(next);
  };

  return (
    <div className="layout">
      <Sidebar page={page} onNavigate={navigate} />

      <div className="content">
        <div className="topbar">
          <div className="topbar-row">
            <span className="brand-name">Memecoin Lab</span>
            <ModeToggle />
          </div>
          <nav className="top-nav" aria-label="Main navigation">
            {PAGES.map((p) => (
              <button
                key={p.id}
                className={`nav-item ${page === p.id ? 'active' : ''}`}
                aria-current={page === p.id ? 'page' : undefined}
                onClick={() => navigate(p.id)}
              >
                {p.label}
              </button>
            ))}
          </nav>
        </div>

        <main className="content-inner">
          {page === 'overview' && <OverviewPage />}
          {page === 'wallets' && <WalletsPage />}
          {page === 'activity' && <ActivityPage />}
          {page === 'tokens' && <TokensPage />}
          {page === 'intelligence' && <WalletIntelligencePage />}
          {page === 'focus' && <FocusTraderLabPage />}
          {page === 'help' && <HelpPage />}

          <p className="footer-note">
            Historical research only. This app never asks for private keys or seed phrases, never
            signs transactions, and never trades.
          </p>
        </main>
      </div>
    </div>
  );
}
