# Memecoin Lab

A **local** Solana memecoin research and paper-trading application, built in small
checkpoints. Current checkpoint: **Phase 2B — wallet quality evidence**
(1A: foundation + wallet import; 1B: historical activity ingestion;
1C: reliable swap decoding; 1D-A: beginner-friendly UI shell).

This tool is read-only research software. It **never** asks for private keys or seed
phrases, never signs transactions, and never places real trades.

## Requirements

- Node.js ≥ 20
- npm ≥ 10

## Setup

```bash
cp .env.example .env       # add your HELIUS_API_KEY (optional — app runs without it)
npm install
npm run db:generate
npm run db:migrate
npm run dev                # API on :3001, dashboard on :5173
```

Other commands (all from the repository root):

```bash
npm run test               # vitest across all workspaces
npm run lint               # eslint
npm run build              # production build of shared, api, and web
```

## Environment variables

| Variable            | Purpose                                            | Exposed to frontend? |
| ------------------- | -------------------------------------------------- | -------------------- |
| `HELIUS_API_KEY`    | Helius RPC key. Backend only.                      | **Never**            |
| `SOLANA_CLUSTER`    | `mainnet-beta` or `devnet`                         | No                   |
| `DATABASE_URL`      | SQLite file (relative paths resolve to `prisma/`)  | No                   |
| `API_PORT`          | Backend port (default 3001)                        | No                   |
| `WEB_ORIGIN`        | Allowed CORS origin for the dashboard              | No                   |
| `VITE_API_BASE_URL` | API base URL used by the dashboard (no secrets)    | Yes                  |
| `MARKET_DATA_PROVIDER` | Current snapshots: `dexscreener` or `none`    | No                   |
| `HISTORICAL_MARKET_PROVIDER` | OHLCV: `geckoterminal` or `none`       | No                   |

The RPC URL and key never leave the backend. `/api/rpc/status` returns only sanitized
fields (`configured`, `healthy`, `slot`, `latencyMs`); RPC failures are reduced to a
generic `rpc_error` code so error messages cannot leak the URL.

## Structure

```text
apps/api          Fastify + Prisma + Zod backend
apps/web          React + Vite dark dashboard
packages/shared   Address validation (base58) + wallet-import parsers
prisma            Prisma schema, migrations, local SQLite databases
```

## Importing tracked wallets

The dashboard (Tracked wallets → Import wallets) accepts:

1. **CSV** — optional header, recognized columns `address,label,group,notes`
   (all except `address` optional). Headerless files are read positionally.
2. **Plain text** — one address per line; blank lines and `#` comments are skipped.
3. **JSON wallet-tracker export** — an array of records like:

   ```json
   {
     "trackedWalletAddress": "So1anaPub1icKeyExampleXXXXXXXXXXXXXXXXXXXXX",
     "name": "wallet label",
     "emoji": "🦊",
     "alertsOnToast": false,
     "alertsOnBubble": true,
     "alertsOnFeed": true,
     "groups": ["Main"],
     "sound": "default"
   }
   ```

   The format is auto-detected even when the file has a `.txt` extension.
   `name` → label, `groups` → the wallet's full group list (multi-group supported),
   `emoji` is preserved, and alert preferences + sound are stored as imported metadata.
4. **Manual entry** — a single address with optional label/group/notes.

Every address is validated (base58, decodes to 32 bytes). Duplicates — inside the
file or already in the database — are never re-created, so re-importing the same
file is safe. The result summary shows imported / duplicates / invalid / skipped.

**Privacy:** wallet export files are private user data. Keep them outside the repo
(or in `imports/`, which is gitignored). They are imported through the dashboard at
runtime and are never committed, hardcoded, or used in tests.

## Interface (Phase 1D-A)

The dashboard has a sidebar shell (Overview / Wallets / Activity / Tokens / Help,
plus clearly disabled "Coming later" entries) with two persistent view modes:

- **Simple Mode** (default) — the same real data explained in ordinary language:
  activity as sentences ("mr phoof bought 15.6M tokens for 1.5107 SOL."),
  confidence spelled out in words, unknown amounts stated as
  "Exact SOL amount could not be verified." rather than hidden.
