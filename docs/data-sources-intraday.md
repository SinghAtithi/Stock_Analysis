# Intraday Data Sources — Live-Test Verdict & Chosen Architecture

Tested from this machine (2026-08-16, Sunday; NSE closed — last session Fri 2026-08-14) via the
same `curl` subprocess pattern used in `web/src/lib/marketData.ts`. Test symbols: RELIANCE (NSE
equity), NIFTY 50 (index), SENSEX (index).

## Verdict table

| Source | Endpoint | Auth | Rate limits (observed) | ToS note | Sample | Verdict |
|---|---|---|---|---|---|---|
| Google Finance | `https://www.google.com/finance/quote/RELIANCE:NSE?hl=en` (HTML w/ embedded `AF_initDataCallback` JSON) | none | none hit (scraping Google pages is against Google ToS; low-volume internal use) | scraping ToS grey area | 73×5m OHLCV (last session) + 22 daily OHLC + quote (prevClose/change) | **USE** |
| Yahoo Finance | `query1/query2.finance.yahoo.com/v8/finance/chart` | none | 429 from this IP for the entire session (IP-level block; curl passes but is throttled) | API is unofficial | n/a (throttled) | primary (existing) |
| TradingView | `symbol-search.tradingview.com/symbol_search/v3/` | none | **HTTP 403 nginx** | ToS prohibits scraping | — | no |
| TradingView | `data.tradingview.com/history` | session token | **SSL EOF** (connection killed) | ToS prohibits | — | no |
| TradingView | `scanner.tradingview.com/india/scan` | none | none hit | ToS prohibits | snapshot only (close/change/vol), no history | snapshot only — not used |
| AngelOne SmartAPI | `apiconnect.angelone.in/rest/secure/...` | login JWT required | — | needs broker login | — | no (key needed) |
| Upstox UDAPI | `api.upstox.com/v2/market-quote/...` | OAuth token | — | needs broker login | — | no (key needed) |
| NSE | `www.nseindia.com/api/quote-equity`, `chart-databyindex` | session cookie | **Akamai 403** from this IP (confirmed) | official but bot-walled | — | no |
| Groww | `groww.in/v1/api/charting_service/v2/chart/.../NSE/segment/CASH/<sym>/5` | `x-app-id: growwWeb` | none hit | unofficial API | intraday resolutions (`1`,`5`,`15`,`60`,`1min`,`5min`) all **404** — daily/weekly/monthly only | daily fallback only |

## Google Finance page anatomy (reverse-engineered)

The quote page embeds `AF_initDataCallback({key:'ds:N', hash:..., data: <JSON>, sideChannel:{...}});`
blocks (ends with `);` optionally followed by `, true|false`, always before `</script>`).
Relevant blocks for `RELIANCE:NSE` / `NIFTY_50:INDEXNSE` / `SENSEX:INDEXBOM`:

- **Series records** — `rec = [['RELIANCE','NSE'], '/g/1dv5zf_w', 'INR', [series...], null, 19800, prevClose, name, intervalSec, 0]`
  - `rec[6]` = previous close, `rec[7]` = name, `rec[8]` = interval seconds (300 = 5m, 86400 = daily).
  - Series row: `[open, close, high, low, "ISO+05:30 end-time", volume]` (ordering verified by
    cross-checking 5m closes against the 1-minute series: e.g. 5m bar labeled 09:20 close 1310.6 =
    1m close at 09:20).
  - `ds:12`-style = 5m OHLCV for the **last trading day only** (~73 bars, 09:15–15:15); `ds:14`-style
    = daily OHLCV (~22 bars, one month); `ds:11` = 1m closes, `ds:13` = daily closes (not used).
- **Quote records** — layout differs between equity and index (and between ds:10/ds:17), so the
  parser does **not** trust offsets here; it derives prevClose from `change / (changePct/100)`
  (`rec[9]`, `rec[11]`) only as a fallback.
- **Not on the page**: 52-week range, 15m multi-day intraday, BSE equities
  (`RELIANCE:BOM` returns a generic Google Finance title — BSE not supported).
- Verified tickers: `NIFTY_50:INDEXNSE`, `NIFTY_BANK:INDEXNSE`, `NIFTY_NEXT_50:INDEXNSE`,
  `NIFTY_IT:INDEXNSE`, `NIFTY_FIN_SERVICE:INDEXNSE`, `SENSEX:INDEXBOM`, `<SYM>:NSE` for equities.

## Chosen architecture

Yahoo remains primary for **all** ranges. For `1d/5m` and `5d/15m`, Google Finance is the
first fallback (after the two Yahoo hosts and the BSE↔NSE cross-exchange retry):

1. **1d** → Google 5m series (or 1m/15m if 5m absent). Interval mapped accordingly.
2. **5d** → no source verified for multi-day intraday ⇒ graceful degrade: last 6 daily bars from
   Google's daily series, `interval: "1d"`, payload flag `degraded: "daily"` → ChartPanel renders
   a bordered `DAILY` chip next to the source/interval readout.
3. BSE equities (Google doesn't serve them) → existing Groww daily fallback, also flagged
   `degraded: "daily"` for 1d/5d.
4. If Google parse fails and no fallback works → upstream 404 for intraday, as before.

Quote semantics for the Google payload: `regularMarketPrice` = last candle close,
`previousClose` = series record `rec[6]` (fallback: change/pct-derived, then
`previousCloseFromCandles`), `change = price − prevClose`, `changePct = change/prevClose·100`,
52W = null (page never contains ≥250 trading days — never faked from window min/max).

Verification numbers (all matched Google's own published quote):
- RELIANCE 1d: prevClose 1317.00, price 1308.70, change −8.30, −0.6302% (Google: 1308.7, −8.300049, −0.63022393)
- NIFTY 1d: prevClose 24395.85, price 24366.00, change −29.85, −0.1224% (Google: 24366, −29.84961, −0.122355275)
- SENSEX 1d: prevClose 78079.96, price 78009.25
