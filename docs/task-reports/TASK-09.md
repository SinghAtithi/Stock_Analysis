# TASK-09 — EOD candle store + universe ingest

## What was built

- `scripts/ingest-eod.mjs` — universe resolver, Yahoo→Moneycontrol→Groww fetch chain,
  candle upsert, corporate-action merge, split adjustment, resume support.
- `scripts/tests/eod.test.mjs` — 16 fixture tests (node:test, no new deps).
- DB tables used: `eod_candles` (raw OHLCV + `adj_factor`), `corporate_actions`
  (schema from `db/migrations/0001_init.sql`, no migration changes).

## CLI

```
node scripts/ingest-eod.mjs --universe nifty50|nifty500|all [--years N] [--quick] [--force]
```
Defaults: `nifty500`, 10y. `--quick` = 1y + nifty50. `--force` bypasses the resume check.

## Universe resolution

- `web/src/data/instruments.json` fields verified live: `{s, n, e, sec, ind, idx: []}` —
  index strings are exactly `"NIFTY 50"` / `"NIFTY 500"` (also `NIFTY BANK`, `NIFTY FIN
  SERVICE`, `NIFTY MIDCAP 150`, `NIFTY NEXT 50`, `NIFTY SMALLCAP 250`).
- nifty50 → 100 rows (50 NSE + 50 BSE dups); nifty500 → 500 distinct symbols (498 dual-listed).
  Dedupe keeps the NSE row when a symbol is listed on both. Equities only: rows with
  `idx` membership are all real equities; an `isEquity` guard additionally excludes
  non-NSE/BSE exchanges, caret symbols, and names matching index/ETF/mutual-fund.
- Fallback: if `idx` flags are absent for nifty50, a hardcoded 50-symbol NSE list is used
  (kept in `NIFTY50_FALLBACK`, sourced from the current index membership).

## Sources (live state 2026-08-16)

Yahoo is still IP-wide 429 (7+ h) → circuit breaker (3 consecutive 429s) opens Yahoo for
the rest of the run so we don't burn HostBackoff time per symbol. All 50 NIFTY 50 symbols
came from **Moneycontrol priceapi** (`resolution=1D`, `countback`). The T11 doc note of
"~300 candle cap" is wrong: `countback=2000/4000` returned 2001/4001 candles (~16 y max);
10y history is fully served. **Groww daily caps at 25 candles** (size param ignored) — it
remains an emergency fallback only (short window); not exercised in the run.

Run summary (fresh DB): 50/50 fetched, 0 skipped, **127,139 candles** (~2,651/symbol,
2015-12-03 → 2026-08-14, ≈10.7 y), 0 failed, DB 14.2 MB. One transient APOLLOHOSP failure
on a `--force` re-run (exit 0, reported in summary) — plain re-run then refetched only it
and skipped the other 49 (resume works in production: 30 s run).

## Corporate actions + split adjustment

- Yahoo `events=div,split` is parsed when Yahoo is up; because it is blocked, the T11 feed
  `data/corporate_actions.json` (symbols keyed `RELIANCE.NS` etc.) is merged. **20 splits
  across 17 NIFTY 50 names + 757 dividends** now live in `corporate_actions`
  (`ts` = ex-date 00:00 IST epoch sec; `payload_json` keeps `{ratio, raw}`).
  Feed symbols not in the current N50 universe (PoC used an older list) are skipped.
- `adj_factor` rebuilt end-to-end per symbol from `corporate_actions` ordered by date —
  idempotent by construction (spec §6). Canonical convention per `docs/data-sources.md`:
  factor = product of split ratios with `ex_date <= candle_ts` (multiplication on/after
  ex-date; composes left-to-right). Verified staircases:
  - TATASTEEL: 1 → 10 exactly on ex-date 2022-07-28.
  - HDFCBANK: 5 (2011 split, pre-window) → 10 after 2019-09-18 2:1. 5×2=10 ✓
  - KOTAKBANK: 2 → 10 after 2026-01-13 5:1. 2×5=10 ✓
- **Deviation 1 (documented)**: dividends are stored in `corporate_actions` (spec §5 —
  calendar UI) but never touch `adj_factor` (v1 = splits only; "trivial" dividend
  adjustment deferred).
- **Deviation 2 (important, document)**: Yahoo and Moneycontrol both serve **split-
  adjusted** histories (old prices already divided by R; verified: TATASTEEL 2022-07-27
  raw 95.94 ≈ true pre-split ₹955 ÷ 10). The spec's continuity property assumes an
  unadjusted raw source (bhavcopy). Applied to adjusted sources, spec-convention
  `adj_close = raw × factor` shows a ratio-sized jump at each ex-date. The factor still
  faithfully reflects the split calendar (exact ratios, exact dates, idempotent,
  deterministic), which is what v1 requires. If unadjusted display is needed later,
  invert the convention (factor on pre-ex-date candles) or add bhavcopy as ground truth —
  recompute is a one-function flip.

## Tests

`node --test scripts/tests/db.test.mjs scripts/tests/eod.test.mjs` → 20/20 pass
(16 eod + 4 shared db). Covers: universe resolution + fallback, all three parsers
(epoch-sec conversion, null/NaN row dropping), upsert idempotency, resume logic,
2:1 split staircase, chained-split composition (2:1×5:1 → 10), idempotent recompute.

**Environment quirk**: `node --test scripts/tests/` (bare directory arg) fails on this
Node v22.17.0 build ("Cannot find module .../scripts/tests" — the dir is treated as a
module, even for a minimal `/tmp` repro). Working invocations: explicit file globs or
`node --test` with no args from `scripts/`. Not caused by this task's files.

## Blockers / notes

- Yahoo outage persists (7+ h); chain and breaker handle it. Watch for recovery —
  primary path should re-verify `events` parsing against live data once unblocked.
- One DB corruption incident (btree errors in `eod_candles`, other tables intact)
  occurred while another agent's ingest ran concurrently against the same app.db; the DB
  was regenerated cleanly (it is gitignored test data) and integrity re-verified `ok`.
  If it recurs, investigate cross-process WAL interplay; consider per-pipeline DB files.
- Raw payloads cached under `data/raw/eod/*.json` (gitignored).
