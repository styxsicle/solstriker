# HANDOFF

Continuation notes for any coding model/agent picking up this project.
**Current state: Phase 1C complete** (1A foundation, 1B activity ingestion,
1C reliable swap decoding). Do not start Phase 1D until the user asks.

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

### Provider isolation (Phase 1B, extended in 1C)

- `apps/api/src/providers/solana/types.ts` — neutral `SolanaTransaction`:
  transfers (with SPL token accounts), `feeLamports`, `feePayer`, per-account
  `accountBalanceChanges` (exact lamport deltas), decoded `swap` event
  (native/token inputs/outputs, native/token fee legs, inner venues), and
  flattened `programInvocations` (top-level + inner, programId + accounts).
  `ProviderError` codes: `not_configured` / `rate_limited` / `provider_error`;
  messages are generic by contract — never URLs/keys.
- `providers/solana/provider.ts` — `SolanaActivityProvider` interface
  (`getWalletTransactions(address, { before, limit })`, newest → oldest).
- `providers/solana/heliusProvider.ts` — the ONLY Helius-aware file. Enhanced
  Transactions API, key inside the closure, retry/backoff on 429/5xx, page
  limit ≤100, devnet host switch. `mapRawHeliusTransaction` is exported for
  fixtures/verification scripts. All Helius specifics stay behind this file.

### Reliable swap decoding (Phase 1C) — `services/activity/normalizeTransaction.ts`

Three paths, tried in order; **quotes are exact swap legs or null — never
wallet-outflow totals, never invented**:

1. **Provider-decoded swap event → CONFIRMED.** Amounts from the event's exact
   legs; wSOL folds into SOL; USDC/USDT legs are the quote; token→token swaps
   yield SELL+BUY with each other as counter-leg; quote attached only when a
   single token moved per direction.
2. **Venue-instruction reconstruction → CONFIRMED.** When no event is present
   (observed for router-mediated Pump.fun trades, e.g. Axiom): find exactly one
   known venue program among `programInvocations` (`knownAccounts.ts`
   `VENUE_PROGRAMS`: Pump.fun + its fee program, Pump AMM, Raydium v4/CPMM/CLMM,
   Meteora DLMM). Wallet transfers to that instruction's accounts = exact swap
   input (verified: 1.49205632 curve + three fee legs = 1.510707025 on the real
   bug tx). Sell proceeds credited directly by the program (no transfer record)
   are recovered from the exact wallet-balance identity, with ATA-close rent
   refunds excluded. Only unambiguous single-token single-direction trades
   decode here; wSOL involvement bails out.
3. **Heuristic → LIKELY / UNKNOWN / CONFIRMED-transfers.** Classification from
   balance movements; quote stays null and the flow lands in `unattributedSol`.
   Plain transfers (no quote flow) are CONFIRMED non-trades. Two-direction
   movement without decodable data → UNKNOWN.

Every event carries a **SOL breakdown** reconciled against the wallet's exact
balance change: network fee (+ priority portion, 1-signature assumption),
platform/router fees (decoded fee legs, known fee accounts, plus leftover
outflows ≤ max(0.05 SOL, 5% of principal) during a decoded swap), Jito tips,
net token-account rent (funding − close refunds, via the wallet's own token
accounts), unrelated transfers, and the signed `unattributedSol` residue.
Plus `confidence`, human-readable `explanation`, router (`source`) vs
execution `venue`.

### Activity sync (Phase 1B)

- `services/activity/syncWallet.ts` — resumable sync engine. Backfill pages
  backwards from `oldestSignature` up to `maxTransactions` per call; incremental
  mode pages from the tip until `newestSignature`. Sequential pages with
  `pauseMs` (tests pass 0 via `AppDeps.syncOptions`). Tokens upserted from real
  mints (`source: "activity"`). Events deduped by unique
  `dedupeKey = walletId:signature:eventType:mint`; rows record
  `decoderVersion` (current: 2, from shared `DECODER_VERSION`).
  `resetBeforeSync` option deletes ONLY that wallet's events + sync state under
  the sync lock (used by resync).
- `services/activity/syncLock.ts` — in-process per-wallet lock.
- `services/activity/knownAccounts.ts` — public protocol constants: Jito tip
  accounts, Pump.fun fee recipients, venue program IDs, ATA rent, base fee.
  Extending these sets improves attribution; unknown accounts degrade safely
  into unattributed/unrelated buckets.

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
  `quoteMint?`/`quoteAmount?` (exact swap leg only), `source?` (router/app),
  `slot?`, `blockTime?`. Phase 1C additive columns (all nullable):
  `venue`, `confidence` (`CONFIRMED|LIKELY|UNKNOWN`), `explanation`,
  `swapInMint/swapInAmount/swapOutMint/swapOutAmount`, `walletSolChange`,
  `networkFeeSol`, `priorityFeeSol`, `platformFeeSol`, `tipSol`, `rentSol`,
  `unrelatedSolIn/unrelatedSolOut`, `unattributedSol`, and
  `decoderVersion Int @default(1)` (1 = legacy heuristic rows, 2 = current).
  Cascade-deletes with its wallet.
