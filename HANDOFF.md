# HANDOFF

Continuation notes for any coding model/agent picking up this project.
**Current state: FOMO Simulator V1 complete** (1A foundation, 1B activity
ingestion, 1C reliable swap decoding, 1D-A beginner-friendly UI shell, 1D-B1
current token market snapshots, 1D-B2 historical OHLCV and entry outcomes,
2A wallet reconstruction, 2B wallet quality evidence, 2C-A Focus Trader
Strategy Lab, the BN Main readiness audit, the Beginner UX Simplification
Pass, Slow Cook V1, and FOMO Simulator V1). Do not start Phase 2C-B until
the user asks.

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
  - `apps/web` — React 18 + Vite 6 dark dashboard. Phase 1D-A shell: desktop
    sidebar + mobile top nav (hash-based navigation, no router dependency),
    pages Overview / Wallets / Activity / Tokens / Help, plus visibly disabled
    "Coming later" entries (Signals, Coin Analyzer, Backtesting, Wallet
    Intelligence, Alerts — no fake data). Talks to the API via
    `VITE_API_BASE_URL` only.

### Frontend structure (Phase 1D-A)

- `src/lib/mode.tsx` — `ModeProvider`/`useMode`: `'simple' | 'quant'`,
  default simple, persisted under localStorage key `memecoin-lab.ui-mode`,
  switching never reloads. Simple Mode explains the same real data in
  sentences; Quant Mode preserves every raw field (exact decimals, decoder
  version, fee attribution, router/venue, confidence).
- `src/lib/wording.ts` — the beginner sentences and REQUIRED exact strings:
  buy/sell/transfer sentences, `UNKNOWN_QUOTE_TEXT`
  ("Exact SOL amount could not be verified."), `UNKNOWN_ACTIVITY_TEXT`, and
  `confidenceInfo()` (Confirmed/Likely/Unknown wording + icon + tone — text
  and icon, never color alone). Tests pin these strings.
- `src/lib/format.ts` — compact ("15.6M") vs exact formatting, addresses,
  signatures, SOL amounts, timestamps.
- `src/components/` — `Sidebar` (nav + disabled future features), `ModeToggle`
  (aria-pressed group), `PageHeader`, `Modal` (dialog semantics, Escape,
  focus), `ConfirmResyncModal` (names the wallet; explains only its events +
  sync state are replaced, record kept, others unaffected), `EventList`
  (Simple = sentence cards with "See details"; Quant = sticky-header technical
  table), `EventDetails` (full fee/decoder breakdown shared by both modes,
  unknowns labeled "not available").
- `src/pages/` — `OverviewPage` (plain-language health + research DB stats +
  capabilities done/not-implemented + "historical research only" notice),
  `WalletsPage` (import steps, large-file confirm modal >1 MB, enabled/
  disabled/DEV explanations, dev records hidden by default), `ActivityPage`
  (summary cards, sync guidance "start with 1–5 wallets and 100 transactions",
  resync via modal), `TokensPage` (column explanations, dev toggle),
  `HelpPage` (glossary + privacy/safety).
- `src/styles.css` — design system: CSS variables, responsive shell
  (sidebar ≤860px collapses to top nav), cards/badges/buttons/inputs/tables
  (sticky thead, horizontal scroll), notices, empty states, skeletons,
  focus-visible outlines, reduced-motion support, `.visually-hidden`.
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

Phase 2C-A additions (all additive):

- `FocusTraderCohort`: `name` (unique), `description?`. A user-selected wallet
  group — it never establishes common ownership.
- `FocusTraderCohortMember`: `cohortId`, `trackedWalletId`, `role`
  (`PRIMARY` | `COMPARISON`), `displayOrder`, `notes?`. Unique
  `(cohortId, trackedWalletId)`. Cascades from the cohort; the wallet relation has
  **no cascade**, so deleting a cohort can never delete a wallet.
- `WalletStrategyFingerprintRun` / `WalletStrategyFingerprint` /
  `WalletStrategyPatternMetric`: auditable run, one descriptive fingerprint per
  wallet per run (unique `(runId, trackedWalletId, calculationVersion)`), and
  factual pattern rows (unique `(fingerprintId, patternType, patternValue)`).
  Values are exact decimal strings; unknown stays null.

FOMO Simulator V1 additions (all additive):

- `PaperCall`: one immutable recorded call event (`action`:
  `BUY|HOLD|EXIT|AVOID|NO_TRADE`, `conviction`: `HIGH|MEDIUM|LOW`), unique
  `dedupeKey`, the frozen Slow Cook state/confidence/methodology versions,
  `cohortKey` plus JSON snapshots of wallet IDs/addresses/labels/style
  summaries/reasons/invalidation/evidence/data-quality/settings, entry
  snapshot/price/market context, simulation assumptions, `priced` +
  `unpricedReason`, optional `paperPositionId`. Cascades from `Token`.
- `PaperPosition`: one simulated USD position (`status`: `OPEN|CLOSED`),
  entry fields (snapshot, observed time, raw + effective price, fee, token
  quantity), exit fields (snapshot, price, gross/net value, fee, realized
  P/L + return, all nullable until closed), latest valuation fields
  (`latestValueUsd`, `unrealizedPlUsd`, `unrealizedReturnPct`,
  `latestValuationAt`), and `exitSignalPendingReason` for an EXIT recorded
  without a usable closing price. Indexed on `status` and on
  `[tokenId, cohortKey, methodologyVersion]` for open-position lookups.
- `PaperPositionValuation`: one immutable valuation checkpoint from one
  stored market snapshot (price, gross/net value, unrealized P/L + return,
  freshness). Unique `[positionId, snapshotId]` makes refresh idempotent;
  cascades from `PaperPosition`.

Migrations: `20260711012659_init`, `20260711031157_wallet_activity`,
`..._reliable_swap_decoding`, `20260712205856_focus_trader_strategy_lab`,
`20260713054018_add_fomo_paper_calls`
(additive only — no data was reset).

## API routes

