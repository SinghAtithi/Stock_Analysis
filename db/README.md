# db/ — SQLite data platform

Local SQLite database backing NIFTY//TERM's data platform (EOD candles, fundamentals, analyst data, signals, alerts, backtests).

## Driver

**Primary: [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) v13** — synchronous, battle-tested, fastest option. Installed as a dependency of `web/` (`npm install better-sqlite3`). No build flags needed on Node 22.17.0 (prebuilt binaries).

**Fallback: `node:sqlite`** — Node's built-in SQLite (`DatabaseSync`), available since Node 22.5. On Node 22.17.0 it needs no flag; on older 22.x versions run with `--experimental-sqlite` if `require("node:sqlite")` throws.

`scripts/lib/db.mjs` picks better-sqlite3 first (resolving from `scripts/` or `web/node_modules`), then falls back to `node:sqlite`, and throws a clear error if neither is available.

## Database file

`db/data/app.db` (auto-created, gitignored). Opened with:

- `journal_mode = WAL`
- `foreign_keys = ON`
- `busy_timeout = 5000` ms

## Migrations

- Files: `db/migrations/NNNN_description.sql`, applied in lexicographic order.
- Runner: `scripts/migrate.mjs` — run via `npm run db:migrate` (from `web/`) or `node scripts/migrate.mjs` (from repo root).
- Idempotent: applied names are recorded in `schema_migrations`; re-running is a no-op and exits 0.
- Rules:
  - Never edit an applied migration — add a new numbered file.
  - `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` in migrations; `ensureSchemaMigrations()` bootstrap means tracking works even before 0001.
  - Schema v1 is designed for JSON-friendly flexibility: opaque payloads go in `*_json` TEXT columns so new data shapes don't require schema changes.

## Conventions for ingest scripts

- Import `openDb` from `scripts/lib/db.mjs`; never construct a driver directly.
- Bind values with positional `?` parameters (works on both drivers).
- Timestamps are unix epoch **seconds** in INTEGER columns.
- JSON columns: `JSON.stringify(payload)` before insert, `JSON.parse` on read. NULL means "not fetched", `"{}"`/`"[]"` means fetched-but-empty.
- Symbols use the same format as the rest of the app (e.g. `RELIANCE.NS`, `^NSEI`).
- Ingest is upsert-style: `INSERT ... ON CONFLICT(...) DO UPDATE SET ...` so re-runs are idempotent.
- Large batch inserts: wrap in `db.transaction(() => ...)` (better-sqlite3) — migrate.mjs's `runMigration` pattern shows how to degrade gracefully on `node:sqlite`.
- Use `scripts/lib/curl.mjs` (`curlJson`, `HostBackoff`) for HTTP — standalone scripts cannot import Next.js server libs.

## Tests

`npm test` (from `web/`) runs `node --test ../scripts/tests` — built-in test runner, no devDependencies needed. Tests open a temp DB via `openDb(tempPath)` (never the real one).