- **Quant Mode** — full technical detail: exact decimals, decoder versions, fee
  attribution, router/venue fields, dense tables.

The mode is saved in localStorage and switching never reloads the page. A Help
page defines every term used, and synthetic development records (wallets/tokens
from `POST /api/dev/seed`) are hidden by default with a reveal toggle.

## Beginner UX Simplification Pass

Simple Mode's navigation and top-level pages were rebuilt around four
questions — *what happened, why it matters, how trustworthy is the evidence,
what to inspect next* — without touching any backend calculation, migration,
or existing Quant Mode functionality.

**Navigation.** Simple Mode's primary nav is now **Home · Wallets · Coin
Check · Alerts · My Positions · Advanced**. Alerts and My Positions are not
implemented — they render as disabled buttons carrying a visible "Coming
later" badge, exactly like the pre-existing Quant Mode "Coming later" section;
neither has a backend route, and clicking them never navigates anywhere.
Quant Mode keeps its original primary nav (**Overview · Wallets · Activity ·
Tokens · Wallet Intelligence · Focus Trader Lab · Help**) completely
unchanged. `wallets` and `tokens` are the same underlying page and route in
both modes — each page adapts its own presentation via the existing
`useMode()` hook, the way `WalletsPage` and `TokensPage` already did. Every
pre-existing hash route (`#/overview`, `#/activity`, `#/intelligence`,
`#/focus`, `#/help`, `#/wallets`, `#/tokens`) still renders its page directly
regardless of mode, so old bookmarks never silently break; only the
*default*, blank-hash landing page differs by mode (Home for Simple, Overview
for Quant). The Simple/Quant toggle remains a `localStorage`-persisted,
no-reload switch, unchanged.

**Home** (`pages/HomePage.tsx`) replaces Simple Mode's old Overview dashboard
with four large action cards — Learn a wallet, Check a coin, See new
opportunities (disabled, "Coming later" — this app does not discover live
opportunities), View tracked wallets — followed by a small four-number
research-status summary (tracked wallets, wallets with downloaded activity,
wallets with completed research, discovered tokens) pulled from the existing
`GET /api/overview`. The large technical dashboards (RPC status, candle runs,
metric sets, reconstruction/fingerprint run detail) stay exactly where they
were: on the Overview page, reachable from Quant Mode's nav or from Advanced.

**Advanced** (`pages/AdvancedPage.tsx`) is a plain directory to the five
existing detailed pages (Activity, Wallet Intelligence, Focus Trader Lab,
Overview, Help) with one-line descriptions. No page was removed or
duplicated — Advanced only relocates the entry point.

**Learn a wallet** (`pages/LearnWalletPage.tsx`) is the beginner-facing
one-click wallet preparation flow: search a wallet or paste an address → one
"Learn this wallet" button → the existing confirmation modal → the exact same
`POST /api/focus-wallets/prepare` endpoint and services from the one-click
preparation feature (nothing about the pipeline is duplicated). Advanced
options (transaction limit, default 500; "Continue older history"; "Refresh
completed analysis") sit collapsed under an "Advanced preparation options"
disclosure with their existing defaults and backend behavior unchanged. The
four pipeline stages are relabeled for beginners only in this flow — Sync →
"Download public trades", Reconstruction → "Organize buys and sells", Quality
analysis → "Check past results", Strategy fingerprint → "Learn trading
style" (`lib/prepareWording.ts`, `learnWalletSummary`) — and the completion
screen is a plain-language narrative ("what happened", "inspect next"),
never exposing run IDs, metric-set IDs, calculation versions or raw warning
codes. Quant Mode's `PrepareWalletPanel` (now reachable via Focus Trader Lab
→ Advanced) keeps every existing technical stage label, ID and warning code
untouched.

