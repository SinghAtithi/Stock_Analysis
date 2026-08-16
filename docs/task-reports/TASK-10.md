# TASK-10 — Fundamentals pipeline v1 (Yahoo quoteSummary)

Status: COMPLETE (2026-08-16)
Files: `scripts/ingest-fundamentals.mjs` (created), `scripts/tests/fundamentals.test.mjs`
(created), `data/raw/fund/` (cache, gitignored), this report.

## Pipeline

`node scripts/ingest-fundamentals.mjs [--universe nifty50|nifty500|all] [--limit N] [--force]`

- **Universe**: `web/src/data/instruments.json` `idx` array membership — nifty50 = 50
  distinct symbols, nifty500 = 500, `all` = every NSE/BSE row (deduped, NSE listing
  preferred). NSE → `<SYM>.NS`, BSE-only → `.BO` (marketData.ts equity convention;
  indices ignored — none appear in idx members).
- **Fetch**: one v10 `quoteSummary` request with 7 modules joined by comma
  (`defaultKeyStatistics,financialData,incomeStatementHistory,balanceSheetHistory,
  cashflowStatementHistory,earningsHistory,summaryProfile`). query1 first, retry
  query2 on any failure; `HostBackoff` on 429 (per-host exponential + jitter);
  circuit breaker opens after 3 consecutive failures and fast-skips the rest.
- **Store**: upsert into `fundamentals(symbol, module_json, metrics_json, fetched_at)`
  (`ON CONFLICT DO UPDATE`), `fetched_at` = now seconds. `module_json` = the raw
  `quoteSummary.result[0]` untouched; `metrics_json` = flat null-safe object.
- **Freshness**: skip symbols fetched < 7 days ago; `--force` overrides.
- **Cache**: raw payloads written to `data/raw/fund/<SYM>.json`; a fetch failure
  falls back to the cached payload (row marked `degraded: true`).
- **Graceful**: per-symbol try/catch; summary line (fetched/cached/skipped/failed +
  coverage %); exit 0 on partial.

## Metrics normalization notes

- Numbers come from Yahoo's `{raw, fmt}` objects; `raw` is used, numeric strings
  coerced, everything else → `null`. Source values are recorded as reported —
  nothing invented (e.g. `dividendYield` stays the raw fraction ~0.0035, `ROE` the
  raw decimal 0.19).
- Derived (flagged with a `_derived` key): `earningsYield` = 1/trailingPE;
  `evToEbitda` = EV/EBITDA — reported `financialData.ebitda` when present, else
  derived EV/(operatingIncome + depreciationAndAmortization) from the income
  statement (the derived EBITDA is also stored).
- Accrual inputs (Sloan-style): `accrual_netIncome`, `accrual_operatingCashFlow`,
  `accrual_totalAssetsCur` (balance sheet [0]), `accrual_totalAssetsPrior` ([1]).
- `operatingIncome`/`netIncome` prefer `financialData`, fall back to the income
  statement; `totalCash` = `cash` → `cashAndShortTermInvestments` fallback.

## Verification

- `node --test scripts/tests/fundamentals.test.mjs` — **7/7 pass** (flattening +
  nulls + numeric-string coercion, derived EV/EBITDA, two-year accrual extraction,
  universe resolution, upsert/freshness/force, cache-degraded fallback, circuit
  breaker). Full suite `node --test "scripts/tests/*.test.mjs"`: db + fundamentals
  pass; concurrent-agent's in-progress `eod.test.mjs`/`analyst.test.mjs` fail to
  LOAD (mid-edit SyntaxError at their line 83 — not mine).
- `npx tsc --noEmit` clean; `npm run lint` clean (web unaffected by scripts).

## Live run + Yahoo throttle impact

- `--universe nifty50 --limit 5` (twice, 90 s apart): **0/5 fetched** — Yahoo still
  IP-throttled (429 on query1+query2, v8+v10, all endpoints — continuous since
  ~17:00 IST, 7+ h). Backoff observed: ~48 s/symbol (3 attempts × 1 s/2 s per host,
  query1 then query2), circuit opened after 3 failures, remaining symbols skipped
  instantly. Exit 0.
- **Coverage achieved: 0% live** (0% with cache — no cache yet). RELIANCE/TCS module
  population cannot be shown live; it is fixture-verified (7 modules normalize to
  28 metric keys). The pipeline is ready: re-run once Yahoo clears (auto-probe
  `/tmp/opencode/yahoo_probe.log` still watching) — data/raw/fund then seeds the
  cache and the DB fills without code changes.
- Fallback alternatives (documented, NOT implemented — Yahoo stays primary):
  Moneycontrol `/company/X/consolidated/` (verified open, ~230 KB parseable HTML),
  screener.in (works, ToS-prohibited). See docs/data-sources.md §4.

## Blockers

Yahoo per-IP throttle (7+ h) — no live payloads possible from this IP today;
requires an IP pool for scale (docs/data-sources.md §10).
