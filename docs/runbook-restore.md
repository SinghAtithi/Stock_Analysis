# Restore Runbook — SQLite + board state (TASK-1389)

Backups are produced by `scripts/backup-db.mjs` (`npm run db:backup` in `web/`,
nightly in CI via the `db-backup` job in `.github/workflows/pipelines.yml`,
14-day artifact retention; locally they land in gitignored `backups/`).

- Snapshot method: SQLite `VACUUM INTO` — a consistent, committed point-in-time
  copy that is safe against a hot WAL (`app.db-wal` needs no checkpointing and
  no `-wal`/`-shm` files ride along). Works under live traffic.
- Every snapshot passes `PRAGMA quick_check` before it is considered valid.
- `data/board.json` is copied alongside each snapshot (`board-<ts>.json`) —
  kanban state is production data too.

## When to restore

- `db/data/app.db` corrupted / disk loss / bad migration or ingest batch.
- Board history lost or a bad bulk edit wrecked `data/board.json`.

## Restore steps

1. **Stop writers** — stop the app server (`next start`/dev) and any running
   ingest scripts. SQLite tolerates readers during backup but not during swap.
2. **Pick a snapshot** — newest intact pair from `backups/`
   (CI: download the `db-backups` artifact from the last green `pipelines` run).
3. **Swap the DB**:
   ```bash
   mv db/data/app.db db/data/app.db.lost       # keep the casualty for postmortem
   rm -f db/data/app.db-wal db/data/app.db-shm # stale WAL/SHM must not survive
   cp backups/app-YYYYMMDD-HHMMSS.db db/data/app.db
   ```
4. **Migrate (no-op if snapshot ≥ latest schema)**:
   ```bash
   cd web && npm run db:migrate
   ```
5. **Verify** before serving traffic:
   ```bash
   node -e "const D=require('better-sqlite3');const d=new D('db/data/app.db',{readonly:true});
            console.log(d.prepare('PRAGMA quick_check').get());
            console.log(d.prepare('SELECT COUNT(*) c FROM eod_candles').get());"
   ```
6. **Restart the server**, spot-check one symbol chart + `/screener`.
7. **Board state**: restore `data/board.json` the same way
   (`cp backups/board-<ts>.json data/board.json`); clients converge via the
   per-task merge on next sync.

## Fresh clones

No DB and no `backups/`? Nothing to do — `backupDb` skips cleanly
(`--if-present`), migrations create schema on first ingest.

## Restore drill — executed 2026-08-24 (evidence)

```
$ node scripts/backup-db.mjs
backup ok: backups/app-20260823-192221.db (27.9 MB, quick_check ok) + board-app-20260823-192221.json

$ node scripts/backup-db.mjs --db /tmp/opencode/nonexistent.db --if-present
backup skipped: db absent (fresh clone / CI cold cache)      # exit 0

$ cp backups/app-20260823-192221.db /tmp/opencode/restore-drill/app.db
$ node verify…                                               # readonly handles on both
live integrity: ok
rest integrity: ok
eod_candles:       live=209816 restored=209816 match=true
fundamentals:      live=2      restored=2      match=true
signal_snapshots:  live=5252   restored=5252   match=true
migrations live/restored: 3/3
```

Unit coverage: `scripts/tests/backup-db.test.mjs` (snapshot roundtrip +
board copy · absent-source skip · retention prune keeps newest pair).
