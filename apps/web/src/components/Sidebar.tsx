import { useMode } from '../lib/mode';
import { ModeToggle } from './ModeToggle';

/**
 * Every page the app can render. Old bookmarked hash routes (`#/overview`,
 * `#/activity`, etc.) keep working regardless of the current mode — only the
 * PRIMARY navigation list shown to the user differs between Simple and Quant
 * Mode. `wallets` and `tokens` are deliberately shared between both navigation
 * sets: the same page adapts its own content to the mode (see WalletsPage,
 * TokensPage).
 */
export type PageId =
  | 'home'
  | 'wallets'
  | 'tokens'
  | 'slow-cook'
  | 'learn-wallet'
  | 'advanced'
  | 'overview'
  | 'activity'
  | 'intelligence'
  | 'focus'
  | 'help';

export interface NavItem {
  id: PageId;
  label: string;
  icon: string;
  /** Not implemented yet — shown but never navigable. */
  disabled?: boolean;
}

/** Simple Mode's beginner-oriented primary navigation. */
export const SIMPLE_NAV: NavItem[] = [
  { id: 'home', label: 'Home', icon: '⌂' },
  { id: 'wallets', label: 'Wallets', icon: '◈' },
  { id: 'tokens', label: 'Coin Check', icon: '❖' },
  { id: 'slow-cook', label: 'Slow Cook', icon: '🐢' },
  { id: 'alerts' as PageId, label: 'Alerts', icon: '🔔', disabled: true },
  { id: 'my-positions' as PageId, label: 'My Positions', icon: '◫', disabled: true },
  { id: 'advanced', label: 'Advanced', icon: '⚙' },
];

/** Quant Mode keeps every existing technical page as a primary destination. */
export const QUANT_NAV: NavItem[] = [
  { id: 'overview', label: 'Overview', icon: '◎' },
  { id: 'wallets', label: 'Wallets', icon: '◈' },
  { id: 'activity', label: 'Activity', icon: '↯' },
  { id: 'tokens', label: 'Tokens', icon: '❖' },
  { id: 'intelligence', label: 'Wallet Intelligence', icon: '⌁' },
  { id: 'focus', label: 'Focus Trader Lab', icon: '◉' },
  { id: 'slow-cook', label: 'Slow Cook', icon: '🐢' },
  { id: 'help', label: 'Help', icon: '✚' },
];

/** All page IDs valid for direct hash navigation, regardless of mode. */
export const PAGES: NavItem[] = [
  ...QUANT_NAV,
  { id: 'home', label: 'Home', icon: '⌂' },
  { id: 'learn-wallet', label: 'Learn a wallet', icon: '⌂' },
  { id: 'advanced', label: 'Advanced', icon: '⚙' },
];

export const FUTURE_FEATURES = ['Signals', 'Coin Analyzer', 'Backtesting', 'Alerts'];

interface SidebarProps {
  page: PageId;
  onNavigate: (page: PageId) => void;
}

export function Sidebar({ page, onNavigate }: SidebarProps) {
  const { mode } = useMode();
  const items = mode === 'simple' ? SIMPLE_NAV : QUANT_NAV;

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-name">Memecoin Lab</div>
        <div className="brand-sub">Solana research — historical only</div>
      </div>

      <nav aria-label="Main navigation" className="side-nav">
        {items.map((item) => (
          <button
            key={item.id}
            className={`nav-item ${page === item.id ? 'active' : ''} ${item.disabled ? 'disabled' : ''}`}
            aria-current={!item.disabled && page === item.id ? 'page' : undefined}
            disabled={item.disabled}
            aria-disabled={item.disabled ? 'true' : undefined}
            title={item.disabled ? 'Coming later' : undefined}
            onClick={() => !item.disabled && onNavigate(item.id)}
          >
            <span className="nav-icon" aria-hidden="true">
              {item.icon}
            </span>
            {item.label}
            {item.disabled && <span className="badge muted">Coming later</span>}
          </button>
        ))}
      </nav>

      {mode === 'quant' && (
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
      )}

      <div className="sidebar-footer">
        <ModeToggle />
      </div>
    </aside>
  );
}
