# TASK-31 — Non-Yahoo index fallback chain + indices back in instruments.json

**Date**: 2026-08-16. **Files**: `web/src/lib/marketData.ts`, `web/src/lib/instruments.ts`,
`web/src/data/instruments.json`, `web/scripts/build-instruments.mjs`, `web/src/app/api/search/route.ts`
(no change needed), this report.

## MC index endpoint verdict (live-tested via curl)

`https://priceapi.moneycontrol.com/techCharts/indianMarket/index/history?symbol=<code>&resolution=1D|1W&from=&to=&countback=&currencyCode=INR` — **WORKS** for indices.

- Symbol codes extracted from `moneycontrol.com/indian-indices/*.html` (the `symbol=` param of their
  `techCharts/intra` calls), all live-verified 200 + `"s":"ok"`:
  `in;NSX` (NIFTY 50), `in;SEN` (SENSEX), `in;nbx` (NIFTY BANK), `in;cfr` (NIFTY NEXT 50),
  `in;bpo` (NIFTY MIDCAP 100), `mc;helcar` (INDIA VIX).
- **Case is per-symbol and edge-dependent**: `in;NSX` works on one Akamai edge, `in;nsx` on another;
  wrong case → `{"s":"error","errmsg":"Invalid request.Wrong symbol"}`. The fetcher tries both cases.
- **Burst-limited per IP**: ~10+ rapid calls trip a short lockout that returns the *same* generic
  `Wrong symbol` error (misleading); recovered after ~60 s idle. A per-symbol 30 s cooldown on full
  failure prevents compounding. App cache (10 min) already dampens request rate.
- **Resolutions**: 1D and 1W only. `1M` (used for equity `max`) and `countback>500` return
  `s:"error"` → index `max` degrades to weekly (`1W`, cb 500 ≈ 10 y).
- **NSE chart/indices JSON endpoints**: not retested — already documented BLOCKED (Akamai) in
  docs/data-sources.md §1; MC + Google cover the gap, no need.

## Fallback chain now (indices)

Yahoo `^NSEI` etc. (curl, host cooldown) → Google Finance intraday (`1d`/`5m`, `5d`/`15m`;
`NIFTY_50:INDEXNSE`, `SENSEX:INDEXBOM`, …) → **Moneycontrol index/history** (`1mo`–`max`,
daily/weekly, `source:"moneycontrol"`) → `index_unavailable` (only when all fail). SENSEX renders
with exchange=BSE; 52W only when ≥250 distinct sessions; change vs previousClose-from-candles.

## instruments.json / search

`build-instruments.mjs` gained a curated `CURATED_INDICES` section (documented in the script header)
merged on every rebuild — never wiped on regenerate. Added 8 canonical rows (NIFTY 50, SENSEX@BSE,
BANKNIFTY, NIFTY BANK, INDIA VIX, NIFTY NEXT 50, NIFTY MIDCAP 100, NIFTY FIN SERVICE); curated
entries override Upstox rows with the same `s|e`. `searchInstruments`'s existing index regex already
classifies them; the search route filters nothing. `INDEX_MAP` moved to `instruments.ts` as a shared
export (TASK-UI-01 #3), `marketData.ts` imports it.

## Verification (Yahoo throttled, real conditions)

- `api/chart?symbol=NIFTY 50&type=Index&range=1y` → `source:"moneycontrol"`, 260 candles, last
  24366.0, prevClose 24395.85 (matches Google's published number), 52W 26373.2/22182.55.
- SENSEX 1y → moneycontrol, 260 candles, prevClose 78079.96. BANKNIFTY 1mo → moneycontrol, 25.
  INDIA VIX 3mo → moneycontrol, 70. NIFTY 50 1d → `source:"google"`, 76×5m.
- `api/search?q=NIFTY` → NIFTY/NIFTY 50 (Index); `q=SENSEX` → SENSEX NSE+BSE; `q=BANKNIFTY` →
  BANKNIFTY; `q=INDIA VIX` → INDIA VIX. All typed Index.
- `tsc --noEmit` + `eslint` green. Note: dev on :3100 refused (Next 16 single-instance lock while
  :3000 runs) — verified on :3000 (hot-reload, same code path). `1mo/1d` is not a valid chart-route
  key (VALID set requires `1mo/1h`); used the canonical pair.
