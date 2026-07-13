import { useEffect, useState } from 'react';
import { ModeProvider, useMode } from './lib/mode';
import { PAGES, QUANT_NAV, SIMPLE_NAV, Sidebar, type PageId } from './components/Sidebar';
import { ModeToggle } from './components/ModeToggle';
import { HomePage } from './pages/HomePage';
import { LearnWalletPage } from './pages/LearnWalletPage';
import { AdvancedPage } from './pages/AdvancedPage';
import { OverviewPage } from './pages/OverviewPage';
import { WalletsPage } from './pages/WalletsPage';
import { ActivityPage } from './pages/ActivityPage';
import { TokensPage } from './pages/TokensPage';
import { HelpPage } from './pages/HelpPage';
import { WalletIntelligencePage } from './pages/WalletIntelligencePage';
import { FocusTraderLabPage } from './pages/FocusTraderLabPage';

function pageFromHash(fallback: PageId): PageId {
  const hash = window.location.hash.replace(/^#\/?/, '');
  return (PAGES.some((p) => p.id === hash) ? hash : fallback) as PageId;
}

export function App() {
  return (
    <ModeProvider>
      <Shell />
    </ModeProvider>
  );
}

function Shell() {
  const { mode } = useMode();
  // No (or an unrecognized) hash lands on the mode-appropriate default:
  // Simple Mode opens on Home, Quant Mode keeps opening on Overview.
  const defaultPage: PageId = mode === 'simple' ? 'home' : 'overview';
  const [page, setPage] = useState<PageId>(() => pageFromHash(defaultPage));

  useEffect(() => {
    const onHash = () => setPage(pageFromHash(defaultPage));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
    // `defaultPage` intentionally only matters for the initial render's
    // blank-hash case, so it is not a dependency of this effect.
  }, []);

  const navigate = (next: PageId) => {
    window.location.hash = `/${next}`;
    setPage(next);
  };

  const navItems = mode === 'simple' ? SIMPLE_NAV : QUANT_NAV;

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
            {navItems.map((item) => (
              <button
                key={item.id}
                className={`nav-item ${page === item.id ? 'active' : ''} ${item.disabled ? 'disabled' : ''}`}
                aria-current={!item.disabled && page === item.id ? 'page' : undefined}
                disabled={item.disabled}
                aria-disabled={item.disabled ? 'true' : undefined}
                onClick={() => !item.disabled && navigate(item.id)}
              >
                {item.label}
                {item.disabled && <span className="badge muted">Coming later</span>}
              </button>
            ))}
          </nav>
        </div>

        <main className="content-inner">
          {page === 'home' && <HomePage onNavigate={navigate} />}
          {page === 'learn-wallet' && <LearnWalletPage onNavigate={navigate} />}
          {page === 'advanced' && <AdvancedPage onNavigate={navigate} />}
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
