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

### ⏭ Phase 1C — Token metrics collection (next)

- Periodic token metric snapshots (price, liquidity, holders, volume)
- Stage classification rules (`FINAL_STRETCH`, `MIGRATED`)
- Token metadata enrichment (names/symbols for activity-discovered tokens)

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
