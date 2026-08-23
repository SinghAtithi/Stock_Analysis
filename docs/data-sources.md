# India Data-Source Decision Document (T11)

Live-tested from this machine (curl CLI / node execFile, no shell) on 2026-08-16.
UA used: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36`.
Legend: WORKS / FLAKY / BLOCKED. "Assumed" = not re-verified live today (see per-source notes).

---

## 1. NSE official — www.nseindia.com

Reality check: the blanket "NSE = Akamai 403" assumption is only half true from this IP.
Akamai's rule is **path-based**: publication endpoints are open, quote/trade endpoints are denied.

| Endpoint | Auth | Rate limits | Verdict | ToS risk | Notes |
|---|---|---|---|---|---|
| `GET /api/allIndices` | none (no cookie) | none observed (15 rapid calls, all 200) | **WORKS** | low (public EOD) | all indices + P/E, P/B, dividend yield, adv/decl |
| `GET /api/equity-master` | none | — | **WORKS** | low | index master lists (not a company master) |
| `GET /api/market-data-pre-open?key=ALL` | none | — | **WORKS** | low | full pre-open market, ~2 MB JSON |
| `GET /api/fiidiiTradeReact` | none | — | **WORKS** | low | daily FII/DII buy/sell/net; `?csv=true` returns CSV |
| `GET /api/corporates-corporateActions?index=equities[&symbol=X]` | none | — | **WORKS** | low | full CA history per symbol: exDate, subject, ISIN |
| `GET /api/corporate-announcements?index=equities` | none | — | **WORKS** | low | filings/announcements |
| `GET /api/annual-reports?index=equities&symbol=X` | none | — | **WORKS** | low | annual report links |
| `GET /api/quote-equity?symbol=X` | none | — | **BLOCKED** | — | Akamai 403 "Access Denied" (ref #18... edgesuite) |
| `GET /api/equity-stockIndices`, `/api/liveEquityDerivatives`, `/api/option-chain-indices`, `/api/quote-derivative`, `/api/board-meetings`, `/api/equity-archives` | none | — | **BLOCKED (404)** | — | "Resource not found" — endpoints removed/moved, not an auth issue |
| `GET /api/indicesHistory`, `/api/historical/indicesHistory`, `/api/historical/securityArchives` | none | — | **BLOCKED (503/404)** | — | Akamai edge rejects these |
| Bhavcopy `archives.nseindia.com/content/historical/...` | none | — | **BLOCKED** | — | 404 on known-good files; `nsearchives` → HTTP/2 INTERNAL_ERROR for bhavcopy paths (but `nsearchives` serves corporate-announcement PDFs fine, 200); `www1` → TLS alert |
| `GET https://www.nseindia.com/` (cookie bootstrap) | — | — | **BLOCKED** | — | homepage 403 → cookie bootstrap impossible |

Cookie-bootstrap test: homepage 403s, so no session cookie can be obtained; passing whatever cookies we got did not change endpoint verdicts (quote-equity stayed 403; others already worked without cookies).

Sample (fiidiiTradeReact):
```json
[{"buyValue":"14295.49","category":"DII","date":"14-Aug-2026","netValue":"356.4","sellValue":"13939.09"},
 {"buyValue":"12854.44","category":"FII/FPI","date":"14-Aug-2026","netValue":"508.12","sellValue":"12346.32"}]
```

Sample (corporates-corporateActions?symbol=TCS):
```json
[{"bcEndDate":"-","comp":"Tata Consultancy Services Limited","exDate":"15-Jul-2026",
  "faceVal":"1","isin":"INE467B01029","recDate":"15-Jul-2026","series":"EQ",
  "subject":"Interim Dividend - Rs 12 Per Share","symbol":"TCS"}, ...]
```

## 2. BSE — bseindia.com

