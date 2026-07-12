import { PageHeader } from '../components/PageHeader';

interface Term {
  term: string;
  definition: string;
}

const GLOSSARY: { group: string; terms: Term[] }[] = [
  {
    group: 'Wallets and keys',
    terms: [
      {
        term: 'Public wallet address',
        definition:
          'A Solana account identifier that anyone can look up, like an account number. Everything this app researches uses only public addresses.',
      },
      {
        term: 'Private key',
        definition:
          'The secret that controls a wallet and can spend its funds. This app never asks for one and has nowhere to enter one.',
      },
      {
        term: 'Seed phrase',
        definition:
          'A list of words that can recreate a private key. Never enter a seed phrase into this app or share it with anyone.',
      },
    ],
  },
  {
    group: 'Tokens',
    terms: [
      {
        term: 'Token',
        definition:
          'A digital asset on Solana. Memecoins are tokens, usually with no intrinsic utility.',
      },
      {
        term: 'Mint address / contract address',
        definition:
          "A token's unique public identifier on Solana. Two tokens can share a name, but never a mint address.",
      },
      {
        term: 'SOL',
        definition:
          'The native currency of the Solana blockchain, used to pay for trades and network fees.',
      },
    ],
  },
  {
    group: 'Trades and transfers',
    terms: [
      {
        term: 'Buy',
        definition: 'A wallet exchanged SOL (or a stablecoin) for a token.',
      },
      {
        term: 'Sell',
        definition: 'A wallet exchanged a token back into SOL (or a stablecoin).',
      },
      {
        term: 'Transfer',
        definition:
          'Tokens moved between wallets without a visible payment. It may be an airdrop, a move between own wallets, or something else — not necessarily a trade.',
      },
      {
        term: 'Swap',
        definition:
          'The on-chain exchange of one asset for another, executed by a trading program.',
      },
      {
        term: 'Quote amount',
        definition:
          'The exact amount of SOL or stablecoin on the other side of a swap — what was actually paid or received for the token, excluding fees.',
      },
      {
        term: 'Total wallet SOL change',
        definition:
          'How much the wallet balance actually changed in a transaction, including fees, tips, and rent — usually different from the swap amount itself.',
      },
    ],
  },
  {
    group: 'Fees',
    terms: [
      {
        term: 'Network fee',
        definition: 'The small SOL fee every Solana transaction pays to the network.',
      },
      {
        term: 'Priority fee',
        definition:
          'Extra SOL paid on top of the base fee to get a transaction processed faster.',
      },
      {
        term: 'Router',
        definition:
          'The app or aggregator a trader used to place the trade (for example a trading bot or trading terminal). Routers often charge their own fee.',
      },
      {
        term: 'Execution venue',
        definition:
          'The actual exchange program where the swap happened, such as Pump.fun or Raydium — which may differ from the router that sent it there.',
      },
      {
        term: 'Token-account rent',
        definition:
          'A small refundable SOL deposit Solana requires to hold a new token in a wallet for the first time.',
      },
    ],
  },
  {
    group: 'Venues',
    terms: [
      {
        term: 'Pump.fun',
        definition:
          'A popular launchpad where new memecoins start trading on a bonding curve.',
      },
      {
        term: 'Pump AMM',
        definition:
          "Pump.fun's own exchange where tokens continue trading after their bonding-curve phase.",
      },
      {
        term: 'Jupiter',
        definition:
          'A swap aggregator that routes trades across many Solana exchanges for the best price.',
      },
      {
        term: 'Raydium',
        definition: 'One of the largest Solana exchanges (an automated market maker).',
      },
    ],
  },
  {
    group: 'How this app works',
    terms: [
      {
        term: 'Confidence',
        definition:
          'How certain the decoder is about an event. Confirmed: the transaction data clearly supports the result. Likely: strong evidence, but some details could not be proven. Unknown: the activity was preserved without guessing.',
      },
      {
        term: 'Historical synchronization',
        definition:
          'Downloading past transactions of a wallet, on demand. Nothing is watched live.',
      },
      {
        term: 'Backfill',
        definition:
          "Working backwards through a wallet's older history. Large histories are fetched in chunks — 'partial' means there is more history to fetch.",
      },
      {
        term: 'Sync',
        definition: 'Fetch newer activity or continue downloading older history.',
      },
      {
        term: 'Re-sync',
        definition:
          "Delete and re-download only one wallet's stored activity so it can be decoded again using the latest decoder. The wallet record itself is kept.",
      },
      {
        term: 'Decoder version',
        definition:
          'Which version of the app interpreted a stored event. Older versions were less exact; re-syncing upgrades old events.',
      },
      {
        term: 'RPC',
        definition:
          'The connection service used to read data from the Solana blockchain (this app uses Helius, configured on the backend only).',
      },
      {
        term: 'Solana slot',
        definition:
          "The blockchain's internal counter of block positions — a quick way to see the chain is advancing.",
      },
    ],
  },
];

export function HelpPage() {
  return (
    <div>
      <PageHeader
        title="Help"
        subtitle="Plain-language explanations of every term used in this app."
      />

      <section className="panel" aria-labelledby="help-safety">
        <h2 id="help-safety">Privacy and safety</h2>
        <ul className="capability-list">
          <li>
            <span className="status-good" aria-hidden="true">✔</span> Only public wallet addresses
            are researched.
          </li>
          <li>
            <span className="status-bad" aria-hidden="true">✖</span> Private keys and seed phrases
            must never be entered — the app has no field for them, anywhere.
          </li>
          <li>
            <span className="status-good" aria-hidden="true">✔</span> The current app cannot sign
            or submit transactions.
          </li>
          <li>
            <span className="status-good" aria-hidden="true">✔</span> The Helius access key stays
            on the backend and is never sent to this page.
          </li>
          <li>
            <span className="status-warn" aria-hidden="true">!</span> Data shown may be incomplete
            or uncertain — the app labels uncertainty instead of hiding it.
          </li>
        </ul>
      </section>

      {GLOSSARY.map((section) => (
        <section key={section.group} className="panel" aria-label={section.group}>
          <h2>{section.group}</h2>
          <dl className="glossary">
            {section.terms.map((t) => (
              <div key={t.term}>
                <dt>{t.term}</dt>
                <dd>{t.definition}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