| Route | Notes |
| --- | --- |
| `GET /api/health` | API + DB status |
| `GET /api/rpc/status` | Sanitized Helius `getHealth` + `getSlot` |
| `GET /api/overview` | Read-only research-DB counts: wallets (total/enabled/dev), synced wallets, stored events, tokens (total/dev) |
| `GET /api/wallets` | Pagination, `search`, `group`, `enabled`, `includeDev` (`false` hides dev-seed; absent = prior behavior); returns `stats` + distinct `groups` |
| `POST /api/wallets` | Manual add (400 `invalid_address`, 409 `duplicate_address`) |
| `POST /api/wallets/import` | CSV / text / JSON export, auto-detect; idempotent |
| `PATCH /api/wallets/:id` | Partial update incl. `enabled` |
| `GET /api/tokens` | List; `includeDev` param as above; `liveDiscovery: false` |
| `GET /api/activity/summary` | Read-only event counts by type/confidence, legacy (decoder v1) count, transactions checked — deliberately no profit/win-rate/performance metrics |
| `POST /api/dev/seed` | Dev only; idempotent synthetic data |
| `POST /api/activity/sync` | Body `{ walletIds: string[] (1–10), maxTransactions?: 1–500 (default 200) }`. 503 `provider_not_configured`; 400 `unknown_wallet` / `wallet_disabled` / validation. Sequential; per-wallet results `{ status: ok\|locked\|error, transactionsProcessed, eventsCreated, duplicateEvents, tokensDiscovered, backfillComplete, error }` |
| `GET /api/activity/status` | `providerConfigured`, `maxWalletsPerSync`, per-wallet sync states |
| `GET /api/activity/events` | Filters `walletId`, `tokenId`, `eventType`; paginated, newest first, includes wallet + token info and all decoding/breakdown fields |
| `POST /api/activity/resync` | Same body/validations as sync; clears ONLY the selected wallets' events + cursors (under the sync lock), then re-fetches so history is re-decoded. This is THE way to upgrade `decoderVersion: 1` rows — raw payloads are not stored, so in-place re-decoding is impossible by design (do not guess). |
| `POST /api/focus-cohorts` | Create a user-selected wallet group: exactly one `PRIMARY`, ≤ 9 `COMPARISON`, no duplicate wallet, dev wallets rejected, unique name. Never syncs/reconstructs/analyzes. 400 `exactly_one_primary_required` / `duplicate_member` / `too_many_members` / `unknown_wallet` / `dev_wallet_excluded`, 409 `duplicate_cohort_name` |
| `GET /api/focus-cohorts` | Paginated, stable creation order (never ordered by any result) |
| `GET /api/focus-cohorts/:id` | Members in PRIMARY-then-user-order, plus per-member `readiness` (sync completeness, stored events, reconstruction/quality/fingerprint status, eligible cycles, `missingPrerequisites`, `canAnalyze`). Reading readiness never creates work |
| `PATCH /api/focus-cohorts/:id` | Rename / re-note / replace membership (same rules) |
| `DELETE /api/focus-cohorts/:id` | Deletes ONLY the cohort + its membership rows. No wallet, event, position, quality record or fingerprint is ever deleted |
| `POST /api/wallet-strategies/analyze` | Body `{ walletIds: string[] (1–10, 1–3 recommended) }`. Requires each wallet's latest COMPLETED reconstruction; never reconstructs, syncs, re-decodes, backfills or runs quality analysis. In-process lock (409 `analysis_in_progress`), per-wallet failure isolation, sanitized 500 `strategy_analysis_failed`. Historical runs are retained |
| `GET /api/wallet-strategies` | Latest COMPLETED fingerprint per wallet; paginated; stable `trackedWalletId` order — never a ranking |
| `GET /api/wallet-strategies/:walletId` | Latest completed fingerprint + pattern rows (404 `strategy_fingerprint_not_found`) |
| `GET /api/wallet-strategies/:walletId/patterns` | Same, filterable by `patternType` |
| `GET /api/wallet-strategy-runs/:id` | Historical audit run detail |
| `POST /api/focus-wallets/prepare` | Body `{ walletIds: string[] (1–5), syncTransactionLimit? (default 500), continueHistoricalSync?, forceRefresh? }`. User-triggered only. Orchestrates `syncWallet` → `reconstructWallets` → `analyzeWallets` → `analyzeStrategies` sequentially per wallet, reusing each service function directly (no HTTP self-calls, no duplicated math, no new migration). Per-stage skip-when-current logic; later stages `NOT_STARTED` when an earlier required stage failed; per-wallet in-process lock (409 `wallet_prepare_in_progress`); per-wallet failure isolation (a defense-in-depth catch in the batch loop guarantees one wallet's failure can never abort the others) |
| `POST /api/slow-cook/analyze` | Body `{ walletIds: string[] (1–10), lookbackDays? (default 30), minimumWallets? (default 1), limit? (default 20), includeLowerConfidence? (default false) }`. Read-only and strictly scoped to the requested wallet IDs — never syncs, reconstructs, analyzes, fingerprints, or calls a provider. 400 `validation_error` / `duplicate_selection` / `unknown_wallet` / `dev_wallet_excluded`; sanitized 500 `slow_cook_analysis_failed`. Returns Wallet Style Memory per wallet plus deterministic candidates, all stamped `calculationVersion: "slow-cook-v1"`, each with a `paperPreview` (action, conviction, open position ID + unrealized return) from the FOMO Simulator mapping |
| `POST /api/fomo-simulator/calls` | Body `{ tokenId, walletIds: string[] (1–10), lookbackDays?, minimumWallets?, limit?, includeLowerConfidence?, simulatedAmountUsd? ($1–$1,000,000, default 100), assumptions? { feeRatePct?, entrySlippagePct?, exitSlippagePct? } (0–25%) }`. No `action` field — the action is always backend-derived. Revalidates Slow Cook server-side against current data. 400 `validation_error` / `duplicate_selection` / `unknown_wallet` / `dev_wallet_excluded` / `unknown_token`; 409 `duplicate_call` (with `paperCallId`) / `stale_analysis`; sanitized 500 `paper_call_failed` |
| `GET /api/fomo-simulator/calls` | All recorded calls, newest first, with the frozen evidence snapshot parsed out |
| `GET /api/fomo-simulator/positions` | All paper positions, newest-opened first |
| `GET /api/fomo-simulator/positions/:id` | One position with its full call history and valuation history (404 `position_not_found`) |
| `POST /api/fomo-simulator/positions/:id/refresh` | Reads only the latest already-stored `TokenMarketSnapshot`; idempotent per snapshot. Returns `valuationCreated` and a plain-language `skippedReason` when nothing new was applied (404 `position_not_found`, sanitized 500 `refresh_failed`) |
| `GET /api/fomo-simulator/summary` | Scorecard: net/realized/unrealized P/L, open/closed trade counts, win rate (`null` until a priced trade closes), high-conviction P/L subtotal, per-action call counts |

There is deliberately **no** ranking, leaderboard, top-wallet, best-wallet or
ownership-inference endpoint, and none may be added.

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
- web (29, vitest + jsdom + @testing-library/react, config
  `apps/web/vitest.config.ts`, fixtures use synthetic addresses only):
  wording (exact buy/sell/transfer sentences, unknown-quote and unknown-
  activity strings, all three confidence texts + legacy), mode (simple
  default, persistence, switch without reload), resync modal (naming, scope
  explanation, explicit confirm, Escape), sidebar (future features disabled
  and labeled), EventList (simple sentences + details expansion + empty state;
  quant exact decimals), TokensPage dev-record hiding + reveal, page smoke
  renders (Overview simple/quant, Wallets, Activity, Help).
- api (71): Phase 1A suites (health, RPC sanitization, wallet CRUD, import,
  seed); overview / activity summary / includeDev filtering (4); provider
  mapping incl. swap events/instructions/retries/key-leak sanitization (6);
  classification paths — decoded buys/sells, token→token,
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
- UI (Phase 1D-A): no browser-automation tests — rendering is verified via
  jsdom component tests; visual/mobile layout was checked via responsive CSS
  only. Tooltips use `title`/expandable sections, not a custom tooltip system.
  Sync progress has no live indicator (request is synchronous). The mode
  toggle affects presentation only — all data comes from the same endpoints.
- Dev-record hiding is a client-side default (`includeDev=false` param);
  the API without the param behaves exactly as before.

---

## Phase 1D-B1 — Current token market snapshots

### Provider selection

- **Selected provider: DexScreener.** Chosen because its public token endpoint
  returns Solana token/pair data (price USD + native, liquidity, market cap,
  FDV, multi-window volume, txn counts, price changes, pair address, DEX, base/
  quote tokens) in one call, with **no API key required** — so the app needs no
  new secret and boots without provider configuration.
- **Official documentation consulted:** https://docs.dexscreener.com/api/reference
  (accessed **2026-07-11**). Endpoint used:
  `GET https://api.dexscreener.com/tokens/v1/{chainId}/{tokenAddresses}`
  ("Get one or multiple pairs by token address"), documented **rate limit 300
  requests/minute**, `securities: []` (no auth). Up to 30 comma-separated
  addresses per call. The live response schema was inspected once to confirm
  field names/types; no unofficial sources were relied upon.
- **Authentication:** none required for the selected endpoint. No provider
  secret exists; if a future provider needs one it must live backend-only (never
  a `VITE_` variable), like the Helius key.

### Env / configuration

- `MARKET_DATA_PROVIDER` (default `dexscreener`; `none` disables lookups).
  Backend-only. Added to `.env.example`. No credential.

### Provider architecture (`apps/api/src/providers/market/`)

- `types.ts` — provider-neutral `MarketPairCandidate` / `MarketLookupResult`.
  All financial values are **exact decimal strings** or null (never zero).
- `errors.ts` — `MarketProviderError` (codes `not_configured`, `rate_limited`,
  `timeout`, `network_error`, `bad_request`, `malformed_response`,
  `provider_error`; `retryable` flag). Messages are generic — never URLs/keys.
- `marketDataProvider.ts` — `MarketDataProvider` interface (`isConfigured()`,
  `lookupTokens(mints)`), fetch-injectable for tests.
- `dexscreenerProvider.ts` — the only DexScreener-aware file. Maps raw pairs
  defensively (`mapRawDexscreenerPair`, exported for tests): malformed numbers →
  null, negative/non-integer txn counts → null. Batches ≤30 mints/call,
  attributes each pair to the requested mint whether it is base or quote.
  Bounded timeout (15s), retry with capped backoff on 429/5xx/network/timeout,
  respects `Retry-After`, **no retry on permanent 4xx**.
- `providerFactory.ts` — `createMarketDataProvider(name)` → DexScreener or an
  unconfigured stub for `none`/unknown.
- `pairSelection.ts` — deterministic `selectBestPair(mint, candidates)`:
  Solana-only, must contain the mint and have a pair address; dedupes by pair
  address; prefers base-side priced pairs ranked liquidity → 24h vol → 1h vol →
  pairCreatedAt → quote preference (SOL, then USDC/USDT) → pairAddress. A
  base-side pair with no parseable price is kept as `no_parseable_price`
  (identity only). If the mint appears **only as the quote token**, returns
  `token_only_appears_as_quote` (identity preserved, **price never inverted**).
  Confidence: HIGH (price+liquidity+24h vol), MEDIUM (price + one), LOW (price
  only), UNKNOWN.

### Normalization & market cap vs FDV

- `services/tokenMetrics/normalization.ts` builds snapshot fields from the
  selected pair. **Market cap and FDV are stored strictly separately** — FDV is
  never substituted for market cap. `priceSol` is set only when the selected
  pair's quote is wrapped SOL (else null; `priceNative` in non-SOL units is not
  a SOL price). Status: `COMPLETE` requires price + liquidity + 24h volume +
  (market cap or FDV); otherwise `PARTIAL`; `NOT_FOUND` / `ERROR` for no-pair /
  provider-failure. Unknown fields are null.