**Server-side wallet search.** `WalletIntelligencePage`, `FocusTraderLabPage`'s
cohort picker, and `PrepareWalletPanel` used to fetch one fixed page of
wallets (`?pageSize=50` / `?pageSize=200`) and filter it in the browser —
silently hiding any wallet outside that page, including exact-address
matches. All three now use a shared hook, `hooks/useWalletSearch.ts`, that
always queries the backend's existing `search` parameter. The hook also
caches every wallet object it has ever returned, so a selected wallet keeps
showing its correct label and address even after the search query changes or
is cleared — selection state itself stays owned by each page (primary vs.
comparison roles, single- vs. multi-select differ per page). A shared
`components/WalletLabel.tsx` renders label + shortened address consistently
everywhere, so wallets that share the exact same label stay visually
distinguishable by address.

**BN wallet safety.** Several tracked wallets share the exact label `bn`.
`bn trezor` (`HBYkoojFkFX7NWuF2VcpDWNXEdGatfNE6mYLsR2udSzo`) is a known,
specifically-labeled wallet — it is **not** "BN Main". No code anywhere
promotes any `bn`-labeled wallet to a primary/main role, pre-selects one
because its label matched a search, or claims common ownership between
similarly labeled wallets; the exact BN Main address remains unconfirmed and
is never guessed at. This is enforced by `test/bnSafety.test.tsx`.

