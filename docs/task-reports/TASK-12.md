# TASK-12 — Analyst data pipeline (feeds S105 Analyst Revision Drift)

Status: done (live fetch throttled — see Throttle impact)
Date: 2026-08-16
Files: `scripts/ingest-analyst.mjs`, `scripts/tests/analyst.test.mjs`, `data/raw/analyst/` (cache, gitignored), this report.

## What was built

`scripts/ingest-analyst.mjs` — CLI + importable API (functions exported for tests):

- **Universe** (`--universe nifty50|nifty100|all`): read from `web/src/data/instruments.json`
  `idx` membership arrays (verified actual field names: `s`, `n`, `e`, optional `idx: string[]`).
  `nifty50` = entries with `idx` containing `"NIFTY 50"` (50 unique), `nifty100` =
  union of `"NIFTY 50"` + `"NIFTY NEXT 50"` (100 unique, no overlap). Symbols get
  `.NS` appended for Yahoo (matches T11 corp-actions convention). No hardcoded list needed.
- **Fetch**: one request per symbol —
  `https://query1.finance.yahoo.com/v10/finance/quoteSummary/<sym>.NS?modules=recommendationTrend,earningsTrend,financialData`
  via `scripts/lib/curl.mjs` (curl subprocess, same UA as marketData.ts). On any failure
  falls through to the query2 host; `HostBackoff` on 429 (3 attempts/host in CLI; default
  lib max is 4). 12 s curl timeout.
- **Circuit breaker** (T11 precedent): after 3 consecutive failures the remaining symbols
  are marked failed with `circuit open` — no per-symbol waits during a sustained 429 outage.
- **derived_json** (null-safe, no invented values — every field `numAt`-guarded, `raw`
  unwrapped):
  - `rating`: strongBuy/buy/hold/sell/strongSell counts, `total`, `rawScore` (0–5 weighted).
  - `ratingMean`: `financialData.recommendationMean` if present (Yahoo's 1–5 scale,
    lower = stronger buy — kept as-is, not inverted).
  - `targetMeanPrice` / `targetHighPrice` / `targetLowPrice` (financialData).
  - `currentPrice` + `targetUpsidePct` = (targetMean − current)/|current|·100.
  - `revisionTrend` (earningsTrend trend[0], annual "0q"): `period`, `periodEndDate`,
    `growthEstimate`, `epsEstimate` {avg, low, high, yearAgoEps, numberOfAnalysts, growth},
    `epsRev7dPct` / `epsRev30dPct` / `epsRev90dPct` = pct delta of
    `epsTrend.current` vs `7dAgo/30dAgo/90dAgo` (null on missing/zero denominator).
- **Upsert** `ON CONFLICT(symbol) DO UPDATE` with `fetched_at` epoch seconds; fresh-skip
  window `FRESH_SECONDS` = 24 h unless `--force`; `--limit N` slices the universe.
- **Cache**: raw payload JSON per symbol written to `data/raw/analyst/<sym>.json`
  (dir is under the gitignored `data/raw/`).
- Summary log (`fetched | skipped | failed | empty`), exit 0 on partial failure.

## Tests (`scripts/tests/analyst.test.mjs`, node:test, no new deps)

```
# tests 6  (analyst suite) — 6/6 pass
```

- (a) flattening: full fixture → exact counts/rawScore 4.0, upside 6.67%, deltas
  11.11/25/42.86; missing modules → all nulls; partial modules (rating without full
  count set) → `rating: null`, never invented.
- (b) revision-delta math: `pctChange` (incl. zero-denominator → null), epsTrend
  current-vs-7d/30d/90d, flat revisions → 0 % (not null).
- (c) upsert: fetch once → fresh row skipped (no refetch) → `--force` refetches;
  stale row refetched without `--force`; fetch failure → `failed`, no upsert,
  run continues; circuit opens at 3 consecutive failures (remaining marked failed).
- Universe membership test (50 vs 100, `.NS` suffix, unknown universe throws).
- Full `node --test "scripts/tests/*.test.mjs"`: 38/40 — the 2 failures are in
  `fundamentals.test.mjs` + `strategies.test.mjs` created concurrently by the data
  agent (unrelated, untouched).

## Live verification (2026-08-16, ~20:15 IST)

`node scripts/ingest-analyst.mjs --universe nifty50 --limit 5`:

```
FAILED ADANIENT.NS   (429 query1 + query2, retries exhausted)
FAILED ADANIPORTS.NS (429 both hosts)
FAILED APOLLOHOSP.NS (429 both hosts)
FAILED ASIANPAINT.NS circuit open (3 consecutive failures)
FAILED AXISBANK.NS   circuit open
analyst ingest done: fetched 0 | skipped 0 | failed 5 | empty 0 | total 5   exit=0
```

## Throttle impact (honest)

Yahoo is still IP-throttled (429 on query1 AND query2 for 7+ h — preflight probe
confirmed before the run). **0/5 populated; analyst_data has 0 rows; RELIANCE/TCS/
HDFCBANK not populated.** The resilience path is what was verified live: 429 detected,
per-host backoff applied, query2 fallback attempted, circuit opened after 3 consecutive
failures, run exits 0 — exactly the designed behavior for a sustained outage. The
flatten/delta/upsert logic is fixture-verified; the fetch-and-store happy path needs
Yahoo recovery (re-run `node scripts/ingest-analyst.mjs --universe nifty100 --force`).

## Notes / known limitations

- 429 responses can hang until the curl timeout (~12 s); with 6 attempts/symbol a
  failed symbol costs ~45 s, but the circuit breaker bounds a full outage run.
- Yahoo `recommendationMean` is 1–5 (lower = stronger buy); `rawScore` (0–5, higher =
  stronger buy) is the canonical field for S105. Documented in code.
- Some NIFTY 100 symbols are funds/indices with no analyst coverage → those return
  empty quoteSummary results and are recorded as `empty`, not failures.

## Blockers

None (data pipeline ready; Yahoo throttle is environmental).
