# TASK-30 — Single-symbol EOD ingest: `--symbol` flag via NSE NextApi proxy

Owner: CIPHER · Shipped 2026-08-23 · Phase D

## What

`node scripts/ingest-eod.mjs --symbol RELIANCE [--force]` now ingests **one stock's
complete daily history — listing era to today** — into `eod_candles`, without
touching any other symbol.

## The discovery (why this works at all)

The revamped nseindia.com routes quote-page XHRs through a Next.js server-side
proxy that Akamai does **not** guard:

```
GET https://www.nseindia.com/api/NextApi/apiClient/GetQuoteApi
    ?functionName=getHistoricalTradeData
    &symbol=RELIANCE&series=EQ&fromDate=DD-MM-YYYY&toDate=DD-MM-YYYY
```

Keyless, no login, plain curl. Serves raw daily OHLCV+VWAP back to the
exchange's archive floor (**1996-01-01** for RELIANCE; listing was 29-Nov-1995).
Caps: **70 rows/request** walking back from `toDate`; oversized ranges error.
Endpoint + params + caps documented in `docs/data-sources.md` §1a. Extracted by
grepping the site's own JS bundles for `functionName=` after the old
`historicalOR` endpoints 404'd.

## Implementation

- `resolveSymbolItem()` — ticker (`RELIANCE` / `.NS` / `.EQ`) → instrument, NSE-preferred.
- `nseWindows(fromMs, toMs)` — backward-stepping 80-calendar-day windows
  (≤ ~55 trading days, safely under the 70-row cap), contiguous half-open chain.
- `parseNseTradeRows()` — `chOpeningPrice/chTradeHighPrice/chTradeLowPrice/
  chClosingPrice/chTotTradedQty`, `mtimestamp` DD-Mon-YYYY → 00:00-IST epoch keys.
- `fetchNseHistory()` — sweeps all windows through one shared cookie session,
  dedupes by ts, tolerates per-window failures (logged).
- Flow: existing Yahoo→MC→Groww chain first (bulk + corporate-action events),
  then the NSE sweep **replaces the entire swept range** with pure NSE raw data,
  then NSE corp-actions parse + unconditional `recomputeAdjFactors`.
- `isValidCandle` floor lowered 2000→1996 (pre-2000 rows were being rejected).
- `scripts/lib/curl.mjs`: `cookieJar` support on `curlJson` + `curlBootstrap`
  (a burst of cookie-less one-shot clients reads as bot traffic and gets
  throttled mid-run — observed live).

## Incidents hit and fixed along the way

1. **vector's INC (AC-5)**: dual interleaved RELIANCE.NS rows/day from 2014-07
   (~254 adjusted vs ~1000 raw). Three stacked causes:
   - DELETE range passed **milliseconds into a seconds column** → `BETWEEN`
     empty → deleted nothing, every run;
   - MC's deep history is **silently split-adjusted** (÷4 @2014) even though
     its recent tail is raw — "MC serves raw" only holds near today;
   - MC stamps sessions at 00:00 UTC, our NSE keys are 00:00 IST → same-day
     duplicates under different ts defeat upsert dedupe.
   Fix: delete-with-correct-units + full-range replace with the pure NSE series
   (single source, single convention, single basis).

2. **Factors lost on rewrite**: tail-fill rewrites reset rows to
   adj_factor=1 while "no new CA events" skipped the rebuild. Rebuild is now
   unconditional in symbol mode.

## Final verified state (db/data/app.db)

| Check | Value |
|---|---|
| Rows | 7,622 · zero exact-ts dups · zero same-IST-day dups |
| Span | 1995-12-31 → 2026-08-20 (exchange archive floor → last session) |
| Basis | 100% raw closes (0 fractional pre-2014) |
| Factors | f: 1 → 2 (2017 bonus) → 4 (2024 bonus); adjusted series continuous |
| Cliff gate | green via registry-skip (1997/2009 bonuses remain TASK-36 debt) |
| Gates | tsc ✓ eslint ✓ node:test ✓ (202 pass / 11 new) |

## Deliberate scope boundaries

- Universe mode untouched (no behavior change without `--symbol`).
- 1997/2009 bonus factors still missing (NSE corp-actions feed only covers
  recent years; Yahoo throttled all session) → registered TASK-36 debt, gate
  skips loudly rather than failing.
- `recomputeAdjFactors` stays OFF in universe mode (TASK-15 double-adjust hazard).