- `WalletSyncState`: `walletId` (unique), `status` (`idle|syncing|error`),
  `backfillComplete`, `oldestSignature?` (backfill cursor), `newestSignature?`
  (incremental cursor), `lastSyncAt?`, `lastError?` (sanitized code only),
  `totalTransactions`, `totalEvents`. Cascade-deletes with its wallet.

Migrations: `20260711012659_init`, `20260711031157_wallet_activity`,
`..._reliable_swap_decoding` (additive only — no data was reset).

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
| `GET /api/activity/events` | Filters `walletId`, `tokenId`, `eventType`; paginated, newest first, includes wallet + token info and all decoding/breakdown fields |
| `POST /api/activity/resync` | Same body/validations as sync; clears ONLY the selected wallets' events + cursors (under the sync lock), then re-fetches so history is re-decoded. This is THE way to upgrade `decoderVersion: 1` rows — raw payloads are not stored, so in-place re-decoding is impossible by design (do not guess). |

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
- api (67): Phase 1A suites (health, RPC sanitization, wallet CRUD, import,
  seed); provider mapping incl. swap events/instructions/retries/key-leak
  sanitization (6); classification paths — decoded buys/sells, token→token,
  router vs venue, heuristic LIKELY with null quotes, transfers, UNKNOWN
  two-direction, failed/no-op txs (12); decoding fixtures — the real-numbers
  Pump.fun bug case, instruction-reconstructed sell with balance-identity
  proceeds + ATA-close refund, Axiom-style router fees, Pump AMM partial sell,
  Jupiter/Raydium, base-vs-priority fee split, rent, unrelated transfer,
  missing quote, missing account data (15); sync engine — cursors, caps,
  incremental, idempotency, locks, sanitized errors (9); events API (4);
  wallet-scoped resync incl. bystander isolation + validations (2).

## Verified live

- 2026-07-10 (Phase 1B): public high-activity wallet synced against mainnet —
  100 txs ≈ 2s, cursor resume, zero duplicates; test data removed afterwards.
- 2026-07-11 (Phase 1C): the real Pump.fun buy that exposed the quote bug was
  re-decoded read-only via the actual provider mapper + decoder:
  old stored quote **1.539120863** (total outflow) → new **BUY CONFIRMED,
  quote 1.510707025 SOL** (matches Solscan's swap input exactly), router fees
  0.026339758, ATA rent 0.00207408, network fee 0.000307, unattributed 0.
  A second real sell decoded as **SELL CONFIRMED, proceeds 1.000449718 SOL**
  (recovered from the balance identity; Helius ships no swap event and no
  native transfer for pump payouts), router fees 0.013004497, unattributed 0.

## Known limitations

- Sync is a synchronous HTTP request (10 wallets × 500 tx worst case ≈ a
  minute); no background jobs yet.
- Incremental mode: if more than `maxTransactions` new txs accumulate between
  syncs, the overflow beyond the cap is skipped (dedupe makes overlaps
  harmless; per-wallet resync recovers gaps).
- Priority fee assumes 1 signature (fee − 5000 lamports); signature count is
  not exposed by the enhanced payload.
- During a decoded swap, leftover wallet outflows ≤ max(0.05 SOL, 5% of the
  principal) are labeled platform/router fees (real amounts, heuristic label);
  larger ones are `unrelatedSolOut`. In the quote-free heuristic path nothing
  is labeled — residue goes to `unattributedSol`.
- Venue-instruction reconstruction handles single-token, single-direction
  trades only; token→token without a provider event stays UNKNOWN. The venue
  registry (`knownAccounts.ts`) is extensible; unknown venues fall back safely.
- Fee/tip/venue account lists are best-effort public constants; misses degrade
  into unattributed, never into wrong quotes.
- The SOL breakdown is per transaction but stored on each event of that tx —
  a multi-leg tx repeats it (dedupe by signature before summing fees).
- Rows with `decoderVersion: 1` (pre-1C) still carry outflow-total quotes;
  they are flagged in the UI and must be re-synced (raw payloads aren't stored).
- Activity-discovered tokens have no name/symbol yet (next phase).
- Locks are in-process; API is local single-user, binds 127.0.0.1, no auth.

## Exact next checkpoint (Phase 1D — wait for the user's go-ahead)

Token metrics collection: enrich activity-discovered tokens with metadata
(name/symbol/decimals), add periodic token metric snapshots (price, liquidity,
holder count, volume) behind the same provider-isolation pattern, and implement
stage classification rules for `FINAL_STRETCH` / `MIGRATED`. Keep everything
read-only, offline-testable, and key-sanitized.
