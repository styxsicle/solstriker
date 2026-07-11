# HANDOFF

Continuation notes for any coding model/agent picking up this project.
**Current state: Phase 1A complete.** Do not start Phase 1B until the user asks.

## What this project is

A local Solana memecoin research and paper-trading app, built in small checkpoints
(see `BUILD_PLAN.md`). It is strictly read-only research tooling: no private keys, no
seed phrases, no transaction signing, no real trades — ever.

## Current architecture

- **npm workspaces** monorepo, all TypeScript, ESM (`"type": "module"`).
  - `packages/shared` — dependency-free library: base58 encode/decode, Solana
    address validation, wallet-import parsers (CSV / plain text / JSON export /
    auto-detect), `syntheticAddress()` for fake dev/test data. Built with `tsc` to
    `dist/`; the API consumes the built output.
  - `apps/api` — Fastify 5 + Prisma + Zod. `buildApp(deps)` in `src/app.ts` takes
    injected `{ prisma, env, rpc }` so tests run fully offline via `app.inject()`.
    Entry point `src/server.ts` (binds 127.0.0.1).
  - `apps/web` — React 18 + Vite 6 dark dashboard, no router (three tabs), plain
    CSS. Talks to the API via `VITE_API_BASE_URL` only.
  - `prisma/` at the repo root — schema, migrations, `dev.db` (gitignored).
- **RPC security**: `apps/api/src/rpc.ts` builds the Helius URL inside a closure.
  Status responses contain only `configured/cluster/healthy/slot/latencyMs/
  checkedAt/error`. All failures collapse to the code `rpc_error` so error text can
  never leak the URL/key. The app starts fine with no key (`error: not_configured`).
- **Env loading**: `apps/api/src/env.ts` finds the repo root (walks up until
  `prisma/schema.prisma`), loads the root `.env`, validates with Zod.
- **SQLite URL normalization**: `apps/api/src/db.ts` resolves relative `file:` URLs
  against `<repo>/prisma/` so the CLI and runtime agree.

## Database models (prisma/schema.prisma)

- `TrackedWallet`: `id`, `address` (unique), `label?`, `group?` (primary group,
  for filtering), `groupsJson?` (full JSON array — SQLite has no lists), `emoji?`,
  `notes?`, `metaJson?` (imported alert prefs/sound), `enabled` (default true),
  `source` (`manual` | `import:csv` | `import:text` | `import:json` | `dev-seed`),
  `createdAt`, `updatedAt`.
- `Token`: `id`, `mintAddress` (unique), `name?`, `symbol?`, `stage` (string —
  SQLite lacks enums; validated values `UNCLASSIFIED | FINAL_STRETCH | MIGRATED`),
  `source`, `discoveredAt`, `lastSeenAt`, `createdAt`, `updatedAt`.

## API routes

| Route | Notes |
| --- | --- |
| `GET /api/health` | API + DB status (`SELECT 1`) |
| `GET /api/rpc/status` | Sanitized Helius `getHealth` + `getSlot` |
| `GET /api/wallets` | Pagination (`page`, `pageSize`), `search`, `group`, `enabled` filters; returns `items`, `total`, `stats {total, enabled}`, distinct `groups` |
| `POST /api/wallets` | Manual add; 400 `invalid_address`, 409 `duplicate_address` |
| `POST /api/wallets/import` | Body `{ content, format?: auto\|csv\|text\|json, filename? }`; returns `{ imported, duplicates, invalid, skipped, invalidSamples, format }`; idempotent |
| `PATCH /api/wallets/:id` | Partial update incl. `enabled`; 404 on unknown id |
| `GET /api/tokens` | List; `liveDiscovery: false` (Phase 1A) |
| `POST /api/dev/seed` | 403 in production; idempotent; synthetic `[DEV]`/`dev-seed` records only |

## Wallet import formats

1. CSV — optional header (`address,label,group,notes`, any order, extras ignored);
   headerless files read positionally; quoted fields supported.
