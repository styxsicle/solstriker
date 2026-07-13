/**
 * Simple Mode — Advanced.
 *
 * A plain directory to the existing detailed pages. No page is removed —
 * Advanced only relocates the entry point out of Simple Mode's primary
 * navigation, since these pages show full technical detail that a beginner
 * does not need within the first few seconds.
 */
import { PageHeader } from '../components/PageHeader';
import type { PageId } from '../components/Sidebar';

interface AdvancedLink {
  page: PageId;
  title: string;
  description: string;
}

const LINKS: AdvancedLink[] = [
  {
    page: 'activity',
    title: 'Activity',
    description: 'Public trade history — download and read a wallet’s historical buys, sells and transfers.',
  },
  {
    page: 'intelligence',
    title: 'Wallet Intelligence',
    description: 'Detailed wallet results — FIFO position reconstruction and observed quality evidence.',
  },
  {
    page: 'focus',
    title: 'Focus Trader Lab',
    description: 'Focus-wallet comparisons — how a selected wallet appears to enter, size and exit positions, compared side by side with other wallets you choose.',
  },
  {
    page: 'slow-cook',
    title: 'Slow Cook',
    description: 'Patient, high-conviction setups from selected wallets — evidence-backed research, never a trading signal.',
  },
  {
    page: 'fomo-simulator',
    title: 'FOMO Simulator',
    description: 'Test Solstriker’s Slow Cook calls with paper money and see exactly what would have happened. No real trades.',
  },
  {
    page: 'overview',
    title: 'Overview',
    description: 'Technical system status — application, database, Solana connection and every research-database count.',
  },
  {
    page: 'help',
    title: 'Help',
    description: 'Help and definitions — plain-language explanations of every term used in this app.',
  },
];

export function AdvancedPage({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  return (
    <div>
      <PageHeader
        title="Advanced"
        subtitle="Full technical detail behind the simplified pages. Nothing here is hidden — it is just not shown first."
      />
      <div className="cards action-cards">
        {LINKS.map((link) => (
          <article className="card action-card" key={link.page}>
            <h3>{link.title}</h3>
            <p>{link.description}</p>
            <button className="btn secondary" onClick={() => onNavigate(link.page)}>
              Open {link.title}
            </button>
          </article>
        ))}
      </div>
    </div>
  );
}
