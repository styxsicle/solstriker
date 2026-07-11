# Memecoin Lab

A **local** Solana memecoin research and paper-trading application, built in small
checkpoints. Current checkpoint: **Phase 1A — foundation, wallet import, RPC status**.

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

## Development seed data

`POST /api/dev/seed` (or the "Seed development data" button on the Tokens page)
inserts a small set of synthetic wallets and tokens. It is idempotent, disabled in
production, and every record is clearly marked (`source = dev-seed`, `[DEV]` prefix).
Live token discovery is **not** implemented yet.

## Roadmap

See [BUILD_PLAN.md](BUILD_PLAN.md). For architecture and continuation notes (e.g.
switching coding models), see [HANDOFF.md](HANDOFF.md).
