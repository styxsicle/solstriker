import { ModeToggle } from './ModeToggle';

export type PageId = 'overview' | 'wallets' | 'activity' | 'tokens' | 'intelligence' | 'focus' | 'help';

export const PAGES: { id: PageId; label: string; icon: string }[] = [
  { id: 'overview', label: 'Overview', icon: '◎' },
  { id: 'wallets', label: 'Wallets', icon: '◈' },
  { id: 'activity', label: 'Activity', icon: '↯' },
  { id: 'tokens', label: 'Tokens', icon: '❖' },
  { id: 'intelligence', label: 'Wallet Intelligence', icon: '⌁' },
  { id: 'focus', label: 'Focus Trader Lab', icon: '◉' },
  { id: 'help', label: 'Help', icon: '✚' },
];

export const FUTURE_FEATURES = [
  'Signals',
  'Coin Analyzer',
  'Backtesting',
  'Alerts',
];

interface SidebarProps {
  page: PageId;
  onNavigate: (page: PageId) => void;
}

export function Sidebar({ page, onNavigate }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-name">Memecoin Lab</div>
        <div className="brand-sub">Solana research — historical only</div>
      </div>

      <nav aria-label="Main navigation" className="side-nav">
        {PAGES.map((p) => (
          <button
            key={p.id}
            className={`nav-item ${page === p.id ? 'active' : ''}`}
            aria-current={page === p.id ? 'page' : undefined}
            onClick={() => onNavigate(p.id)}
          >
            <span className="nav-icon" aria-hidden="true">
              {p.icon}
            </span>
            {p.label}
          </button>
        ))}
      </nav>

      <div className="side-section" aria-label="Planned features (not implemented)">
        <div className="side-section-title">Coming later</div>
        {FUTURE_FEATURES.map((name) => (
          <button
            key={name}
            className="nav-item disabled"
            disabled
            aria-disabled="true"
            title="Not implemented yet"
          >
            <span className="nav-icon" aria-hidden="true">
              ·
            </span>
            {name}
            <span className="badge muted">not built</span>
          </button>
        ))}
      </div>

      <div className="sidebar-footer">
        <ModeToggle />
      </div>
    </aside>
  );
}
