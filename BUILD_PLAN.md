# Build plan

The application is built in small, verifiable checkpoints. Each phase must pass
tests, lint, and a production build before the next phase begins.

## Long-term goal

Monitor ~1,000 tracked Solana wallets, record their token buys/sells, rank wallets by
historical results, find patterns shared by successful entries, collect token metrics,
generate rule-based signals, paper-trade those signals, and only estimate
probabilities once enough historical data exists.

Explicitly out of scope at all times: private keys, seed phrases, transaction
signing, and real trades.

## Phases

### ✅ Phase 1A — Foundation, wallet import, RPC status (complete)

- npm-workspaces monorepo: `apps/api`, `apps/web`, `packages/shared`, root `prisma/`
- Prisma + SQLite with `TrackedWallet` and `Token` models
- Secure Helius RPC status check (`getHealth` + `getSlot`), key kept backend-only,
  sanitized responses, app runs without a key
- Wallet import: CSV, plain text, JSON tracker export (multi-group, emoji, alert
  metadata), manual entry; validation, duplicate detection, idempotent re-import
- Dark dashboard: system status, tracked-wallet management (search, group filter,
  pagination, enable/disable), token page with dev seed data
- Vitest suites (41 tests), ESLint, production builds, docs

### ✅ Phase 1B — Historical wallet activity ingestion (complete)

- Provider interface (`SolanaActivityProvider`) with all Helius specifics isolated
  in `heliusProvider.ts` (sanitized errors, retry/backoff, key never leaves closure)
- `WalletEvent` model: normalized BUY / SELL / TOKEN_TRANSFER_IN / TOKEN_TRANSFER_OUT
  per token leg, deduped by key so re-syncs are idempotent
- `WalletSyncState`: resumable backfill cursor + incremental catch-up cursor
- Manual sync of **max 10 selected wallets per request** (never bulk), sequential,
  paged, rate-limit paused, per-wallet in-process locks
- Tokens auto-created from real mints (`source: "activity"`)
- Routes: `POST /api/activity/sync`, `GET /api/activity/status`, `GET /api/activity/events`
- Dashboard Activity tab: wallet picker (≤10), sync results, status table, filtered
  paginated event feed with Solscan links
- 29 new offline tests (normalization, provider sanitization, cursors, idempotency,
  locking) — 70 total

### ✅ Phase 1C — Reliable buy/sell and swap decoding (complete)

- Exact swap legs instead of wallet-outflow totals (fixed real Pump.fun case:
  quote 1.510707025 SOL, previously misreported as 1.539120863)
- Three decoding paths: provider swap events → venue-instruction
  reconstruction (Pump.fun / Pump AMM / Raydium / Meteora, router-mediated
  trades, program-credited sell proceeds) → quote-free heuristic
- Full SOL breakdown per event: wallet change, network/priority fee,
  platform/router fees, tips, ATA rent (incl. close refunds), unrelated
  transfers, unattributed residue — reconciled exactly
- Confidence levels (CONFIRMED/LIKELY/UNKNOWN) + human-readable explanations;
  router vs execution venue preserved separately; quotes never invented