### Refresh engine (`services/tokenMetrics/refreshTokenMetrics.ts`)

- `MAX_TOKENS_PER_REFRESH = 20`. Module-level lock
  (`tryAcquireRefreshLock`/`releaseRefreshLock`, owned by the route in a
  try/finally). One provider batch lookup happens **before** any DB writes — no
  transaction is held open across HTTP. One snapshot row per requested token per
  run (enforced by `@@unique([refreshRunId, tokenId])`). A provider failure
  writes `ERROR` snapshots for every token instead of aborting the run
  (per-token isolation). Token `name`/`symbol` are filled **only when currently
  null** — provider data never overwrites curated metadata. Run status:
  `COMPLETED` (no errors; NOT_FOUND is an answer), `PARTIAL` (some errors),
  `FAILED` (all errors).

### Freshness (`services/tokenMetrics/freshness.ts`)

- Single source of truth. `FRESH_MAX_AGE_SECONDS = 300` (5 min),
  `AGING_MAX_AGE_SECONDS = 3600` (60 min). Categories `FRESH`/`AGING`/`STALE`/
  `NEVER_FETCHED`/`UNKNOWN`, computed from the latest usable (COMPLETE/PARTIAL)
  snapshot's `observedAt`. DexScreener exposes no observation timestamp, so
  `observedAt = fetchedAt`. Manual snapshots are never labeled "live".

### Database models (migration `20260712043845_token_market_snapshots`, additive)

- `TokenMarketRefreshRun`: id, provider, status (RUNNING/COMPLETED/PARTIAL/
  FAILED), startedAt, completedAt?, requested/processed/complete/partial/
  notFound/error/snapshot counts, sanitizedErrorSummary?, timestamps.
  Index: `startedAt`.
- `TokenMarketSnapshot`: id, tokenId, refreshRunId, observedAt, fetchedAt,
  priceUsd?, priceSol?, marketCapUsd?, fdvUsd?, liquidityUsd?, volume{5m,1h,6h,
  24h}Usd?, buys/sells{5m,1h,6h,24h}?, priceChange{5m,1h,6h,24h}Pct?,
  pairAddress?, dex?, baseMint?, quoteMint?, tokenName?, tokenSymbol?, source,
  status (COMPLETE/PARTIAL/NOT_FOUND/ERROR), confidence (HIGH/MEDIUM/LOW/
  UNKNOWN), selectionReason?, sanitizedErrorCode?, timestamps. **Financial
  values are stored as exact decimal STRINGS** (SQLite has no Decimal; strings
  avoid float loss). Unique `[refreshRunId, tokenId]`; indexes on
  `[tokenId, observedAt]`, `[tokenId, fetchedAt]`, `refreshRunId`, `source`,
  `status`, `observedAt`. Both cascade-delete with their parent.
- No changes to Wallet/WalletEvent/WalletSyncState. `Token` gains only the
  additive `marketSnapshots` relation; name/symbol are existing nullable fields.

### API routes (`routes/tokenMetrics.ts`)

- `POST /api/token-metrics/refresh` — body `{ tokens: string[] (ids or mints,
  1–20), includeDev?: boolean }`. Rejects empty (400 validation), duplicates
  (400 `duplicate_selection`), >20 (400), unknown/invalid mints (400
  `unknown_token`/`invalid_mint_address`), dev tokens without includeDev (400
  `dev_token_excluded`), includeDev in production (403). 503 if provider
  unconfigured, 409 `refresh_in_progress` if locked. Returns run id + totals
  (requested/processed/complete/partial/notFound/failed/snapshotsInserted/
  duplicatesPrevented) + per-token results (mint, status, confidence, pair, dex,
  observedAt, sanitizedErrorCode). No raw payloads.
- `GET /api/token-metrics` — latest usable snapshot per token, with freshness.
- `GET /api/token-metrics/:mint/latest` — latest + latestUsable + freshness/age
  (404 unknown token).
- `GET /api/token-metrics/:mint/snapshots` — paginated history.
- `GET /api/token-metrics/refresh-runs/:id` — run totals + per-token snapshots.
- `GET /api/tokens` extended: `withMarket=true` attaches the latest snapshot
  (absent = unchanged legacy shape), `marketData=with|without` filters,
  `sort=marketCap|liquidity|volume24h|lastCollected` (descending, unknown last).
  `includeDev=false` preserved.
- `GET /api/overview` extended with a `market` block: nonDevTokens, withSnapshots,
  neverRefreshed, fresh/aging/stale, partialLatest, lastSuccessfulRefreshAt,
  lastRunStatus.

### Tokens page — Simple Mode

Market cards per token with humanized USD/percent values and plain-language
explanations (market cap, FDV, liquidity, volume, price change, freshness as
tooltips). "Market data has not been collected for this token yet." when no
snapshot; "Not reported by the selected provider." for missing fields (never a
bare dash, never zero). Selection controls: per-token checkbox, "Select visible
tokens", "Clear selection", `n/20 selected`, refresh button disabled with no
selection / while busy, completion totals. No refresh-all. No good/bad/safe/
buy/sell/early/late language.

### Tokens page — Quant Mode

Exact decimal strings verbatim (price USD/SOL, market cap, FDV, liquidity, all
volume/txn/price-change windows), pair address, base/quote mint, DEX, provider,
status, confidence, selection reason, observed/fetched, age, freshness, plus the
existing discovery fields (stage, source, discovered, last seen). Table scrolls
horizontally. Missing values show "unknown", never zero.

### Testing (Phase 1D-B1)

