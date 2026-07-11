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

### ⏭ Phase 1B — Wallet activity ingestion (next)

- Fetch historical transactions/swaps for enabled tracked wallets (Helius APIs)
- `WalletEvent` (buy/sell) model + token linkage; populate `Token` from real mints
- Backfill job with rate limiting, cursoring, and progress reporting
- Dashboard: recent activity feed per wallet

### Phase 1C — Token metrics collection

- Periodic token metric snapshots (price, liquidity, holders, volume)
- Stage classification rules (`FINAL_STRETCH`, `MIGRATED`)

### Phase 2 — Wallet ranking

- Per-wallet historical PnL and hit-rate from recorded events
- Ranking views; no predictions

### Phase 3 — Rule-based signals

- Configurable rules over wallet entries + token metrics
- Signal log with full audit trail

### Phase 4 — Paper trading

- Simulated positions from signals, fills modeled from recorded prices
- PnL reporting; still no real execution

### Phase 5 — Statistics

- Probability estimates only once enough labeled history exists
- Backtesting over recorded (not synthetic) data
