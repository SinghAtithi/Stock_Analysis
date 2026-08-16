# TASK-08 — DB layer (SQLite + migrations + schema v1)

Status: done
Date: 2026-08-16

## Driver choice

- Primary: **better-sqlite3 v13.0.3** (installed in `web/` deps; prebuilt binary works on Node 22.17.0, no flags).
- Fallback: **`node:sqlite`** (`DatabaseSync`) — verified working on Node 22.17.0 with no flag (older 22.x may need `--experimental-sqlite`).
- `scripts/lib/db.mjs` resolves better-sqlite3 first, then `node:sqlite`, then throws a clear error.

## Files

- `scripts/lib/db.mjs` — `openDb(path?)` (default `db/data/app.db`), WAL + foreign_keys + busy_timeout, driver fallback.
- `scripts/lib/curl.mjs` — `curlJson(url, {headers, timeoutMs})` via `execFile("curl")` (no shell), same UA/flags as `web/src/lib/marketData.ts`, plus `HostBackoff` (per-host exponential backoff + jitter on 429) and `defaultBackoff`.
- `scripts/migrate.mjs` — CLI + exported `applyMigrations(db)`; applies `db/migrations/*.sql` sorted, records names in `schema_migrations`, idempotent, exit 0.
- `db/migrations/0001_init.sql` — schema v1: instruments, eod_candles, quotes, fundamentals, analyst_data, corporate_actions, signal_snapshots, breadth_series, watchlists, alerts, backtest_runs, users, schema_migrations + 4 indexes.
- `scripts/tests/db.test.mjs` — node:test + node:assert (no new devDeps): temp-DB migrations idempotency, eod_candles roundtrip + upsert, WAL/foreign_keys pragma check, driver sanity.
- `db/README.md` — driver choice, migration usage, conventions for future ingest scripts.
- `web/package.json` — added `"db:migrate"` and `"test"` scripts (better-sqlite3 dep was already present).
- `.gitignore` — already contained `db/data/`, `*.db`, `*.sqlite`, `*.sqlite3`, `scripts/.cache/`, `data/raw/`; no change needed.

## Verification

- `npm run db:migrate` ×2: first applies `0001_init.sql`, second skips it (no-op), exit 0.
- `npm test`: 4 tests pass (node --test).
- Schema dump via node confirmed all 13 tables + 4 indexes in `db/data/app.db`.
- `npm run lint` (web): clean.
- `git check-ignore db/data/app.db` → ignored.

## Gotchas for future scripts

- Run migrations with `npm run db:migrate` (from `web/`) — path is resolved relative to the script, cwd-independent.
- Use positional `?` binding (works on both drivers); `db.transaction()` exists only on better-sqlite3.
- Timestamps are epoch seconds; JSON goes in `*_json` TEXT columns; ingest should be upsert-style (`ON CONFLICT DO UPDATE`).
- Standalone scripts must use `scripts/lib/curl.mjs`, not Next.js server libs.

## Blockers

None.