- API +64 (135 total): DexScreener mapping/decimal preservation/malformed
  coercion (dexscreenerProvider.test), retries/Retry-After/timeout/permanent-400/
  sanitization, provider factory, pair selection + tie-breaking + quote-side +
  normalization (pairSelection.test), refresh engine (empty/dup/>20/unknown/dev/
  includeDev/production, COMPLETE/PARTIAL/NOT_FOUND/ERROR, run totals, per-token
  isolation, lock release, dup-snapshot constraint, metadata-fill policy,
  read routes), tokens+overview market integration, freshness classification.
- Web +13 (42 total): no-market-data wording, missing-field wording, market
  cap/FDV/liquidity explanations, freshness display, selection/select-visible/
  clear, refresh disabled/loading, complete + partial results, rate-limit
  wording, dev hidden-by-default + reveal, Quant exact decimals + "unknown".
- Shared unchanged (22). All providers mocked; no real network in automated
  tests; synthetic mints only.

### Manual verification performed (2026-07-12)

- Booted API + web. Refreshed **exactly 2 real activity-discovered tokens**
  against live DexScreener. Both returned PARTIAL/MEDIUM (liquidity genuinely not
  reported by the provider → stored null, not zero). Compared one snapshot field-
  by-field with a direct DexScreener call: priceUsd, priceNative (priceSol),
  marketCap, fdv (equal for that token but stored separately), 24h volume, DEX,
  quote mint, selection reason all matched exactly; freshness FRESH; observedAt
  present. Verified overview market counts updated (withSnapshots 2, fresh 2,
  partialLatest 2, lastRunStatus COMPLETED) and error states (empty 400,
  duplicate_selection, invalid_mint_address). Frontend served (`<title>` check).
  **Browser checks:** only served-page / jsdom-level; no browser-automation was
  run — Simple/Quant rendering is covered by jsdom component tests, and mobile
  layout relies on the existing responsive CSS (not visually verified here).

### Database before/after (Phase 1D-B1)

- TrackedWallet 1024 → 1024 (unchanged); WalletEvent 86 → 86 (unchanged);
  WalletSyncState 1 → 1 (unchanged); Token 65 → 65 (no creates/deletes);
  TokenMarketSnapshot 0 → 2 (added); TokenMarketRefreshRun 0 → 1 (added).

### Known limitations (Phase 1D-B1)

- Snapshots are point-in-time; no historical candles or post-entry outcomes
  (Phase 1D-B2). Manual refresh only — no scheduling/polling/background workers.
- DexScreener has no observation timestamp, so `observedAt = fetchedAt`.
- Pair selection needs the mint as the base token for prices; quote-only tokens
  are PARTIAL with no price (no inversion). Cross-pool aggregation is never done.
- Financial values are decimal strings (exact) — consumers must not coerce to
  Number where precision matters.
- Refresh lock is in-process (single-user local API); concurrent refresh → 409.

### Security notes

- No provider secret exists or is required; nothing market-related reaches the
  frontend as a secret. Provider errors are sanitized to codes; request URLs,
  headers, and raw payloads are never logged or returned. `MARKET_DATA_PROVIDER`
  is backend-only.

## Phase 1D-B2 completion

- Provider: GeckoTerminal keyless public Solana pool OHLCV API. Official
  keyless/API and pool-OHLCV references were consulted 2026-07-12. No auth;
  current public limits are dynamic IP throttling. Supported app intervals:
  1m/5m/15m/1h. Provider pages are capped at 1,000 and service pagination at
  10 pages; app ranges are capped at 3/14/30/180 days respectively.
- Additive migration `20260712154023_historical_market_candles` adds
  `HistoricalMarketBackfillRun`, `TokenMarketCandle`, and
  `WalletEntryOutcome`. Candle uniqueness is token+pair+interval+open+source;
  outcomes are unique by event+calculation version. Exact values are strings.
- Pair identity comes only from the latest usable current snapshot. Re-fetches
  update corrections idempotently; gaps remain missing (never invented,
  interpolated, or forward-filled). HTTP calls occur outside transactions.
- Manual backfill requires 1–5 explicit tokens, interval, start, and end; dev
  tokens are excluded by default. Retry/backoff is bounded, Retry-After is
  honored, permanent 4xx is not retried, and failures are isolated/audited.
- Eligible confirmed/likely BUY outcomes use the first 1m candle at/after the
  event and its open as an estimated entry. Version 1 computes 1m/5m/15m/30m/
  1h/4h/24h returns plus 1h/24h extrema and time-to-max using only post-event
  candles. Missing coverage produces PARTIAL/UNAVAILABLE; confidence follows
  completion and entry-delay rules. WalletEvent is never changed.
- API routes: historical backfill/candles/coverage/run audit and outcome
  calculate/list/by-event. Overview reports candle and outcome totals.
- UI: Tokens has bounded controls and coverage (including gaps); Activity has
  a collapsed eligible-BUY-only outcome panel; Overview has historical totals.
  Simple Mode explains approximation/warnings; Quant Mode preserves decimals.
- Verification: shared 22, API 176, web 55 = **253 tests**; lint and production
  build pass. All five frontend routes were served locally; behavioral rendering
  is jsdom-tested (no automated browser screenshots).
- Manual bounded sample: exactly 2 real non-development tokens, `1m`,
  2026-07-10 20:00Z → 2026-07-11 22:00Z (26 hours). GeckoTerminal returned 255
  candles and 1,977 omitted intervals, so both series correctly reported
  PARTIAL. Exactly 2 eligible BUY events were calculated, both PARTIAL
  (MEDIUM/LOW). One entry candle was compared directly with GeckoTerminal at
  Unix 1783719840: open/high/low/close/volume matched exact stored strings.
  Final database: 1024 wallets, 86 events, 65 tokens, 1 sync state, 2 current
  snapshots, 1 current refresh run, 255 candles, 1 backfill run, 2 outcomes.
- Known limits: keyless availability/rate limits are not production SLAs;
  provider tracking can begin after pool creation; inactive intervals are
  omitted; candle entry is not execution price; no scheduler/chart/ranking.
  Provider credentials/raw responses never reach the frontend.

## Exact next checkpoint

**Phase 2C-B — Related-wallet funding relationships, shared-entry timing
evidence, leader/follower sequencing, and non-accusatory relationship
heuristics.** Do not begin it implicitly.

## FOMO Simulator V1 implementation notes

- Paper-calls-only checkpoint layered directly on Slow Cook V1. It never
  connects a wallet, signs anything, executes a real trade, offers a
  copy-trading button, manages a portfolio, monitors in the background, or
  trains an ML model. **Historical backtesting is explicitly a later,
  not-yet-built phase** — the scorecard covers only calls this feature has
  itself recorded going forward, never a retroactive replay of history.
- Migration `20260713054018_add_fomo_paper_calls` (additive; zero DROP or
  DELETE statements). Models: `PaperCall`, `PaperPosition`,
  `PaperPositionValuation`.