2. Plain text — one address per line; blanks/`#` comments counted as `skipped`.
3. JSON tracker export — array of `{ trackedWalletAddress, name, emoji, groups[],
   alertsOnToast, alertsOnBubble, alertsOnFeed, sound }`. Auto-detected by leading
   `[`/`{` even for `.txt` files. Mapping: `trackedWalletAddress→address`,
   `name→label`, `groups→groupsJson` (multi-group preserved, first group → `group`),
   `emoji→emoji`, alerts+sound → `metaJson`.

Validation = base58 alphabet, 32–44 chars, decodes to exactly 32 bytes
(`packages/shared/src/solana.ts`). Duplicates (in-file or in-DB) are counted and
skipped, making re-imports idempotent.

**Privacy rules (enforced, keep following them):** the user's real wallet-export
file is private. It is imported only through the dashboard at runtime. Never commit
it, hardcode it, log it, or use real addresses in seeds/tests/docs — tests use
`syntheticAddress(n)` (base58 of 32 identical bytes). `.gitignore` covers `.env`,
`*.db`, `/imports/`, `*wallet-export*`, `*tracked-wallets*`, `*tracked wallets*`.

## Important files

- `prisma/schema.prisma` — models
- `packages/shared/src/walletImport.ts` — all import parsing
- `packages/shared/src/{base58,solana}.ts` — validation primitives
- `apps/api/src/app.ts` — app factory (dependency injection)
- `apps/api/src/rpc.ts` — sanitized RPC client
- `apps/api/src/routes/wallets.ts` — list/create/import/patch
- `apps/api/src/services/{walletImport,seed}.ts` — persistence + dev seed
- `apps/api/test/*` — API tests (temp SQLite at `prisma/test.db`, created by
  `test/globalSetup.ts` via `prisma db push`; files run sequentially)
- `apps/web/src/pages/{StatusPage,WalletsPage,TokensPage}.tsx` — dashboard

## Commands (from repo root)

```bash
npm install          # also runs prisma generate (postinstall)
npm run db:generate
npm run db:migrate   # prisma migrate dev
npm run dev          # builds shared, then API :3001 + web :5173 concurrently
npm run test         # 41 tests (22 shared + 19 api), no Helius key required
npm run lint
npm run build
```

## Environment variables (root `.env`, template in `.env.example`)

`HELIUS_API_KEY` (backend only, optional), `SOLANA_CLUSTER` (`mainnet-beta`|`devnet`),
`DATABASE_URL` (`file:./dev.db` → `prisma/dev.db`), `API_PORT` (3001),
`WEB_ORIGIN` (CORS), `VITE_API_BASE_URL` (only value the frontend sees).
No secrets in this file or anywhere in the repo.

## Tests (all offline; fake keys + injected fetch mocks)

- shared: base58 round-trips, address validation edge cases, CSV (header/headerless/
  quoted), plain text, JSON export mapping + malformed JSON, format auto-detection.
- api: health; RPC not-configured / healthy / **key-leak sanitization** (including
  error messages containing the URL); wallet CRUD (invalid 400, duplicate 409,
  PATCH enable/disable, 404, search/group filters); import per format, duplicate
  counting, idempotency; dev-seed idempotency + production guard.

## Known limitations

- No live data: token page shows dev-seed records only; no wallet monitoring,
  transaction decoding, scoring, signals, or paper trading yet (by design).
- Wallet list search is SQLite `LIKE` (ASCII case-insensitive only).
- Group filter matches the primary group or a substring of `groupsJson` — fine at
  ~1k wallets; revisit if group names ever contain quotes.
- `PATCH group` replaces the whole group list with a single group (UI has no
  multi-group editor yet).
- API binds to 127.0.0.1 and has no auth — local, single-user use only.

## Exact next checkpoint (Phase 1B — wait for the user's go-ahead)

Wallet activity ingestion: fetch historical swap/transfer activity for enabled
tracked wallets via Helius (REST, not WebSockets yet), store normalized buy/sell
events in a new `WalletEvent` model linked to `Token` (creating tokens from real
mints with `source: "activity"`), with rate limiting, per-wallet cursors, a
backfill progress endpoint, and an activity feed page. Keep the key backend-only
and keep all tests offline with recorded/mocked fixtures.