| Endpoint | Auth | Rate limits | Verdict | ToS risk | Notes |
|---|---|---|---|---|---|
| `api.bseindia.com/BseIndiaAPI/api/StockReachGraph/w?scripcode=X&fromdate=Y&todate=Z` | none | untested | **WORKS** | low | daily OHLC history (Reliance tested, 30 KB) |
| `api.bseindia.com/BseIndiaAPI/api/CorporateAction/w?scripcode=X` | none | — | **FLAKY per-scrip** | low | dividends/splits/bonus history; worked for 500325 (RELIANCE), 301-redirects to a members-only page for 570001 (TATAMOTORS) |
| `api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w?...` | none | — | **WORKS** | low | corporate announcements feed (51 KB, latest day) |
| Bhavcopy `www.bseindia.com/download/BhavCopy/Equity/EQ*.zip` | session | — | **BLOCKED** | — | 200 but returns HTML SPA fallback, not a zip (post-redesign; needs browser session) |
| `api.bseindia.com/BseIndiaAPI/api/StockResultGetData/w?...` | none | — | **BLOCKED (302)** | — | redirects to error page |
| Homepage | none | — | WORKS | — | no WAF on site |

Verdict: BSE APIs are the most open official Indian source found — announcements, corporate actions, and historical OHLC work without auth. Bhavcopy zip needs a captcha/session flow (documented as future work; not needed while NSE publication APIs + Yahoo work).

## 3. CDSL / NSE FII-DII published data

| Source | Verdict | Notes |
|---|---|---|
| NSE `/api/fiidiiTradeReact` (+ `?csv=true`) | **WORKS** | official daily FII/DII numbers, previous trading day; use this |
| NSE `/api/merged-daily-reports?key=favoi` | 200 but empty (`"No Data Found"`) — appears populated only on trading days/hours; treat as FLAKY |
| CDSL `cdslindia.com` FII-DII pages | **BLOCKED (404)** | site restructured; `/Investors/FII-DII-Data` and `/fiidiidatewise.html` both 404; no direct CSV paths found in sitemap. Not worth pursuing while NSE works |

## 4. Screener.in

| Endpoint | Auth | Rate limits | Verdict | ToS risk | Notes |
|---|---|---|---|---|---|
| `GET /api/company/search/?q=&v=3&fts=1` | none | none observed (5 rapid calls, all 200) | **WORKS** | **HIGH** | JSON search by name |
| `GET /company/X/consolidated/` | none | — | **WORKS** | **HIGH** | full fundamentals page, ~230 KB HTML, parseable |
| `GET /api/company/{id}/peers/` | none | — | HTML fragment | **HIGH** | returned HTML, not clean JSON |

ToS explicitly prohibits automated access. Recommendation: manual-grade, low-frequency, enrichment only (a handful of requests/hour, never bulk). Keep it out of hot paths.

## 5. Yahoo Finance

