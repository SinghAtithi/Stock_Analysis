# TASK-32 — P0 CI hotfix: real-data suites self-skip without the ingest DB

## Symptom

GitHub Actions red on `master` for three consecutive pushes (first failure: TASK-29's own
landing commit). `npm test` gate fails with 2 suites:

```
✖ S100 real-data run over Nifty 50 eod_candles   Error: no such table: eod_candles
✖ REAL RUN: S172/S174 regime on live asset data  Error: no such table: eod_candles
```

tsc + eslint gates were green; only the node:test gate failed.

## Root cause

Two compounding defects, both invisible locally (where the gitignored ingest DB exists):

1. **`scripts/tests/s100-real.test.mjs` opened the DB unconditionally.**
   `openDb()` (`scripts/lib/db.mjs`) runs `mkdirSync` + `new Database(path)` — it *creates* an
   empty `app.db` when the file is missing, then s100's first query dies with
   `no such table: eod_candles`.

2. **`scripts/tests/s172-s174.test.mjs` guarded with `existsSync` only.**
   node:test executes suites in glob order: `s100-real` < `s172-s174`, so defect #1 manufactures
   a phantom empty `app.db` mid-run, defect #2's guard then passes, and s172 crashes identically.
   The guard was correct in isolation and wrong in the suite convoy.

The repo already had the right contract — `eod-cliff-sweep.test.mjs` skips when the DB is absent
**or** suspiciously small (`size < MIN_ROWS * 64`). Neither failing suite followed it.

## Fix

Both suites adopt the cliff-sweep predicate:

- `s100-real.test.mjs`: module-level `HAS_DB = existsSync(DB_PATH) && statSync(DB_PATH).size > 64_000`,
  wired as a node:test `{ skip }` option so the suite reports as skipped rather than silently passing.
- `s172-s174.test.mjs`: same size floor added to the existing early-return guard, with a comment
  explaining why `existsSync` alone is insufficient.

No product code touched; no schema changes; the DB file is never created by tests anymore.

## Verification

| Check | Result |
| --- | --- |
| Simulated CI: hid `app.db` + `-shm`/`-wal`, full `npm test` | 191 pass / 0 fail / 1 skipped |
| Guard fired | `[real-run] no local ingest DB — skipping (CI/fresh checkout)` |
| Restore integrity | 136,808 rows intact post-run; no stray files |
| Real-data run (DB present) | s100 + s172/174 execute fully, gates green |
| `workflow verify` (tsc → eslint → node:test) | ALL GATES GREEN |

## Follow-ups (not this task)

- `openDb()` creating files as a side effect of a read-path helper is a footgun; consider an
  explicit `readOnly` flag or `create: false` default for query-only callers.
- The two real-data suites duplicate the "has real data" predicate; could share one helper if a
  third suite appears.
