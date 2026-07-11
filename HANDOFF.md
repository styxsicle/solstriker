# HANDOFF

Continuation notes for any coding model/agent picking up this project.
**Current state: Phase 1B complete** (Phase 1A also complete). Do not start
Phase 1C until the user asks.

## What this project is

A local Solana memecoin research and paper-trading app, built in small checkpoints
(see `BUILD_PLAN.md`). It is strictly read-only research tooling: no private keys, no
seed phrases, no transaction signing, no real trades — ever.

## Current architecture

- **npm workspaces** monorepo, all TypeScript, ESM (`"type": "module"`).
  - `packages/shared` — dependency-free library: base58 encode/decode, Solana
    address validation, wallet-import parsers (CSV / plain text / JSON export /
    auto-detect), activity constants (`WALLET_EVENT_TYPES`, `MAX_WALLETS_PER_SYNC`,
    quote-mint lists), `syntheticAddress()` for fake dev/test data. Built with
    `tsc` to `dist/`; the API consumes the built output.
  - `apps/api` — Fastify 5 + Prisma + Zod. `buildApp(deps)` in `src/app.ts` takes
    injected `{ prisma, env, rpc, activityProvider, syncOptions? }` so tests run
    fully offline via `app.inject()`. Entry `src/server.ts` (binds 127.0.0.1).
  - `apps/web` — React 18 + Vite 6 dark dashboard, four tabs (System status,
    Tracked wallets, Tokens, Activity), plain CSS, no router. Talks to the API via
    `VITE_API_BASE_URL` only.
  - `prisma/` at the repo root — schema, migrations, `dev.db` (gitignored).

### Provider isolation (Phase 1B)

- `apps/api/src/providers/solana/types.ts` — neutral `SolanaTransaction` /
  transfer shapes + `ProviderError` (codes: `not_configured`, `rate_limited`,
  `provider_error`; messages are generic by contract — never URLs/keys).
- `providers/solana/provider.ts` — `SolanaActivityProvider` interface
  (`getWalletTransactions(address, { before, limit })`, newest → oldest).
- `providers/solana/heliusProvider.ts` — the ONLY Helius-aware file. Enhanced
  Transactions API (`/v0/addresses/{address}/transactions`), key inside the
  closure, retry with backoff on 429/5xx/network errors, page limit ≤100,
  devnet host switch. All Helius specifics stay behind this boundary.

### Activity sync (Phase 1B)

- `services/activity/normalizeTransaction.ts` — pure function: one neutral
  transaction → 0..n normalized events for a wallet. Rules: failed txs skipped;
  wSOL folded into native SOL; USDC/USDT are quote currencies; received+paid (or
  provider type SWAP) → BUY, received unpaid → TOKEN_TRANSFER_IN; mirror for
  SELL/TOKEN_TRANSFER_OUT; SOL dust (<0.01) ignored as quote flow; quote amount
  attached only when exactly one token moved in that direction; plain SOL
  transfers produce nothing.
- `services/activity/syncWallet.ts` — resumable sync engine. Backfill mode pages
  backwards from `oldestSignature` up to `maxTransactions` per call (cap hit →
  `backfillComplete=false`, next call resumes). Incremental mode pages from the
  tip until `newestSignature` is seen. Sequential pages with `pauseMs` (default
  300ms; tests pass 0 via `AppDeps.syncOptions`). Tokens upserted from real mints
  (`source: "activity"`, `lastSeenAt` advanced). Events deduped by unique
  `dedupeKey = walletId:signature:eventType:mint`.
- `services/activity/syncLock.ts` — in-process per-wallet lock (single-process
  app; not distributed).

## Database models (prisma/schema.prisma; SQLite — no enums, no lists)

- `TrackedWallet`: `id`, `address` (unique), `label?`, `group?` (primary),
  `groupsJson?` (full JSON array), `emoji?`, `notes?`, `metaJson?`, `enabled`,
  `source` (`manual`|`import:*`|`dev-seed`), timestamps; relations `events`,
  `syncState`.
- `Token`: `id`, `mintAddress` (unique), `name?`, `symbol?`, `stage`
  (`UNCLASSIFIED|FINAL_STRETCH|MIGRATED`), `source` (`dev-seed`|`activity`),
  `discoveredAt`, `lastSeenAt`, timestamps; relation `events`.
- `WalletEvent`: `dedupeKey` (unique), `walletId`, `tokenId?`, `signature`,
  `eventType` (`BUY|SELL|TOKEN_TRANSFER_IN|TOKEN_TRANSFER_OUT`), `tokenAmount?`,
  `quoteMint?` (`"SOL"` or stable mint), `quoteAmount?`, `source?` (JUPITER,
  PUMP_FUN, ...), `slot?`, `blockTime?`. Cascade-deletes with its wallet.
- `WalletSyncState`: `walletId` (unique), `status` (`idle|syncing|error`),
  `backfillComplete`, `oldestSignature?` (backfill cursor), `newestSignature?`
  (incremental cursor), `lastSyncAt?`, `lastError?` (sanitized code only),
  `totalTransactions`, `totalEvents`. Cascade-deletes with its wallet.