- **The action is derived on the backend only.** `services/fomoSimulator/mapping.ts`'s
  `derivePaperAction(state, confidence, hasOpenPosition)` is a fixed lookup —
  no scoring, no randomness. The request schema
  (`routes/fomoSimulator.ts`'s `recordCallSchema`) simply has no `action`
  field, so there is nothing for a compromised or buggy frontend to inject;
  a dedicated test (`calls.test.ts`, "ignores a frontend-provided fake
  action entirely") posts an extra `action` field in the body and confirms
  it is silently ignored.
- **Recording a call always revalidates Slow Cook server-side.**
  `services/fomoSimulator/recordCall.ts`'s `recordPaperCall` calls
  `analyzeSlowCook` internally with the exact requested wallet IDs and
  settings, then looks up the candidate for the requested token in that
  fresh result — it never trusts a frontend-supplied candidate object. If
  the token no longer appears (evidence moved on since the user last saw
  it), the request is rejected as 409 `stale_analysis` rather than acting on
  stale evidence.
- **Cohort identity is sorted, deduplicated wallet IDs** (`cohortKeyFor`),
  never labels or selection order — the same underlying wallet set always
  produces the same cohort key and therefore the same open-position lookup,
  regardless of how the user re-orders their selection.
- **Dedupe key is a SHA-256 hash of real inputs** (`dedupeKeyFor`): token ID,
  cohort key, derived action, latest selected-wallet evidence timestamp,
  entry snapshot ID, methodology version — never a random value or a bare
  timestamp. A byte-identical repeated request (same evidence, same
  snapshot) collides on the unique `dedupeKey` column and returns 409
  `duplicate_call` with the existing call's ID; nothing new is created.
- **Every `PaperCall` freezes an immutable evidence snapshot**
  (`frozenEvidence()` in `recordCall.ts`): wallet IDs/addresses/labels as of
  that moment, each wallet's style-memory summary, the candidate's
  `whyThisAppeared`/`whatCouldInvalidate` reasons, its evidence dimensions,
  data quality, and the exact Slow Cook settings used for the revalidation.
  A dedicated test edits a wallet's label after recording a call and
  confirms the stored `walletLabelsJson` on the existing `PaperCall` is
  untouched — only a *new* call would pick up the new label.
- **Position lifecycle** is enforced entirely inside `recordPaperCall`: BUY
  opens exactly one `PaperPosition` (an open position for the same token +
  cohort + `fomo-sim-v1` methodology is looked up first via
  `findOpenPosition`, so a second BUY is structurally impossible while one
  is open); HOLD appends a call and calls `refreshPositionValuation` but
  never opens a second position; EXIT appends a call and closes the position
  with realized P/L in the same transaction; AVOID/NO_TRADE only ever create
  a call row (optionally linked to an existing open position for call
  history) and never touch a position's P/L.
- **Pricing eligibility** (`services/fomoSimulator/pricing.ts`) is built on
  the existing centralized freshness rules
  (`services/tokenMetrics/freshness.ts`), not a new set of thresholds:
  `FRESH` → priced, `AGING` → priced with a visible `AGING_SNAPSHOT` warning
  code, `STALE`/`UNKNOWN`/`NEVER_FETCHED` → not priced. `freshnessOf()`
  already treats a future-dated `observedAt` as `UNKNOWN`, which this reuses
  directly — no separate future-date check was needed, and a test pins a
  future-dated snapshot being rejected. An unpriced BUY is recorded
  (`priced: false`, `unpricedReason: UNPRICED_BUY_REASON`) and opens no
  position — it is never revisited and back-filled with a later price. An
  unpriced EXIT is recorded (`unpricedReason: EXIT_PENDING_REASON`) and the
  position's `exitSignalPendingReason` is set while `status` stays `OPEN` —
  a later refresh or EXIT call is required to actually close it; it is
  never silently closed at a future price.
- **Simulation math** (`services/fomoSimulator/math.ts`) reuses the
  project's existing `D()`/`exact()` `decimal.js` helpers from
  `services/walletPositions/math.ts` (precision 48, ROUND_HALF_UP) rather
  than introducing a second decimal configuration. `computeEntry`,
  `computeExitValue` (also reused by `refresh.ts` for unrealized
  valuations — "what would this be worth if exited now?"), and `computePl`
  are pure functions with no I/O. A manual zero-cost check (0% fee, 0%
  slippage, $100 at $0.001 entry / $0.002 exit) was used to confirm the
  formulas by hand: exactly 100,000 tokens opened, exactly $100 realized
  P/L, exactly 100% return.
- **Refresh is idempotent per snapshot.** `refreshPositionValuation` compares
  the latest stored snapshot's `observedAt` against the position's most
  recent `PaperPositionValuation.observedAt`; an equal-or-older snapshot is
  a no-op with a plain-language `skippedReason`, and the
  `[positionId, snapshotId]` unique constraint is a second line of defense
  against a duplicate row. Prior valuation rows are never updated or
  deleted — `GET /api/fomo-simulator/positions/:id` returns the full
  ordered history.
- **Scorecard denominators are deliberately narrow**
  (`services/fomoSimulator/summary.ts`): win rate divides winning closed
  positions by closed positions that actually have a `realizedPlUsd` (a
  closed-but-never-priced position, which cannot currently occur since EXIT
  only closes on a priced snapshot, is still excluded defensively). HOLD
  events never create or count as a separate "trade" — they only refresh an
  existing position's valuation. AVOID/NO_TRADE calls and unpriced BUYs
  never appear in `openTradeCount`/`closedTradeCount` because they never
  created a `PaperPosition` row at all. High-conviction P/L looks up
  positions whose *opening* BUY call had `conviction: 'HIGH'` (joined via
  `paperPositionId`), not the position's current/latest call — a position
  that later gets a MEDIUM-conviction HOLD stays counted under its original
  HIGH-conviction open.
- Frontend: `#/fomo-simulator` sits in `SIMPLE_NAV` directly after `slow
  cook` and in `QUANT_NAV`, plus an `AdvancedPage.tsx` directory entry
  (`apps/web/src/components/Sidebar.tsx`). `lib/fomoWording.ts` is
  display-only formatting (`paperActionHeadline`, `formatPlUsd`,
  `formatReturnPct`, `plClass`) — it never derives an action itself, only
  formats what the backend already decided. `SlowCookPage.tsx`'s candidate
  cards read `candidate.paperPreview` (added server-side in
  `routes/slowCook.ts`) to show "Paper call preview: `<ACTION>` —
  `<CONVICTION>` CONVICTION" and either a configurable-amount "Simulate
  trade" button (fresh BUY) or "Record paper call" plus an "Open paper
  trade: `<return>`%" line (existing open position), and posts straight to
  `POST /api/fomo-simulator/calls` with the same wallet/setting values used
  for the Slow Cook query — the frontend never assembles or re-derives the
  action.
- Verification: shared 22, API 352 (297 + 55 new — 20 pure mapping/math
  unit tests in `test/fomoSimulator/mapping.test.ts`, 35 integration tests
  in `test/fomoSimulator/calls.test.ts`), frontend 180 (154 + 26 new — 21 in
  `test/fomoSimulator.test.tsx`, 5 new in a "FOMO Simulator paper-call
  integration" describe block in `test/slowCook.test.tsx`) = **554 tests**;
  lint and build pass.
- Manual verification: a **temporary copy** of `prisma/dev.db` (never the
  live database) was used to run a full BUY → HOLD → EXIT → AVOID →
  NO_TRADE → dedupe-retry sequence through the actual compiled service
  functions (`recordPaperCall`, `refreshPositionValuation`,
  `buildFomoSummary`). Confirmed exact math (a zero-cost $100 BUY at $0.001
  opened exactly 100,000 tokens; the matching EXIT at $0.002 produced an
  exact $100 realized P/L and 100% return), confirmed HOLD never duplicates
  a position, confirmed refresh idempotency, confirmed the dedupe key blocks
  an identical repeated call, and confirmed the scorecard aggregates
  correctly. The temporary database was deleted afterward. Row counts for
  `TrackedWallet`, `WalletEvent`, `WalletSyncState`,
  `WalletPositionReconstructionRun`, `WalletQualityAnalysisRun`,
  `WalletStrategyFingerprintRun`, `Token`, and `TokenMarketSnapshot` in the
  real `prisma/dev.db` were identical before and after this entire phase
  (including after the schema migration itself), and the new
  `PaperCall`/`PaperPosition`/`PaperPositionValuation` tables in the real
  database remain empty (0 rows) — no fake paper-call data was ever written
  to the live database. `PRAGMA integrity_check` returned `ok`.

## Slow Cook V1 implementation notes

- Read-only research checkpoint, not part of the Phase 2C-B roadmap track.
  No migration: `apps/api/src/services/slowCook/{styleMemory,candidates,analyze}.ts`
  are a pure read layer over existing `WalletEvent`, `WalletPosition`,
  quality-metric, and fingerprint tables — nothing is written, and no
  provider is called.
- **Scope is enforced at every query.** `buildWalletStyleMemories` and
  `buildSlowCookCandidates` both take the explicit `walletIds` array as their
  only source of wallet identity; every Prisma query filters
  `walletId: { in: walletIds }`. There is no "analyze every wallet" mode and
  no code path that widens the set after validation in `routes/slowCook.ts`
  (which itself 400s on unknown wallet IDs, duplicate wallet IDs, and
  dev-seed wallets before the service ever runs).
- **Wallet Style Memory V1 is deterministic re-surfacing, not ML.** It reuses
  the shared currentness helpers (`services/walletResearch/currentness.ts`,
  the same ones the BN audit extracted) to find each wallet's own latest
  *current* reconstruction/quality/fingerprint, then copies exact stored
  fields into plain-language sentences built from the fingerprint's own
  descriptor codes. Each wallet's `WalletStyleMemory` is built and returned
  independently — styles are never combined, averaged, or blended across
  wallets, and the UI states this explicitly ("styles are never averaged
  together"). `evidenceStateFor()` maps a null/too-small eligible-cycle count
  straight to `INSUFFICIENT`, which produces the fixed fallback sentence
  ("Not enough clean completed trades are available to describe this wallet
  reliably.") instead of guessing.
- **Candidate states are evaluated in one fixed, documented order** in
  `classifyState()` (`services/slowCook/candidates.ts`): selling ≥ buying (or
  a same-wallet quick flip) → `DISTRIBUTION_RISK`; repeat buys with zero
  detected selling → `BUILDING`; an open reconstructed position with zero
  selling → `HOLDING`; wallets pulling in opposite directions → `MIXED`;
  activity older than 66% of the lookback window → `COOLING`; otherwise
  `INSUFFICIENT_EVIDENCE`. The first matching rule wins — states are mutually
  exclusive by construction, not by post-hoc filtering.
- **Confidence is evidence strength, never a profit probability.**
  `computeConfidence()` sums four bounded, documented components — wallet
  count (0–50), style-evidence sufficiency (0–20), reconstruction currentness
  (0–20), and market-snapshot freshness (0–10) — minus a contamination
  penalty for transfer-affected or unmatched-sell evidence, clamped to
  0–100. `confidenceLevel()` maps ≥70 to `HIGHER`, ≥40 to `MODERATE`, else
  `LOW`. A small wallet sample or stale research structurally caps the score
  well below 70, so `HIGHER` is unreachable without both a real sample and
  current research — this is enforced by the formula's shape, not a special
  case. Every component is exposed in `confidenceComponents` for Quant Mode.
- **The 7th state, "NO TRADE," is frontend-only.** `lib/slowCookWording.ts`'s
  `slowCookHeadline(state, confidence)` maps `LOW` confidence or
  `INSUFFICIENT_EVIDENCE` state to the literal headline "NO TRADE", and
  `HIGHER` confidence to a "HIGH-CONVICTION " prefix on the state's own
  headline. The backend's `CandidateState` enum has no matching value — this
  keeps the backend strictly evidence-based while giving Simple Mode a
  direct one-line answer.
- **No guaranteed-profit or automatic-trading language anywhere.** The page
  states outright: "This is research, not a trading system. It never
  connects a wallet, never signs anything, never buys or sells, and never
  guarantees a profit. Historical behavior does not predict a wallet's next
  action." Confidence text always ends "Not a profit probability."
  `test/slowCook/analyze.test.ts` includes a dedicated assertion that this
  banned language never appears in any response.
- Frontend: "Slow Cook" sits in `SIMPLE_NAV` between `tokens` (Coin Check)
  and the disabled `alerts` entry, and in `QUANT_NAV` before Help
  (`apps/web/src/components/Sidebar.tsx`), plus a directory entry on
  `AdvancedPage.tsx`. `SlowCookPage.tsx` reuses `useWalletSearch` and
  `WalletLabel` exactly as the other wallet pickers do (search, pinned
  selections, distinct-by-address duplicate labels, no auto-selection).
  Methodology version, confidence score/components, and IDs are gated behind
  `mode === 'quant'`, matching every other Quant-only detail table in the app.
- FOMO Simulator remains explicitly out of scope for this phase — not built,
  no route, no UI. Candidate objects already carry the fields it would need
  (token, state, evidence confidence, `analyzedAt`, selected wallet IDs,
  snapshot/market fields, `whyThisAppeared`/`whatCouldInvalidate` reasons,
  `calculationVersion`) so a later phase can consume them without a shape
  change, but no paper call is persisted anywhere yet.
- Verification: shared 22, API 297 (268 + 29 new), frontend 154 (132 + 22
  new) = **473 tests**; lint and build pass. The 29 new API tests
  (`test/slowCook/analyze.test.ts`) cover selection scoping/no-leakage,
  transfer-only exclusion, dev-wallet/dev-token exclusion,
  accumulation/distribution signals, duplicate-label distinctness,
  open-position representation, null-vs-zero handling, staleness, confidence
  ceilings for small samples, `MIXED`-state detection, per-wallet style
  separation, determinism, zero side effects (no provider calls, no DB
  mutations, no new analysis runs), banned-language absence, and validation
  errors. The BN Main audit was not redone or expanded in this phase.
- Manual verification: read-only `curl` calls against a running dev server
  for two real wallets — one with no usable research (correctly returned the
  `INSUFFICIENT` evidence state and an empty candidate list) and one with
  real fingerprint data (returned a correct style memory summary). Database
  row counts were identical before and after, and `PRAGMA integrity_check`
  returned `ok`.

## BN Main wallet readiness audit implementation notes

- Data-inspection checkpoint before Phase 2C-B, not an intelligence phase.
  No relationship, ownership, funding, or coordination inference was added.
- Live database as of this audit: **10** wallets labeled exactly `bn`
  (case-sensitive, non-development), **0** case-insensitive-only variants
  (no bare `BN`/`Bn`), **7** other labels containing `bn` (`bn trezor`,
  `bn new`, `bn NEW`, `bn multi`, `bn tiktok wallet...`, `cabal bn`,
  `trackabale BN`). All 10 exact-`bn` wallets share `group: "Main"`,
  `source: "import:json"`, `enabled: true`, `notes: null`, and near-identical
  `createdAt`/`updatedAt` timestamps (one bulk import) — the wallet record
  itself gives no distinguishing signal; only their address and downstream
  research state differ. `bn trezor` = `HBYkoojFkFX7NWuF2VcpDWNXEdGatfNE6mYLsR2udSzo`,
  confirmed unchanged. The previously-observed candidate
  `AECU4NWws6JnAmxzGPAgsrJ3cgJsbsWgXbqq9EjXtLgH` is confirmed still labeled
  exactly `bn` and — as of the live dev server's own independent activity
  during this session — now has real research (231 stored events, a CURRENT
  reconstruction, 26-cycle strategy sample). It is still only a candidate:
  BN Main remains unconfirmed by the user.
- `services/walletResearch/currentness.ts` exports the exact rules previously
  private to `services/focusWallets/prepareWallets.ts`
  (`latestCompletedReconstructionForWallet`, `latestCompletedQualityForWallet`,
  `latestCompletedFingerprintForWallet`, `reconstructionCoverage`,
  `isReconstructionCurrent`, `isQualityCurrent`, `isFingerprintCurrent`).
  `prepareWallets.ts` now imports from there instead of keeping private
  duplicates — its own 17 tests were re-run unchanged and still pass,
  confirming the extraction didn't alter preparation behavior.
- `readinessReport.ts`'s `RecordState` (`MISSING`/`RUNNING`/`FAILED`/`STALE`/
  `CURRENT`) is derived from TWO queries per record type: the latest
  *completed* one (via the shared currentness helpers, for the CURRENT/STALE
  distinction) and the latest record of *any* status touching that wallet
  (to detect `RUNNING`/`FAILED` — a run whose own `status` field is still
  `RUNNING`/`FAILED`/`PARTIAL` even though it already wrote a profile/metric-
  set/fingerprint row for this wallet). A `RUNNING` state is only observable
  via a raw concurrent DB read during an in-flight request — preparation and
  quality/fingerprint analysis are synchronous within one HTTP request, so in
  practice this state is rare, but the report handles it rather than
  crashing or lying.
- `apps/api/src/scripts/auditBnWallets.ts` (`npm run audit:bn-wallets`, or
  `npm run audit:bn-wallets -w apps/api` directly) is intentionally a plain
  script, not an HTTP route — there is no product reason to expose "find BN
  Main" as an API endpoint, and a route would need its own auth/rate-limit
  surface for no benefit. `--out <path>` optionally writes the full JSON
  report; default path is `local-reports/bn-wallet-audit.json`, newly added
  to `.gitignore` (live wallet research must never be committed).
- Test fixture note: `test/strategies/fixtures.ts`'s `seedWallet` helper
  *always* creates a `WalletSyncState` row, even with `withReconstruction:
  false` — a genuinely never-synced wallet for a MISSING-state test must be
  created directly via `prisma.trackedWallet.create`, not through
  `seedWallet`.
- Verification: shared 22, API 268 (249 + 19 new), frontend 132 = **422
  tests**; lint and build pass. No migration. The script itself was run
  read-only against the live dev database and confirmed to leave every
  table count and `PRAGMA integrity_check` unchanged.

## Beginner UX Simplification Pass implementation notes

- Frontend-only. No migration, no backend route, no financial calculation
  changed. `prisma/schema.prisma` and `prisma/migrations/` untouched.
- `apps/web/src/components/Sidebar.tsx`: `PageId` is now the union of every
  Simple-Mode page id and every Quant-Mode page id (`wallets`/`tokens` are
  shared literals, not duplicated pages). `SIMPLE_NAV` and `QUANT_NAV` are
  separate exported arrays; `PAGES` (used for hash-route validation only)
  includes every id from both so old bookmarks keep resolving, but
  deliberately excludes `alerts`/`my-positions` — those are not real routes,
  only disabled nav entries with a "Coming later" badge, mirroring the
  pre-existing Quant `FUTURE_FEATURES` pattern.
- `apps/web/src/App.tsx`: `pageFromHash(fallback)` takes the mode-appropriate
  default (`home` for Simple, `overview` for Quant) as a parameter, computed
  once at mount from `useMode()` (already synchronously hydrated from
  `localStorage` by `ModeProvider`, so there is no default-flash). Switching
  mode after mount never force-navigates away from the current page — only
  the *initial*, blank-hash landing differs by mode. The mobile `top-nav` in
  the topbar now renders the same mode-dependent list as `Sidebar`, so both
  breakpoints stay in sync.
- `apps/web/src/hooks/useWalletSearch.ts`: the fix for the wallet-picker
  first-page bug. Always calls `/api/wallets?search=...` (the backend already
  supported this — the bug was purely on the frontend). Keeps a
  `Map<id, Wallet>` cache across every result it has ever returned, exposed
  as `getWallet(id)`, so a selected wallet resolves correctly even after it
  drops out of the current search results. Selection state is intentionally
  NOT owned by the hook — each caller pins its own selected-but-not-shown
  wallets into its render list via `getWallet` (see `WalletIntelligencePage`,
  `FocusTraderLabPage`, `PrepareWalletPanel`, `LearnWalletPage` for the
  identical `pinned = [...selected].filter(...).flatMap(getWallet)` pattern).
  No debounce was added (`debounceMs` defaults to `0`) — at this wallet
  count a fetch-per-keystroke is simple, correct and keeps tests
  deterministic; the option exists if it's ever needed.
- `apps/web/src/pages/LearnWalletPage.tsx` and
  `apps/web/src/lib/prepareWording.ts` (`learnWalletSummary`,
  `BEGINNER_STAGE_NAME`) are additive — the existing `stageLabel`/
  `STAGE_REASON_TEXT` used by the Quant/Advanced `PrepareWalletPanel` were
  not touched, so its exact stage labels, reasons and IDs are unchanged.
- `test/bnSafety.test.tsx` is the single source of truth for the BN
  requirement: no code anywhere strings-matches on the literal label `bn` to
  assign a primary/main role, and `grep -rni "bn main"` across
  `apps/web/src` and `apps/api/src` returns nothing.
- Two vitest gotchas hit again while writing tests this pass (documented
  previously too): (1) always run frontend vitest from `apps/web` — running
  from the repo root gives `ReferenceError: window is not defined` since the
  jsdom environment is configured per-workspace. (2) `getByLabelText` can
  become ambiguous when a page's `<PageHeader subtitle>` text happens to
  contain the same phrase as an input's `aria-label`; prefer
  `getByPlaceholderText` or scope with `within()` when that happens.
- `apps/web/src/pages/WalletsPage.tsx` and `TokensPage.tsx`: the pre-existing
  Quant Mode JSX trees are reused as local `const` fragments
  (`importSection`, `addOneWalletSection`, `rawTableSection` /
  `snapshotSection`, `backfillSection`) so Quant Mode's exact original
  markup and behavior stay byte-for-byte reachable, while Simple Mode
  composes a different layout around the same state and handlers. Content
  inside a closed `<details>` stays in the DOM (not removed) — tests that
  need to assert something is genuinely hidden must check
  `details.hasAttribute('open')`, not just element absence.

## One-click Focus Wallet Preparation implementation notes

- No migration: `apps/api/src/services/focusWallets/{prepareWallets,prepareLock}.ts`
  are a pure orchestration layer calling `syncWallet`, `reconstructWallets`,
  `analyzeWallets` and `analyzeStrategies` directly — never their HTTP routes,
  never a duplicated calculation.
- Each stage's "already current" check queries the wallet-scoped latest
  completed record directly (not the existing all-wallets `latestXByWallet`
  helpers, which would be wasted work for a single wallet): reconstruction is
  current when `includedEventCount + excludedEventCount` summed over the run's
  positions equals the wallet's current stored-event count; quality is current
  when its `reconstructionRunId` matches; fingerprint is current when both its
  `reconstructionRunId` and `qualityMetricSetId` match.
- **Sync-skip design decision**: once a wallet's backfill is complete, sync is
  skipped as `already_current` unless `forceRefresh` or `continueHistoricalSync`
  is set. An earlier draft always re-attempted sync when already backfilled
  (to auto-catch-up on new activity), but that made the "skip when nothing
  changed" case impossible to distinguish from "there might be something new" —
  a real design conflict caught by a failing test, not a bug. The checkbox is
  the user's explicit signal to check again.
- Two Prisma-delegate test caveats confirmed again here (see also the Phase
  2C-A note): `vi.spyOn(prisma.X, 'method').mockRestore()` does not truly
  restore Prisma's proxy-generated method — it leaves it permanently broken.
  Tests needing a working client after a mocked failure use a **fresh**
  `buildTestApp()` sharing the same test database, not `mockRestore()`.
- Locks: the new per-wallet `prepareLock` (a `Set<string>`) is acquired for
  *every* requested wallet before any processing starts and released in the
  route's `finally`; it is distinct from each stage's own global single-flight
  lock (`tryAcquireReconstructionLock` etc.), which is acquired/released once
  per wallet per stage inside the sequential loop.
- Verification: shared 22, API 249, frontend 97 = **368 tests**; lint and
  build pass. No new migration, so `prisma/dev.db` model counts were expected
  to stay untouched by this work — a live dev server left running by the user
  during this session (not started by the assistant) synchronized two `bn`-
  labelled wallets independently, which is the explicitly anticipated
  "unless the user manually runs preparation later" exception; reconstruction/
  quality/fingerprint run counts were unaffected, and `PRAGMA integrity_check`
  remained `ok`.

## Phase 2C-A implementation notes

- Migration `20260712205856_focus_trader_strategy_lab` (additive; zero DROP or
  DELETE statements). Models: `FocusTraderCohort`, `FocusTraderCohortMember`,
  `WalletStrategyFingerprintRun`, `WalletStrategyFingerprint`,
  `WalletStrategyPatternMetric`.
- **Ownership is never established.** A cohort is a user-selected wallet group.
  Similar labels, shared funding, shared tokens and similar timing are all
  explicitly insufficient; every cohort response carries `OWNERSHIP_NOT_ESTABLISHED`
  (plus `POSSIBLE_SHARED_LABEL_ONLY` when members share a label prefix). The words
  insider, cabal, dev group, sniper, whale and coordinated manipulation appear
  nowhere in the product surface.
- `FocusTraderCohortMember.trackedWalletId` and
  `WalletStrategyFingerprint.trackedWalletId` deliberately have **no cascade**, so
  a cohort can never delete a wallet. (`resetDb` in `apps/api/test/helpers.ts`
  therefore clears the Phase 2C-A tables before `TrackedWallet`.)
- `services/walletStrategies/fingerprint.ts` is a pure, deterministic calculator
  (`decimal.js`, exact decimal strings, null never coerced to zero). Cycles come
  from `WalletPosition.includedEventIdsJson` resolved against `WalletEvent`, using
  each wallet's **latest completed** reconstruction only — runs are never combined.
- **Closure is judged from observed inventory, not the status label.** With an
  incomplete backfill every position is stamped `INCOMPLETE_HISTORY`, so defining
  "fully closed" as `status === 'CLOSED'` made fully-sold cycles look like ones the
  wallet "left open" (it produced a false `OFTEN_LEAVES_INVENTORY_OPEN` on real
  data). `fullyClosed = sells ≥ 1 && openTokenAmount === 0`; a regression test pins
  this.
- Fees = network + platform/router + tip. The priority fee is already inside the
  network fee and is **not** added again; rent is refundable and is not a trading
  loss. Any unknown component leaves the cycle's fees null.
- Descriptor thresholds live in `services/walletStrategies/descriptors.ts` and each
  emitted descriptor stores its formula, numerator/denominator, observed value,
  threshold, sample count, confidence and warnings in `descriptorEvidenceJson`.
- The 2.2 SOL reference bankroll is frontend-local (`lib/portability.ts`,
  `localStorage`) and is **never** persisted. The app does not know a wallet's
  historical bankroll and never infers allocation percentage from a balance.
- Analysis is bounded: explicit IDs, 1–10 wallets, duplicates/dev wallets rejected,
  in-process lock (released in `finally`), per-wallet failure isolation, sanitized
  500s (`strategy_analysis_failed`). Reads expose only the latest completed
  fingerprint per wallet; historical runs stay addressable by ID. No ranking,
  leaderboard, top-wallet or ownership-inference endpoint exists.
- Verification: shared 22, API 231, frontend 86 = **339 tests**; lint and build
  pass; `PRAGMA integrity_check` and `foreign_key_check` both ok.
- Manual verification (2026-07-12): searched labels beginning with `bn` through the
  normal API — 15 such wallets exist, **none has any synchronized activity or
  reconstruction**. Created exactly one cohort (`bn trezor` primary + 4 `bn`
  comparisons); readiness correctly reported `NOT_SYNCHRONIZED` /
  `NO_COMPLETED_RECONSTRUCTION` for all five and the analyze request was **refused**
  (`reconstruction_required`) rather than fabricating a fingerprint. A real
  fingerprint was calculated only for `mr phoof`, the one wallet with completed
  prerequisites: 11 eligible / 17 excluded cycles, 25 pattern rows, MEDIUM
  confidence, descriptors `MOSTLY_SINGLE_ENTRY` (9/11), `MOSTLY_SINGLE_EXIT` (8/8),
  `MOSTLY_SHORT_OBSERVED_HOLDS` (6/8), `VENUE_CONCENTRATED` (11/11),
  `POSITION_SIZES_CONCENTRATED`, `FEE_SENSITIVE_AT_SMALLER_BANKROLL` (1.539% median
  burden), `INCOMPLETE_HISTORY_SAMPLE`, `TRANSFER_AFFECTED_SAMPLE`. No wallet was
  synced, re-decoded, reconstructed or re-analyzed; original labels are unchanged.
  API routes were exercised over real HTTP and the Vite dev server served the new
  page module; detailed UI interaction is jsdom-tested, **not** browser-automated.

## Phase 2B implementation notes

- Migration `20260712180143_wallet_quality_metrics` adds quality analysis runs,
  metric sets, category rows, and time-window rows with latest-completed selection.
- Exact decimal summaries cover eligibility, result rates, median/mean/P25/P75,
  gross gains/losses, profit factor, concentration, holding/size behavior, and
  separately labeled historical candle outcomes. Zero denominators remain null.
- Sample tiers describe count only. Central warnings disclose incomplete history,
  low coverage, transfers, unmatched sells, missing fees, outlier dominance,
  partial outcomes, and insufficient category/recent/older samples.
- Categories are stable factual venue/router/size/holding/confidence/completeness
  groups; comparison preserves user order and never sorts by performance.
- Routes: bounded manual analyze, latest metric list/detail, category/time-window
  reads, and historical run detail. Overview and Help are extended.
- Verification: shared 22, API 189, frontend 61 = 272 tests; lint/build pass.
- Manual analysis: one existing partial-history wallet, no reconstruction/sync/
  decode/backfill. Latest set: 28 total, 0 eligible, 28 excluded, VERY_SMALL/LOW,
  15 categories, 3 insufficient windows, five explicit warnings. All six web
  routes served; detailed interactions are jsdom-tested, not browser-automated.

## Phase 2A implementation notes

- Migration `20260712172219_wallet_position_reconstruction`; models:
  reconstruction run, position, FIFO match, behavior profile. Unique run/wallet/
  token/cycle positions and unique position/buy/sell/sequence/version matches.
- `decimal.js` (48-digit precision) performs all financial arithmetic. Values
  persist as strings; no display rounding enters accounting.
- Eligible exact trades: v2 CONFIRMED/LIKELY, known token/time/positive quantity,
  known positive SOL or wSOL quote. Stablecoin/token quotes, legacy/unknown, and
  missing fields are excluded with centralized warning codes.
- FIFO allocation is proportional for buy cost/fees and sell proceeds/fees.
  Network + platform/router + tip are attributable; priority is not added again,
  rent/unrelated/unattributed are excluded. Transfers change inventory and basis
  confidence, never proceeds or zero-cost acquisition.
- Open valuation uses latest stored priceSol and priceUsd separately, carries
  provider snapshot identity/status/time/freshness, and warns stale/missing.
- Manual route is explicit, max 10, dev-excluded, locked, per-wallet isolated.
  Read APIs are bounded and default to chronology—not profitability.
- Wallet Intelligence is enabled with disclaimer, search/selection, run totals,
  profiles, warnings, positions, FIFO details, Simple/Quant modes, responsive
  layout, and localStorage-only 2.2 SOL reference bankroll.
- Confidence describes data completeness only. It is never profitability.
- Night Watch / Overnight Desk remains a later disabled roadmap concept after
  live signals, FOMO, token-risk analysis, and paper validation.
- Automated verification: shared 22, API 183, frontend 59 = 264 tests; lint and
  production build pass. SQLite integrity is checked separately.
- Manual verification used only synchronized wallet `mr phoof` (partial history),
  without sync/re-sync/re-decode/backfill. The final run created 28 positions,
  8 FIFO matches, one PARTIAL profile, included 37 and excluded 49 events. A
  CONFIRMED match was checked against stored events: 14,388,725.885774 tokens,
  3.194709729 SOL buy cost, 2.511736011 SOL sell proceeds, exact allocated fees,
  and 433 seconds holding time. All six frontend routes served; interactive UI
  behavior is jsdom-tested, not browser-automated. Two audit runs were retained
  (the second verifies the final cycle-boundary implementation), totaling 56
  position rows, 16 match rows, and 2 profiles.