The curl-subprocess pattern from `web/src/lib/marketData.ts` is the proven fetch path (undici gets TLS-fingerprinted and 429'd; curl passes).

| Endpoint | Verdict | Notes |
|---|---|---|
| `v8/finance/chart/{symbol}?range=&interval=&events=div%2Csplit%2CcapitalGain` | **WORKS (dev-proven) / BLOCKED during throttle** | live-tested today: IP-wide 429 on query1+query2 simultaneously; `events` object carries splits/dividends |
| `v7/finance/spark?symbols=A,B,C&range=1d&interval=5m` | **WORKS (dev-proven) / BLOCKED during throttle** | used for ticker tape; "more lenient than quote under rate limits" per marketData.ts |
| `v10/finance/quoteSummary/{symbol}?modules=...` | **WORKS (assumed) / BLOCKED during throttle** | fundamentals + analyst targets (financialData, summaryDetail, assetProfile); 429'd today, so live check pending |
| `v1/finance/search?q=` | **WORKS (assumed) / BLOCKED during throttle** | symbol search; 429'd today |
| HTML pages (`finance.yahoo.com/quote/...`) | **WORKS** | 200 even while JSON APIs 429 |

Rate-limit behavior observed today (2026-08-16): every JSON endpoint returned 429 for 3+ hours straight (17:00–20:00+ IST, still blocked at task end), all endpoints at once (v8/v10/v7/search), on query1+query2, IPv4+IPv6, every edge IP, with and without cookie+crumb bootstrap, over HTTP/1.1 and HTTP/2 — the throttle is **per-IP, endpoint-agnostic, and long-lived** (it outlived active traffic; no `Retry-After` header). HTML pages stay 200. Individual bursts trigger the app's 60 s cooldown in marketData.ts. A probe loop (`/tmp/opencode/yahoo_probe.log`) is still measuring recovery; an auto-launcher re-runs the corporate-actions PoC the moment a 200 appears. **Consequence: at scale we need an IP pool (see §10); even the current single-user terminal's ticker tape (spark batches every 90 s) plus chart navigation can exhaust the IP budget — the Groww/Moneycontrol fallbacks are load-bearing, not optional.**

## 6. Groww

| Endpoint | Auth | Verdict | Notes |
|---|---|---|---|
| `groww.in/v1/api/charting_service/v2/chart/exchange/{NSE\|BSE}/segment/CASH/{sym}/{resolution}?endTimeInMillis=&size=` | header `x-app-id: growwWeb` | **WORKS** | real candles incl. volume; used as Yahoo fallback in marketData.ts |
| Same path for indices (`exchange=INDICES`/`NSE_INDEX`, `segment=INDEX`) | same | **BLOCKED (400)** | value-conversion errors on every variant tried; use Yahoo `^NSEI`/`^BSESN` for indices |
| `v1/api/stocks/search/v1/...` (several variants) | same | **BLOCKED (404)** | search endpoints not confirmed; symbol lookup stays on our own instrument DB |

## 7. Moneycontrol priceapi

| Endpoint | Auth | Verdict | Notes |
|---|---|---|---|
| `priceapi.moneycontrol.com/techCharts/indianMarket/stock/history?symbol=&resolution=1D&from=&to=&countback=&currencyCode=INR` | none | **FLAKY→WORKS today** | 2/2 requests 200 with `"s":"ok"` today; historically Akamai-flaky. Keep as fallback #2 (long ranges), behind Groww |

## 8. Upstox CDN instrument masters

| Endpoint | Auth | Verdict | Notes |
|---|---|---|---|
| `assets.upstox.com/market-quote/instruments/exchange/complete.json.gz` | none | **WORKS** | 3.4 MB gzip; NSE+BSE instruments with ISIN, segment, lot size — ideal for symbol→ISIN master |
| `assets.upstox.com/market-quote/{exchange}/{sym}` quotes | none | **BLOCKED (403)** | not needed |

## 9. Google Finance

| Endpoint | Verdict | Notes |
|---|---|---|
| `google.com/finance/quote/{SYM}:NSE` | **FEASIBLE / FLAKY** | 302 → `/finance/beta/quote/...`; 200 with `AF_initDataCallback` embedded JSON (symbol present in payload). No API contract, obfuscated JS payloads, bot detection risk. Last-resort only. Live confirmation 2026-08-16: while Yahoo was IP-blocked, the dev app's chart API returned candles with `source: "google"` for RELIANCE and NIFTY — parsing works in practice |

## 10. Proxy / VPS options to unblock NSE official APIs (documented only — nothing purchased)

1. **India-region VPS** (DigitalOcean BLR1, Linode Mumbai, AWS ap-south-1, GCP asia-south1): datacenter ranges are often Akamai-flagged by NSE, but the block is rule-based and varies; a cheap box is worth a test run before committing. ~$5–12/mo.
2. **ISP/residential proxies** (Bright Data, Oxylabs, SOAX): highest pass rate, expensive (~$5+/GB), overkill for EOD-only data.
3. **Recommended stance**: we already have working official paths for every pipeline we need (NSE publication APIs + BSE APIs + bhavcopy via BSE session flow in future). A VPS is only justified if we later need live NSE quotes (quote-equity) or bhavcopy archives at scale. Note NSE redistrib-live-data restrictions; our terminal is EOD/delayed, which stays compliant.

---

## Recommended data architecture

Priority order per pipeline (1 = primary):

**EOD candles**
1. Yahoo `v8 chart` via curl (NIFTY 50 + extended universe; `.NS`/`.BO`; `^NSEI`/`^BSESN` for indices) — with split adjustment from `events` (see below)
2. Groww chart API (equities, `x-app-id: growwWeb`) — fallback, short windows daily
3. Moneycontrol priceapi — fallback for long ranges
4. (future, offline) NSE/BSE bhavcopy CSVs as ground-truth reconciliation

**Fundamentals**
1. Yahoo `v10 quoteSummary` (summaryDetail, assetProfile, financialData, defaultKeyStatistics)
2. Screener.in pages (sparing; ToS risk — enrichment only)
3. NSE `corporate-announcements` + `annual-reports` (filing links, low frequency)

**Analyst data**
1. Yahoo `quoteSummary` modules `financialData` (targetMeanPrice/targetMedianPrice/numberOfAnalystOpinions), `recommendationTrend`, `earningsTrend`

**Breadth / market stats**
1. NSE `allIndices` (adv/decl, P/E, P/B, DY per index)
2. NSE `market-data-pre-open?key=ALL`
3. NSE `fiidiiTradeReact` (+csv) — FII/DII flows

**Corporate actions**
1. Yahoo `v8 chart` `events=div,split,capitalGain` (PoC: `scripts/fetch-corporate-actions.mjs`) — full history; primary
2. NSE `corporates-corporateActions?index=equities&symbol=X` — fallback + cross-check to classify bonus vs split (Yahoo cannot distinguish); note: caps at ~20 most-recent rows/symbol and has coverage gaps (TATAMOTORS returns 0 rows; demerger-type actions not listed)
3. BSE `CorporateAction/w` — secondary confirmation, flaky per-scripcode

**Symbol / ISIN master**
1. Upstox CDN `complete.json.gz` (ISIN mapping)
2. NSE `equity-master` (index constituents by name)

**Indices intraday/tape**
1. Yahoo `v7 spark` (batch of 24 symbols) — current ticker tape pattern
2. NSE `allIndices` (EOD index levels, P/E etc.)

---

## Split-adjustment algorithm (spec for `eod_candles.adj_factor`)

> **SUPERSEDED (2026-08-23) — see `docs/adr/0002-eod-price-lineage.md`.**
> The premise "raw candles stay intact" never held: the primary chain (Yahoo v8) serves
> *already adjusted* closes, so per-date event factors double-adjusted the series. The live
> path now normalizes bases empirically at write time (`scripts/lib/basis.mjs`); `adj_factor`
> sits at 1 and this spec survives only as reference for a future true-raw vendor.

Goal: continuous adjusted price series across corporate actions, stored per-symbol as a
monotonic adjustment factor so raw candles stay intact and views can switch raw↔adjusted.

Definitions: `adj_factor(symbol, date)` — multiplier applied to raw prices to make the
pre-event series comparable to post-event prices. `splitRatio` "2:1" → `ratio = 2`.

**Split/bonus on ex-date `D` with ratio `R`:**

1. On first ingest of a symbol, `adj_factor` starts at `1` and is recomputed
   end-to-end from the earliest event to the latest:
   `adj_factor = adj_factor * R` for every event **on or after** its ex-date
   (equivalently: `adj_factor_new = adj_factor_prev / R` for candles **before** the ex-date —
   convention below picks one; the codebase must use it consistently).
2. Storage: `adj_factor` is a **per-date** column on `eod_candles`:
   - `raw_close` as fetched,
   - `adj_factor` = product of all ratios with `ex_date <= candle_date`,
   - `adj_close = raw_close * adj_factor` (open/high/low use the same factor for that row).
3. Example (1:1 bonus on 2024-06-21, ratio 2, previous adj_factor 1):
   - candles with `date < 2024-06-21`: `adj_factor = 1`, `adj_close = raw_close`
   - candles with `date >= 2024-06-21`: `adj_factor = 2`, `adj_close = raw_close * 2`
   - any later 5:1 split: post-date factor becomes `2 * 5 = 10`.
4. Consequence: pre-event candles get multiplied by `R` (i.e. the classic
   "old prices ÷ R" direction in price space; factor-space is multiplication).
   The task's formula `adj_factor = adj_factor / ratio` is the inverse convention
   (divide pre-event prices); **pick multiplication-on/after-ex-date** as the canonical
   one because it composes cleanly left-to-right over time.
5. Dividends: not applied to prices (price-only adjustment). Dividend yield/history
   lives in `corporate_actions` for the dividend calendar UI.
6. Late-arriving events (announcement recorded after ex-date): re-run the factor
   recomputation for that symbol (idempotent: rebuild from `corporate_actions`
   ordered by date, never patch in place).
7. DB wiring happens in a later task; `data/corporate_actions.json` is the PoC feed.