Migrations: `20260711012659_init`, `20260711031157_wallet_activity`.

## API routes

| Route | Notes |
| --- | --- |
| `GET /api/health` | API + DB status |
| `GET /api/rpc/status` | Sanitized Helius `getHealth` + `getSlot` |
| `GET /api/wallets` | Pagination, `search`, `group`, `enabled`; returns `stats` + distinct `groups` |
| `POST /api/wallets` | Manual add (400 `invalid_address`, 409 `duplicate_address`) |
| `POST /api/wallets/import` | CSV / text / JSON export, auto-detect; idempotent |
| `PATCH /api/wallets/:id` | Partial update incl. `enabled` |
| `GET /api/tokens` | List; `liveDiscovery: false` |
| `POST /api/dev/seed` | Dev only; idempotent synthetic data |
| `POST /api/activity/sync` | Body `{ walletIds: string[] (1–10), maxTransactions?: 1–500 (default 200) }`. 503 `provider_not_configured`; 400 `unknown_wallet` / `wallet_disabled` / validation. Sequential; per-wallet results `{ status: ok\|locked\|error, transactionsProcessed, eventsCreated, duplicateEvents, tokensDiscovered, backfillComplete, error }` |
| `GET /api/activity/status` | `providerConfigured`, `maxWalletsPerSync`, per-wallet sync states |
| `GET /api/activity/events` | Filters `walletId`, `tokenId`, `eventType`; paginated, newest first, includes wallet + token info |

## Important files

- `packages/shared/src/{walletImport,base58,solana,activity}.ts`
- `apps/api/src/app.ts` — app factory (all deps injected)
- `apps/api/src/providers/solana/*` — provider boundary (see above)
- `apps/api/src/services/activity/*` — normalize / sync / lock
- `apps/api/src/routes/{wallets,tokens,activity}.ts`
- `apps/api/test/activity/*` — fixtures + `FakeProvider` (cursor-pagination
  emulator) + 29 activity tests
- `apps/web/src/pages/{StatusPage,WalletsPage,TokensPage,ActivityPage}.tsx`

## Commands (from repo root)

```bash
npm install          # postinstall runs prisma generate
npm run db:generate
npm run db:migrate
npm run dev          # API :3001 + web :5173
npm run test         # 70 tests (22 shared + 48 api), fully offline
npm run lint
npm run build
```

## Environment variables (root `.env`, template in `.env.example`)

`HELIUS_API_KEY` (backend only; real key currently set locally — never commit),
`SOLANA_CLUSTER`, `DATABASE_URL` (`file:./dev.db` → `prisma/dev.db`), `API_PORT`,
`WEB_ORIGIN`, `VITE_API_BASE_URL` (only value the frontend sees). No secrets in
the repo; `.env` is gitignored.

## Tests (all offline — fake keys, injected fetch mocks, FakeProvider)

- shared (22): base58, address validation, import parsers.
- api (48): Phase 1A suites (health, RPC sanitization, wallet CRUD, import,
  seed) plus activity: normalization rules (11), Helius provider mapping /
  pagination params / retries / key-leak sanitization (5), sync route — 503
  unconfigured, >10 wallets rejected, unknown/disabled wallets, backfill with
  cap + cursor resume, incremental new-tx-only sync, idempotent re-scan,
  lock contention, sanitized error persistence (9), events listing filters +
  pagination (4).

## Verified live (2026-07-10)

One public high-activity wallet (Raydium AMM authority — not user data) synced
against mainnet with the real key: 100 txs ≈ 2s, normalized BUY/SELL events with
SOL quote amounts, tokens auto-created, cursor resume on second sync, zero
duplicates. Test wallet and its data were removed afterwards.

## Known limitations

- Sync is a synchronous HTTP request (10 wallets × 500 tx worst case ≈ a minute);
  no background jobs yet.
- Incremental mode: if more than `maxTransactions` new txs accumulate between
  syncs, the overflow beyond the cap is skipped (dedupe makes overlaps harmless;
  a re-backfill can recover gaps by resetting cursors).
- Normalization is heuristic (dust thresholds, quote attribution only when a
  single token moved per direction; token→token swaps get no quote amount).
- Activity-discovered tokens have no name/symbol yet (Phase 1C enrichment).
- Locks are in-process only; API is local single-user, binds 127.0.0.1, no auth.
- Token page still shows `liveDiscovery: false`; discovery via activity is
  incidental, not a scanner.

## Exact next checkpoint (Phase 1C — wait for the user's go-ahead)

Token metrics collection: enrich activity-discovered tokens with metadata
(name/symbol/decimals), add periodic token metric snapshots (price, liquidity,
holder count, volume) behind the same provider-isolation pattern, and implement
stage classification rules for `FINAL_STRETCH` / `MIGRATED`. Keep everything
read-only, offline-testable, and key-sanitized.
