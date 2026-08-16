# TASK-07 — Instruments enrichment v2 (sector, industry, index membership)

Status: done
Date: 2026-08-16

## Schema

`web/src/data/instruments.json` stays backward compatible: `{ s, n, e }` plus optional
`{ sec: string, ind: string, idx: string[] }` (only present when known). `idx` uses
canonical index names: `NIFTY 50`, `NIFTY NEXT 50`, `NIFTY MIDCAP 150`,
`NIFTY SMALLCAP 250`, `NIFTY 500`, `NIFTY BANK`, `NIFTY FIN SERVICE`.

## Sources tested (all live from this machine)

| Source | Endpoint | Verdict |
|---|---|---|
| Groww search | `/v1/api/search/v{1..4}/stocks/search?...` + suggest/derived/stocks variants | **404 on every variant** (routes removed/renamed). Not used. |
| NSE www | `www.nseindia.com` + `/api/quote-equity` | **Akamai 403** even after homepage cookie bootstrap. Documented block. |
| NSE archives | `archives.nseindia.com/content/indices/ind_*.csv` (fallback host `nsearchives.nseindia.com`) | **WORKS, no cookies.** Index constituents + NSE industry taxonomy. |
| NiftyIndices | `niftyindices.com/IndexConstituent/ind_nifty50list.csv` | Works too; archives host preferred (kept as is). |
| Yahoo quote | `query{1,2}.finance.yahoo.com/v7/finance/quote` | **429 both hosts.** Not used. |
| TradingView scanner | `POST scanner.tradingview.com/india/scan` (batch 100 tickers, columns `sector`,`industry`) | **WORKS, no auth.** Primary sector/industry source for `NSE:`/`BSE:` tickers. |

## Approach

- `web/scripts/build-instruments.mjs` v2: base list from Upstox CDN masters (unchanged
  filter), then merges the three verified sources. Per-source failures degrade
  coverage instead of crashing.
- NSE index CSVs supply: index membership (`idx`), plus NSE industry as `ind` fallback.
- TradingView scan: batched POSTs (100 tickers, 300 ms pause, 429 backoff+retry,
  checkpointed after every batch). NIFTY 500 tickers are scanned first so core
  coverage survives throttling. Curated overrides cover tickers TV dropped from its
  scanner: `NSE:BAJAJ-AUTO`, `NSE:NAM-INDIA` (values matched to TV taxonomy via peers
  MARUTI / HDFCAMC).
- BSE entries without their own scan result inherit sector/industry from the NSE
  twin (same symbol = same company), and vice-versa.

## Caches (reproducibility)

- `data/raw/upstox/*.json.gz`, `data/raw/nse-indices/*.csv`,
  `data/raw/tradingview/scan.json` — already covered by root `.gitignore`
  (`data/raw/`); nothing new to ignore.
- Re-run: `cd web && node scripts/build-instruments.mjs` (reuses caches;
  `--refresh` refetches everything). Idempotent; safe to run offline once cached.

## Coverage (run output)

- Total instruments: **5,949** (unchanged; NSE 2,851 / BSE 3,098), file 655 KB.
- With `sec`: 5,343 (89.8%); with `ind`: 5,343; with `idx`: 998 entries.
- NSE names with sector: 2,409/2,851 (84.5%) — remainder is ETFs/funds/suspended names
  TradingView does not classify. BSE: 2,934/3,098 (94.7%).
- **NIFTY 50 sector coverage: 50/50 (100%)**.
- **NIFTY 500 sector coverage: 500/500 (100.0%)** (goal was ≥80%).

## Files changed

- `web/scripts/build-instruments.mjs` — v2 enrichment pipeline (cached, re-runnable).
- `web/src/data/instruments.json` — regenerated.
- `web/src/lib/instruments.ts` — `Instrument`/`SearchHit` optional `sec/ind/idx`
  (`sector`/`industry`/`indices`), populated in `searchInstruments`.
- `web/src/app/api/search/route.ts` — `sector` from hit; `indices` included when present.
- `web/src/components/Search.tsx` — right column now stacks exchange + sector second
  line (`font-mono text-[10px] tracking-widest text-faint`, dimmed on active row).

## Verification

- `cd web && npm run lint`: all owned files clean (`npx eslint` over the 5 files → 0).
- `npx tsc --noEmit`: green.
- Dev server: `curl "localhost:3000/api/search?q=TCS"` →
  `{"symbol":"TCS","exchange":"NSE","sector":"Technology Services","indices":["NIFTY 50","NIFTY 500"],...}`.

## Blockers / notes

- `npm run lint` shows 1 error in `web/src/app/page.tsx` (`react-hooks/set-state-in-effect`)
  — from the parallel watchlist task's in-progress edits, not this task's files.
- NSE main-site API is Akamai-blocked from this machine; archives host was the verified
  workaround. If it ever moves, re-verify the CSV host list in the build script.
- Groww and Yahoo were dropped; TradingView + NSE archives cover everything needed.
