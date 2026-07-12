# HANDOFF

Continuation notes for any coding model/agent picking up this project.
**Current state: Phase 2B complete** (1A foundation, 1B activity ingestion,
1C reliable swap decoding, 1D-A beginner-friendly UI shell, 1D-B1 current token
market snapshots, 1D-B2 historical OHLCV and entry outcomes). Do not start
Phase 2C until the user asks.

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

Migrations: `20260711012659_init`, `20260711031157_wallet_activity`,
`..._reliable_swap_decoding` (additive only — no data was reset).

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

**Phase 2C — Wallet behavior archetypes, leader/follower timing evidence,
related-wallet heuristics, and non-accusatory wallet classification foundations.**
Do not begin it implicitly.

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
