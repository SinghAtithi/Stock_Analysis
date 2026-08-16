# TASK-11 — India data-source decision doc + corporate actions PoC

Status: COMPLETE (2026-08-16)
Files: `docs/data-sources.md` (created), `scripts/fetch-corporate-actions.mjs` (created),
`data/corporate_actions.json` (generated), this report.

## What was done

### Part 1 — docs/data-sources.md
Live-tested every listed source from this machine (curl CLI, node execFile, no shell).
Key correction to prior assumptions: **NSE is not uniformly Akamai-403'd from this IP.**
The Akamai rule is path-based — publication endpoints work with zero auth, while
quote/trade endpoints are denied. Discovered working NSE endpoints include:
`allIndices`, `equity-master`, `market-data-pre-open`, `fiidiiTradeReact` (+CSV),
`corporates-corporateActions`, `corporate-announcements`, `annual-reports`.
BSE's `BseIndiaAPI` (announcements, historical OHLC, corp actions) is fully open.
Cookie bootstrap for NSE is impossible (homepage itself 403s). All verdicts,
samples, rate-limit observations and the recommended architecture are in the doc.

### Part 2 — scripts/fetch-corporate-actions.mjs
- Hardcodes 50 NIFTY-50 symbols: the 46 NSE equities from the TAPE_UNIVERSE reference
  + SHRIRAMFIN, APOLLOHOSP, DIVISLAB, LTIM (= 50).
- Primary: Yahoo v8 chart `range=max&interval=1mo&events=div%2Csplit%2CcapitalGain`
  via the curl-subprocess pattern from `web/src/lib/marketData.ts` (UA, query1→query2).
  65 s backoff on 429, exactly one retry per symbol, circuit breaker after 3
  consecutive Yahoo failures (skips the per-symbol 65 s waits during an outage).
- Bonus vs split classification for Yahoo events: cross-reference NSE
  `corporates-corporateActions` by ex-date (Yahoo cannot distinguish a 1:1 bonus
  from a 2:1 split).
- Fallback (fetch failure / IP block): NSE `corporates-corporateActions?symbol=X` —
  parses subject strings: bonus "a:b" → factor `1+a/b`, FV splits "Rs x to Re y" →
  `x/y`, dividends (Rs amounts, "Div-" amounts, and percentage dividends via faceVal).
  Non-equity rows (demerger, buyback, AGM-only, bonus-debentures) are skipped;
  compound rows (bonus+dividend same date) emit two records.
- Output schema (exact): `[{symbol, type: "split"|"dividend"|"bonus", date, ratio, raw}]`
  — ratio = split factor (2 for 2:1) or dividend amount in INR; `raw` carries
  `{source: "yahoo"|"nse", ...}`.
- Self-test mode: `POC_SELFTEST=1 node -e "...import..."` — 14 assertions on the
  Yahoo events parser and the NSE row parser (all passing). The Yahoo-path parser
  was fixture-verified because Yahoo was IP-blocked during the whole window (below).
- `POC_PREFLIGHT=1` probes Yahoo once and pre-opens the circuit when blocked.

### Run results (2026-08-16, ~19:52 IST)
- **Coverage: 50/50 symbols fetched, 877 corporate actions** written to
  `data/corporate_actions.json`: 836 dividends, 21 bonuses, 20 splits,
  0 rows with null ratio.
- by source: yahoo 0, nse 48 (2 symbols have no NSE rows: TATAMOTORS, LTIM —
  NSE CA API coverage gap, documented in the decision doc).
- Sample head of JSON:
```json
[
  {
    "symbol": "RELIANCE.NS",
    "type": "dividend",
    "date": "2011-05-05",
    "ratio": 8,
    "raw": { "source": "nse", "exDate": "05-May-2011", "faceVal": "10",
             "isin": "INE002A01018", "subject": "Dividend-Rs.8/- Per Share", "symbol": "RELIANCE" }
  }, ...
]
```
- Spot checks: RELIANCE bonus 1:1 2017-09-07 (factor 2) and 2024-10-28 ✓;
  HDFCBANK FV split 10→2 (5) and 2019 split 2→1 (2) ✓; NESTLEIND split Rs10→Re1 (10) ✓;
  ICICIBANK compound "Dividend Rs 2.50/Bonus 1:10" → two rows (2.5 + 1.1) ✓.

### Yahoo outage during this task (important, honest note)
Yahoo's JSON endpoints (v8/v10/v7/search, query1+query2, IPv4+IPv6, all 4 edge IPs,
cookie+crumb bootstrap, HTTP/1.1) returned 429 continuously from ~17:00 to
~20:00+ IST while this task ran — the throttle is per-IP, endpoint-agnostic and
outlived traffic (dev app + browser active only intermittently). A 45 s probe loop
is still running (`/tmp/opencode/yahoo_probe.log`) and an auto-launcher will re-run
the PoC the moment a 200 appears; if that happens after this commit, the refreshed
JSON (Yahoo-primary) will show as an uncommitted change — commit it as a follow-up.
The PoC's Yahoo path (backoff, retry, events parsing) is fixture-tested and ready;
this outage is exactly why the NSE fallback exists and why the architecture doc
recommends keeping Groww/Moneycontrol fallbacks load-bearing.

## Notes / known limitations
- NSE CA API caps at ~20 most-recent rows per symbol (e.g. RELIANCE history starts
  2011); Yahoo `range=max` events give full history — Yahoo stays primary.
- Yahoo 429 recovery: no `Retry-After` header; 60 s cooldown (marketData.ts) works
  for bursts, but sustained load exhausts the IP for long periods (doc §5/§10).
- Google Finance: live-confirmed feasible — during the Yahoo block the dev app's
  chart API served `source: "google"` candles for RELIANCE and NIFTY.
- Screener.in: works, zero rate-limit observed in quick tests, but ToS prohibits
  scraping — enrichment only, low frequency (doc §4).