- Additive schema migration `reliable_swap_decoding` (+16 nullable columns,
  `decoderVersion`); wallet-scoped `POST /api/activity/resync` for re-decoding
  (raw payloads aren't stored, so re-decode = re-fetch; documented)
- Activity page: swap vs wallet-Δ columns, confidence pills, expandable fee
  breakdown, unattributed warnings, per-wallet Re-sync
- 26 new offline tests (89 total); verified against 2 real mainnet transactions

### ✅ Phase 1D-A — Beginner-friendly UI and product foundation (complete)

- Application shell: desktop sidebar + mobile top nav, hash navigation, page
  headers, reusable cards/badges/notices/modals/empty states/skeletons,
  responsive layouts, accessibility (semantic headings, labels, focus states,
  aria, no color-only signals)
- Simple Mode (default) and Quant Mode, persisted in localStorage, no reload;
  Simple explains the same real data in sentences, Quant preserves every raw field
- Overview page: plain-language health, research-database stats
  (`GET /api/overview`), capabilities done vs not-implemented, prominent
  "historical research only" notice
- Activity: sentence-based event cards with "See details" breakdowns, exact
  confidence wording, unknown-quote wording, accessible Re-sync confirmation
  modal, summary cards (`GET /api/activity/summary` — counts only, no
  performance metrics)
- Wallets/Tokens: beginner explanations, import steps + large-file
  confirmation, dev-seed records hidden by default (`includeDev=false` param)
- Help page: ~28-term glossary + privacy and safety rules
- 29 frontend tests (vitest + jsdom + Testing Library), all offline
- "Coming later" items (Signals, Coin Analyzer, Backtesting, Wallet
  Intelligence, Alerts) visibly disabled — no fake data anywhere

### ✅ Phase 1D-B1 — Current token market snapshots (complete)

- Provider-neutral market-data architecture (`providers/market/`) with a
  `MarketDataProvider` interface and dependency injection for tests
- DexScreener provider (public `tokens/v1` endpoint, no API key, 300 req/min);
  exact decimal strings preserved, sanitized typed errors, bounded
  timeout/retry with Retry-After handling
- Deterministic pair-selection policy (Solana-only, contains the mint, highest
  liquidity → volume → recency → quote preference → address tie-break); handles
  the requested token appearing as base or quote without inventing prices
- Additive migration `token_market_snapshots`: `TokenMarketSnapshot` +
  `TokenMarketRefreshRun`; market cap and FDV stored strictly separately
- Manual bounded refresh (max 20 tokens, 1–5 recommended, dev tokens excluded
  by default), per-token failure isolation, refresh lock, auditable run totals
- Centralized freshness (`FRESH`/`AGING`/`STALE`/`NEVER_FETCHED`/`UNKNOWN`)
  computed from observation time — manual snapshots never called "live"
- Routes: `POST /api/token-metrics/refresh`, `GET /api/token-metrics`,
  `GET /api/token-metrics/:mint/latest`, `.../snapshots`, `.../refresh-runs/:id`;
  Tokens API `withMarket`/`marketData`/`sort`; Overview market summary
- Tokens page: Simple Mode market cards with plain-language field explanations,
  Quant Mode exact-decimal technical table, selection controls; Overview market
  cards. No recommendations, scores, or predictions.

### ✅ Phase 1D-B2 — Historical OHLCV and post-entry outcomes

- Historical OHLCV candle collection and bounded backfilling
- Post-wallet-entry market outcomes (price after a tracked wallet's entry)
- Manual bounded backfill only; scheduled collection remains intentionally out of scope
- Versioned, no-look-ahead BUY-entry outcome calculation and coverage UI
- Additive migration `20260712154023_historical_market_candles`

### ✅ Phase 2A — Wallet trade reconstruction, position matching, realized/unrealized outcome foundations, and bankroll-aware wallet profiles

- Exact-decimal FIFO lots, cycles, partial exits, unmatched sells, and transfers
- Raw versus attributable all-in results; stored-snapshot open valuation
- Bounded manual APIs, audit runs, profiles, and Wallet Intelligence foundation
- Local-only configurable reference-bankroll comparison; no rankings/advice

### ✅ Phase 2B — Wallet quality metrics, category-specific performance, consistency analysis, and non-ranking research comparisons

- Exact descriptive evidence, eligibility/coverage, sample tiers and safeguards
- Stable factual categories, outcome medians and recent/older windows
- Neutral user-ordered comparison (max 3), never a ranking

### ✅ Phase 2C-A — Focus Trader Strategy Lab, behavior fingerprints, focus cohorts, and 2.2 SOL portability analysis (complete)

- Persistent user-created focus cohorts (one PRIMARY + up to nine COMPARISON
  wallets, user-defined order, development wallets excluded). Cohort membership is
  an organizational grouping only and never establishes common ownership; deleting
  a cohort never deletes wallets or research data
- Deterministic strategy fingerprints from each wallet's latest completed
  reconstruction only: entry/exit structure, scale-in and scale-out behavior,
  partial exits, observed remainder, timing buckets, venue/router counts, position
  sizes, fee burden (with priority-fee double-count protection and rent excluded),
  token repetition, and observed concurrency
- Evidence-backed descriptors with published thresholds, formulas, sample counts,
  confidence and warning codes — descriptive only, never evaluative
- Local 2.2 SOL reference-bankroll portability illustrations (never stored, never
  inferred from a wallet's balance); no recommended size and no copyable verdict
- Visible Focus Trader Lab page (Simple + Quant), Overview and Help additions
- Additive migration `20260712205856_focus_trader_strategy_lab`
- One-click Focus Wallet Preparation (`POST /api/focus-wallets/prepare`):
  user-triggered orchestration of sync → reconstruct → quality → fingerprint for
  1–5 wallets, sequential, per-stage skip-when-current logic, per-wallet failure
  isolation, no new migration (reuses existing services directly)

### ✅ Beginner UX Simplification Pass (complete)

- New Simple Mode navigation (Home · Wallets · Coin Check · Alerts · My
  Positions · Advanced); Alerts/My Positions render disabled with "Coming
  later," never navigable, no backend route. Quant Mode's original nav is
  unchanged; every old hash route still renders directly.
- Home (four beginner action cards + a small research-status summary) and
  Advanced (a plain directory to the five existing detailed pages) replace
  Simple Mode's old technical-dashboard-first landing page — no page removed.
- Learn a wallet: a beginner-only wrapper around the existing one-click
  preparation endpoint/services (no pipeline duplication), plain-language
  stage names and a narrative completion summary, Advanced options collapsed
  with unchanged defaults.
- Fixed three wallet pickers (`WalletIntelligencePage`, `FocusTraderLabPage`,
  `PrepareWalletPanel`) that filtered a locally cached first page instead of
  using the backend's existing server-side search; added a shared
  `useWalletSearch` hook and `WalletLabel` component.
- BN wallet safety: no wallet is ever auto-assigned a "BN Main" role; `bn
  trezor` is explicitly not BN Main; enforced by `test/bnSafety.test.tsx`.
- Wallets and Coin Check (Tokens) simplified in Simple Mode: search-first,
  plain-language status, small field sets, bulk import/dev records/provider
  detail moved under "Advanced" disclosures — nothing removed, Quant Mode
  unchanged. Coin Check states prominently that full token safety checks are
  not built yet.
- Frontend-only: no backend calculation, financial value or database schema
  changed; no new migration.

### ⏭ Phase 2C-B — Related-wallet funding relationships, shared-entry timing evidence, leader/follower sequencing, and non-accusatory relationship heuristics (next checkpoint)

- Funding-transfer evidence between user-selected wallets, stated as observations
  and never as proof of common ownership or coordination
- Shared-entry timing evidence and leader/follower sequencing over recorded events
- Carefully qualified, non-accusatory relationship heuristics with explicit
  uncertainty; no insider, cabal, dev-group or manipulation classification

### Phase 2C-C — Behavior archetype clustering across the larger wallet universe

- Descriptive clustering of observed behavior structures; no rankings, no verdicts

### Phase 2C-D — Historical strategy replay using user-sized shadow portfolios

- Replay of recorded history against a user-chosen bankroll; still no execution

### Phase 3 — Rule-based signals

- Configurable rules over wallet entries + token metrics
- Signal log with full audit trail

### Phase 4 — Paper trading

- Simulated positions from signals, fills modeled from recorded prices
- PnL reporting; still no real execution

### Phase 5 — Statistics

- Probability estimates only once enough labeled history exists
- Backtesting over recorded (not synthetic) data

### Later — deliberately not implemented

Each item below is out of scope until the phases above are complete. None of them
exists in the codebase today:

- Live focus-wallet monitoring (no WebSockets, polling, or background jobs)
- Multi-wallet accumulation alerts
- FOMO / early-versus-late engine
- Token risk and bundle analysis
- My Positions research page
- Night Watch / Overnight Desk — candidate monitoring and overnight research plans
  only after live signals, FOMO analysis, token-risk analysis, and paper validation
- X / social narrative monitoring
- Shadow alerts and paper validation