**Wallets page.** Simple Mode leads with search and a plain-language card
list (label + address + "Available for research" / "Not included in
research" + one toggle action). Bulk import, source metadata, development
records, raw group fields and import-format detail move under an "Advanced
wallet management" disclosure — nothing was removed, and "Add one wallet"
stays directly visible. Quant Mode keeps its original full table unchanged.

**Coin Check** (the Simple Mode `TokensPage` title) leads with a client-side
search over name/symbol/mint (the backend already returns every discovered
token in one unpaginated response, so this is a real search, not the
first-page bug pattern the wallet pickers had). It shows six fields first —
price, market cap, liquidity, 24h volume, 24h price change, freshness — with
provider identity, pair-selection detail, exact timestamps and FDV moved into
a per-token "More details" disclosure. Snapshot and candle collection stay
available but move under an "Advanced token research options" disclosure,
not the first thing shown. The page states prominently and unconditionally:
**"Full token safety checks are not built yet"** — contract safety, bundle
analysis, holder analysis, creator-history analysis, sellability checks and
price predictions are all explicitly not implemented. Quant Mode is
unchanged.

No backend calculation, financial value, FIFO/quality/fingerprint logic, or
database schema changed in this pass — it is a frontend-only restructuring,
and no new migration was created.

## Wallet activity sync (Phase 1B)

The **Activity** tab syncs historical transaction activity for manually selected
wallets — deliberately conservative with 1,000+ wallets tracked:

- Max **10 wallets per sync request** (start with 1–5); bulk sync is not supported.
- Max 500 transactions per wallet per request (default 200). Large histories are
  backfilled incrementally: run sync again to continue from the stored cursor
  ("partial — sync again to continue").
- Once backfill completes, later syncs only fetch new transactions.
- Transactions are normalized into `BUY` / `SELL` / `TOKEN_TRANSFER_IN` /
  `TOKEN_TRANSFER_OUT` events per token; SOL/wSOL/USDC/USDT are treated as quote
  currencies. Re-syncing is idempotent (events are deduplicated).
- Tokens seen in activity are added to the token database automatically
  (`source: activity`); names/symbols are enriched in a later phase.

### Reliable swap decoding (Phase 1C)

Swap amounts are **exact swap legs, never wallet-balance totals**. Fees, tips,
token-account rent, and unrelated transfers are separated from the swap itself:

- Decoding paths: provider-decoded swap events; venue-instruction
  reconstruction (Pump.fun, Pump AMM, Raydium, Meteora — handles
  router-mediated trades such as Axiom → Pump.fun, including sell proceeds
  credited directly by the program); and a heuristic fallback that **never
  invents quotes** — if the exact amount can't be established, the quote is
  shown as *unknown* and the unexplained flow is recorded as *unattributed*.
- Every event carries a confidence level (`CONFIRMED` / `LIKELY` / `UNKNOWN`),
  a human-readable explanation, the router/originating app and the actual
  execution venue, plus a full SOL breakdown (total wallet change, network +
  priority fee, platform/router fees, tips, rent, unrelated, unattributed) —
  click any event row on the Activity page to expand it.
- Events stored by the older decoder are marked (⚠ v1). Raw transaction
  payloads are not stored locally, so they can't be re-decoded in place — use
  the per-wallet **Re-sync** button (or `POST /api/activity/resync`) to clear
  just that wallet's events and re-fetch with the current decoder.

Requires `HELIUS_API_KEY` in `.env`. All provider calls happen on the backend;
errors are reduced to sanitized codes (`rate_limited`, `provider_error`, …) so the
key and RPC URLs can never leak. This is read-only ingestion — no signing, no trades.

## Token market snapshots (Phase 1D-B1)

The Tokens page can collect a **current market snapshot** for a small selection of
discovered tokens. Snapshots are collected **manually** — there is no polling,
scheduling, or refresh-on-load.

- **Provider:** [DexScreener](https://docs.dexscreener.com/api/reference) via its
  public `tokens/v1` endpoint. **No API key is required** for the selected
  endpoint (documented rate limit 300 requests/minute). Set
  `MARKET_DATA_PROVIDER=dexscreener` (default) or `none` to disable. The app boots
  and all tests pass with no provider configured.
- **Limits:** up to **20 tokens per refresh** (start with **1–5**). There is no
  "refresh all". Development tokens are excluded unless `includeDev` is explicitly
  requested (never in production).
- **Fields collected when reported:** USD price, SOL price (only when the selected
  pair is SOL-quoted), market cap, FDV (kept strictly separate from market cap),
  liquidity, 5m/1h/6h/24h volume, buy/sell counts, price changes, selected DEX and
  pair address, base/quote mint, provider, observation/fetch time.
- **Pair selection** is deterministic: only Solana pairs that contain the token,
  ranked by USD liquidity → recent volume → recency → quote preference (SOL, then
  USDC/USDT) → pair address. One snapshot always represents a single pair — data
  is never combined across pools.
- **Unknown values stay null**, never zero. When the provider does not report a
  field, Simple Mode says "Not reported by the selected provider."; when no
  snapshot exists it says "Market data has not been collected for this token yet."
- **Freshness** (`FRESH` ≤5 min, `AGING` ≤60 min, `STALE` >60 min,
  `NEVER_FETCHED`, `UNKNOWN`) is computed from the observation time. Manually
  collected data is described as a "current snapshot", never "live".

**Simple Mode** shows humanized values with plain-language explanations of market
cap, FDV, liquidity, volume, price change, and freshness. **Quant Mode** shows the
exact stored decimal strings plus pair address, base/quote mint, snapshot status,
confidence, selection reason, observed/fetched times, and age.

This is historical/point-in-time research data only. The app produces **no
predictions, scores, safety ratings, or buy/sell recommendations**.

## Historical candles and entry outcomes (Phase 1D-B2)

The Tokens page can manually backfill OHLCV for **1–5 explicitly selected
non-development tokens** (start with 1–2). Historical identity is the exact
Solana pair selected by the token's latest usable current-market snapshot; pools
are never combined or silently switched. Supported stored intervals are `1m`,
`5m`, `15m`, and `1h`. Requests are date-bounded, paginated to at most 10 ×
1,000 provider rows per token, retried only for transient failures, and isolated
per token. There is no startup job, polling, backfill-all, interpolation, or
forward-fill. Re-fetches upsert corrected candles and the database uniqueness
rule prevents duplicates. Missing trading intervals remain explicit gaps.

The provider is GeckoTerminal's keyless public API at
`api.geckoterminal.com/api/v2`, using the Solana pool-address OHLCV endpoint.
No authentication is required. Official [keyless API documentation](https://docs.coingecko.com/docs/keyless-public-api)
and [pool OHLCV reference](https://docs.coingecko.com/reference/pool-ohlcv-contract-address)
were consulted on **2026-07-12**. The public rate limit is dynamic IP-based
throttling (handle `429` with backoff), not a guaranteed fixed request rate.
Each response is limited to 1,000 candles; provider availability starts when a
pool began being tracked, and empty responses/gaps are possible. The app's own
interval range caps are 3 days (`1m`), 14 days (`5m`), 30 days (`15m`), and
180 days (`1h`). Set `HISTORICAL_MARKET_PROVIDER=none` to disable collection;
the app still boots and stored history remains readable.

`POST /api/historical-market/backfill` performs bounded collection;
`GET /api/historical-market/candles`, `GET /api/historical-market/:mint/coverage`,
and `GET /api/historical-market/backfill-runs/:id` expose normalized stored data
and audit totals. Outcome routes are `POST /api/wallet-entry-outcomes/calculate`,
`GET /api/wallet-entry-outcomes`, and
`GET /api/wallet-entry-outcomes/:walletEventId`.

Only confirmed/likely BUY events are eligible. Entry is estimated from the open
of the first stored 1-minute candle at or after the event, with event-to-candle
delay recorded. Returns use `(window price / estimated entry price − 1) × 100`;
max gain/downside use the highest/lowest observed candle price through 1h or 24h.
All selection is event-forward—future candles never choose a better entry or
pair—and missing windows stay null. `COMPLETE` requires every requested window
and horizon coverage with no gaps; otherwise results are `PARTIAL`,
`UNAVAILABLE`, or `ERROR`; confidence follows completion and entry-delay rules.
Calculation version 1 is idempotent.

Simple Mode labels the estimate and warning in plain language. Quant Mode shows
exact decimal strings, pair/interval, every window, coverage, version, and
calculation time. These are selected-pair market observations, not wallet PnL,
guaranteed fills, fees, slippage, or available exits.

## Wallet position reconstruction (Phase 2A)

Wallet Intelligence reconstructs positions manually for 1–10 explicitly selected
non-development wallets (start with 1–3). It never syncs or re-decodes activity.
Events are ordered by timestamp, slot, signature, then ID and matched with FIFO.
Only decoder-v2 CONFIRMED/LIKELY BUY/SELL events with token quantity, SOL/wSOL
quote quantity, token identity, and time enter exact accounting. Legacy,
UNKNOWN, missing, stablecoin, and token-to-token events remain visible as
exclusions. Currencies are never mixed and no exchange rate is invented.

Accounting uses `decimal.js`; stored amounts and percentages are exact decimal
strings. For each allocation: raw result = sell proceeds − allocated buy swap
cost. Known all-in result additionally subtracts allocated buy fees and sell
fees. Included fees are network fee, attributable platform/router fee, and tip;
priority fee is already part of network fee and is not double-counted. Rent,
unrelated flows, and unattributed SOL are excluded and warned. ROI divides by
allocated cost (or allocated cost + buy fees for all-in), with zero/missing
denominators returning null. This is reconstruction, not tax accounting.

Transfers are inventory adjustments, never trades: transfer-in creates unknown
basis; transfer-out removes observable inventory without proceeds. Initial or
excess sells are unmatched, not losses. Partial wallet backfills are always
marked incomplete and are never described as lifetime performance. Open
inventory uses only the latest stored selected-pair `priceSol` and `priceUsd`
separately; stale/missing snapshot state is explicit and the estimate is never
called live or realized.

The additive migration `20260712172219_wallet_position_reconstruction` adds
`WalletPositionReconstructionRun`, `WalletPosition`, `WalletTradeMatch`, and
`WalletBehaviorProfile`. Routes include manual reconstruction, paginated/filterable
position/profile reads, position detail, and run audit. The local reference
bankroll defaults to 2.2 SOL, persists only in localStorage, and provides
descriptive size percentages—no wallet connection, ranking, or recommendation.

## Wallet quality evidence (Phase 2B)

Quality analysis is manual and bounded to 1–10 explicitly selected wallets. It
requires each wallet's latest completed FIFO reconstruction and never triggers
reconstruction, synchronization, outcome calculation, or market backfill. Normal
reads select only the latest completed quality run per wallet; historical audit
runs remain addressable by ID.

Strict performance evidence requires a closed position with known raw result and
ROI, no unmatched/oversold quantity, no unknown basis, and no transfer-corruption
warning. Every metric reports eligible/excluded counts, coverage, confidence, and
warnings. Sample tiers are `VERY_SMALL` (<5), `SMALL` (5–19), `MODERATE` (20–49),
`LARGE` (50–199), and `VERY_LARGE` (200+); these describe sample size only.

Calculations use `decimal.js`: positive reconstructed-result rate = positive
eligible results / eligible results × 100; profit factor = gross positive raw
results / absolute gross negative raw results (null when gross loss is zero).
Medians and interpolated P25/P75 use sorted exact decimals. Outliers are retained;
largest gain/loss contribution and median/mean divergence expose their influence.
The analysis also records holding/size distributions, distinct/repeated tokens,
fee and outcome coverage, separate candle-outcome medians, and 7-day/30-day/older
windows that remain unavailable when samples are insufficient.

Factual categories include execution venue, router/application, position-size
bucket, holding-duration bucket, event confidence, and data completeness. They
are displayed in stable type/value order and are never ranked. Wallet Intelligence
adds Simple/Quant evidence panels and a user-ordered, maximum-three-wallet neutral
comparison using the local 2.2 SOL reference bankroll. Migration:
`20260712180143_wallet_quality_metrics`; models: `WalletQualityAnalysisRun`,
`WalletQualityMetricSet`, `WalletCategoryMetric`, `WalletTimeWindowMetric`.

## BN Main wallet readiness audit (read-only)

Several tracked wallets share label patterns that begin with or contain
`bn` (e.g. `bn`, `bn trezor`, `bn new`, `bn multi`, `cabal bn`). **BN Main is
still unresolved.** It is one of the wallets labeled *exactly* `bn`, and it is
explicitly **not** `bn trezor` (`HBYkoojFkFX7NWuF2VcpDWNXEdGatfNE6mYLsR2udSzo`).
No wallet is ever auto-assigned a "BN Main" role, alias, or label — that
requires explicit user confirmation of one exact public address, which has
not happened yet.

`npm run audit:bn-wallets` prints a read-only terminal report: every
non-development wallet labeled exactly `bn` (kept strictly separate from
case-insensitive-only variants like `BN`/`Bn` and from wallets whose label
merely *contains* `bn`), each one's synchronization/reconstruction/quality/
strategy-fingerprint readiness, and a plain comparison table. Every row's
confirmation column always reads `Unconfirmed — user must verify exact
address` — the script never infers or claims which candidate is BN Main, and
never claims common ownership between similarly labeled wallets.

The script is strictly read-only: it never synchronizes, reconstructs,
analyzes, generates a fingerprint, or mutates any tracked-wallet record
(label, group, enabled state, notes). Pass `--out <path>` to additionally
write the full JSON report to a local path under `local-reports/` (gitignored
— live wallet research is never committed).

Implementation (`apps/api/src/services/walletResearch/`):

- `currentness.ts` — the exact "is this record still current" rules
  (reconstruction/quality/fingerprint), extracted from the one-click
  preparation feature so both features share one definition instead of
  reimplementing it.
- `readinessReport.ts` — `buildWalletReadinessReports`, a generic per-wallet
  factual report (sync state, stored event counts and date range,
  reconstruction/quality/fingerprint state — `MISSING`/`RUNNING`/`FAILED`/
  `STALE`/`CURRENT` — and their exact counts). Missing values are always
  `null`, never coerced to `0`.
- `bnAudit.ts` — `findBnLabeledWallets` (the strict exact/case-insensitive/
  contains grouping), `toComparisonRow` and `narrativeFor` (the plain-language
  "what is known / what is missing / what should happen next" sections).

No migration was needed — this is a pure read layer over existing tables.

## Focus Trader Strategy Lab (Phase 2C-A)

The **Focus Trader Lab** page studies how user-selected public wallets appear to
enter, size, manage and exit observed positions. It describes observed behavior
only: it never ranks wallets, never claims profitability, never classifies anyone
as an insider/dev/sniper/whale, and never recommends following or copying a wallet.

### Ownership uncertainty (non-negotiable)

A **focus cohort** is a *user-selected wallet group*. Membership is an
organizational convenience and nothing more. The app never claims two wallets
share an owner because their labels are similar, because they were saved
together, because they transfer funds, because they trade the same tokens, or
because their timing is similar. Cohort responses always carry
`OWNERSHIP_NOT_ESTABLISHED`, plus `POSSIBLE_SHARED_LABEL_ONLY` when members share
a label prefix. Wording is limited to *focus cohort*, *user-selected wallet
group*, *possibly related*, *similar observed behavior* and *shared timing
evidence*.

Cohort rules: exactly one `PRIMARY` wallet, zero to nine `COMPARISON` wallets
(ten members maximum), no duplicate wallet per cohort, development wallets
excluded, user-defined member order preserved. Creating a cohort never
synchronizes, reconstructs or analyzes anything. **Deleting a cohort deletes only
the cohort and its membership rows** — no tracked wallet, event, position,
quality record or fingerprint is ever removed (the wallet relation deliberately
has no cascade).

### Strategy fingerprints

A fingerprint is calculated from a wallet's **latest completed** FIFO
reconstruction (plus its behavior profile, and its latest completed quality
metric set when one exists). Runs are never combined, and analysis never
reconstructs, syncs, re-decodes or backfills anything. A cycle is *eligible* when
it has at least one buy with a known SOL cost; everything else is counted as
excluded rather than guessed.

Measured per wallet: buys per cycle (median/mean/P25/P75, one/two/three-or-more
splits), first-to-second buy delay and later scale-in gaps, first-buy and
largest-buy share of known cycle cost, sells per cycle, first-sell share of
observed inventory, remainder after the first sell, partial first exits,
first-buy→first-sell and last-buy→first-sell timing, first-sell→final-sell span,
cycle duration, venue and router counts, position-size buckets, fee burden
(median, P75, and counts above 1/2/5/10%), token repetition, and observed
concurrency. Timing uses neutral buckets (under 1m, 1–5m, 5–15m, 15–30m, 30–60m,
1–4h, 4–24h, over 24h, unknown/open).

Fees count network + platform/router + tip. The priority fee is **not** added
separately (it is already inside the network fee — double-count protection), and
refundable token-account rent is not treated as a trading loss. A cycle with any
unknown fee component is left `null`, never zero.

Closure is judged from **observed inventory**, not from a position's status
label: a wallet with an incomplete backfill has every position stamped
`INCOMPLETE_HISTORY`, so a fully-sold cycle would otherwise be miscounted as one
the wallet "left open".

### Descriptors and thresholds

Descriptors are structural, never evaluative — multiple buys are *observed
scale-in behavior*, not "conviction", and an open remainder is an *observed
remainder after the first sell*, not a "moonbag". Each one expands in the UI to
show its formula, numerator/denominator, observed value, threshold, sample count,
confidence and warnings. Thresholds: minimum 5 eligible cycles; "mostly" ≥ 60%;
"frequently" ≥ 40%; venue concentrated ≥ 70% / diversified < 50%; size
concentrated when P75÷P25 ≤ 2 and varied when ≥ 4; short holds < 30 min, longer
holds ≥ 4 h; fee sensitivity at a median burden ≥ 1%.

Confidence (`HIGH`/`MEDIUM`/`LOW`) describes **evidence completeness only** —
never profitability. Warning codes: `INCOMPLETE_WALLET_HISTORY`,
`NO_COMPLETED_RECONSTRUCTION`, `NO_QUALITY_ANALYSIS`, `VERY_SMALL_CYCLE_SAMPLE`,
`SMALL_CYCLE_SAMPLE`, `LOW_ELIGIBLE_COVERAGE`, `TRANSFER_AFFECTED_CYCLES`,
`UNMATCHED_SELLS_PRESENT`, `UNKNOWN_BASIS`, `MISSING_FEES`,
`MIXED_EVENT_CONFIDENCE`, `MULTI_LEG_FEE_SENSITIVITY`,
`PORTABILITY_SAMPLE_TOO_SMALL`, `CURRENT_BALANCE_NOT_HISTORICAL`,
`POSSIBLE_SHARED_LABEL_ONLY`, `OWNERSHIP_NOT_ESTABLISHED`.

### 2.2 SOL reference-bankroll portability

The reference bankroll defaults to **2.2 SOL**, is stored in `localStorage` only,
and is **never** written to the database. No wallet is connected and no balance is
fetched. The lab shows the wallet's observed absolute SOL sizes against that
bankroll, the capital a median position / two positions / the observed maximum
concurrency would use, and — because per-transaction fees stay roughly constant in
SOL — the fee burden of the same structure at positions sized to 5%, 10% and 25%
of the bankroll.

The app **does not know a wallet's historical total bankroll at the time of each
trade**, so it never infers what percentage of their capital a trade represented
and never scales whale sizes by raw SOL. Any current balance shown in future would
be current only, would not prove trading profit, and could be moved by deposits and
transfers. Neutral states: `SUFFICIENT_SAMPLE`, `LIMITED_SAMPLE`, `COST_SENSITIVE`,
`MULTI_LEG_COST_SENSITIVE`, `CAPITAL_INTENSIVE`, `STRUCTURALLY_SIMPLE`,
`INCOMPLETE_EVIDENCE`, `UNAVAILABLE`. There is no recommended size, no "safe" size,
and no copyable/not-copyable verdict.

### Routes and migration

`POST/GET /api/focus-cohorts`, `GET/PATCH/DELETE /api/focus-cohorts/:id`,
`POST /api/wallet-strategies/analyze` (explicit wallet IDs, 1–10, duplicates and
development wallets rejected, in-process lock, per-wallet failure isolation,
sanitized errors), `GET /api/wallet-strategies`,
`GET /api/wallet-strategies/:walletId`,
`GET /api/wallet-strategies/:walletId/patterns` (filterable by `patternType`), and
`GET /api/wallet-strategy-runs/:id`. There is deliberately **no** ranking,
leaderboard, top-wallet or ownership-inference endpoint.

Migration `20260712205856_focus_trader_strategy_lab` (additive); models:
`FocusTraderCohort`, `FocusTraderCohortMember`, `WalletStrategyFingerprintRun`,
`WalletStrategyFingerprint`, `WalletStrategyPatternMetric`.

### One-click Focus Wallet Preparation

`POST /api/focus-wallets/prepare` orchestrates the existing pipeline — sync,
reconstruct, quality-analyze, fingerprint — for 1–5 explicitly selected wallets,
in order, sequentially. It is user-triggered only; it never runs on a schedule
and never touches a wallet the caller did not select. No new migration was
needed: it reuses `syncWallet`, `reconstructWallets`, `analyzeWallets` and
`analyzeStrategies` directly rather than duplicating their calculations.

Each stage reports `NOT_STARTED | RUNNING | COMPLETED | SKIPPED | FAILED`.
Reconstruction/quality/fingerprint stages are skipped when the latest completed
run already covers the current data (compared by stored-event coverage and by
matching reconstruction/quality-set IDs) unless `forceRefresh` is true. Sync is
skipped once a wallet's backfill is already complete unless `forceRefresh` or
`continueHistoricalSync` is set — "Continue older history" is the user's signal
that it's worth checking again. A wallet whose sync fails is left with
reconstruction/quality/fingerprint `NOT_STARTED`; a wallet whose reconstruction
fails is left with quality/fingerprint `NOT_STARTED` — later stages never run on
top of a failed prerequisite. One wallet's failure never aborts the others in
the same request (a defense-in-depth catch wraps each wallet's turn). A
per-wallet in-process lock (distinct from each stage's own global lock) rejects
a second concurrent prepare request for the same wallet with 409
`wallet_prepare_in_progress`.

The Focus Trader Lab page's **Prepare wallet research** section lets the user
search and select up to five wallets, set a transaction limit (default 500),
toggle "Continue older history" and "Refresh completed analysis", and confirms
before any real synchronization begins. Progress cards show one row per stage
per wallet with readable labels (Already current, Synchronized, Reconstructed,
Insufficient history, Failed — retry available); a failed wallet gets a "Retry
this wallet" action. Selected wallets persist across search-query changes.

## Development seed data

`POST /api/dev/seed` (or the "Seed development data" button on the Tokens page)
inserts a small set of synthetic wallets and tokens. It is idempotent, disabled in
production, and every record is clearly marked (`source = dev-seed`, `[DEV]` prefix).
Live token discovery is **not** implemented yet.

## Roadmap

See [BUILD_PLAN.md](BUILD_PLAN.md). For architecture and continuation notes (e.g.
switching coding models), see [HANDOFF.md](HANDOFF.md).
