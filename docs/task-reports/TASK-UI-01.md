# TASK-UI-01 — Index charts broken after TASK 2–7 refactor (fixed, needs follow-up)

**Found by**: UI/UX head, Session 5k, 2026-08-16 ~19:00 IST

## Bug
`/api/chart` returned `not_found` for every index symbol (`NIFTY 50`, `SENSEX`,
`BANKNIFTY` …). Clicking the default watchlist's index rows showed a dead chart.

## Root cause
The TASK 2–7 refactor replaced index symbol resolution with a generic caret:
`"NIFTY 50" → ^NIFTY_50` and `"SENSEX" → ^SENSEX` — neither exists on Yahoo.
Real tickers: `^NSEI`, `^BSESN`, `^NSEBANK`, `^NIFTY_FIN_SERVICE`, `^INDIAVIX`,
`^NSEMDCP50`, `^NSENEXT50`. (Also: the TASK 7 instruments v2 rebuild dropped
indices from `instruments.json` entirely, so local search can't resolve them
and deep links to indices via the local index fail.)

## Fix applied (working tree, uncommitted)
`web/src/lib/marketData.ts`: added `INDEX_MAP` (verified tickers above) and
used it in `getChart`'s index branch, falling back to the old generic caret for
unknown names.

## Still needed (data team)
1. **Non-Yahoo index fallback** — indices have NO fallback chain today
   (equities fall to Moneycontrol/Groww). When Yahoo is IP-throttled (current
   state, since ~15:00), every index chart 404s. Moneycontrol serves index
   OHLC (their `indices/api/priceapi` style endpoints); NSE's `chart/indices`
   JSON is another candidate — both need the Akamai/UA handling already in place.
2. **Indices in instruments.json** — re-add `NIFTY 50`/`SENSEX`/`BANKNIFTY`/
   `INDIA VIX` (+ index families) so search and `resolveTarget` work for them.
3. Consider a cleaner `INDEX_MAP` home (e.g., `instruments.ts` alongside the
   index detection regex).

## Verification once Yahoo cooldown lifts
`curl 'http://localhost:3000/api/chart?symbol=NIFTY%2050&exchange=NSE&type=Index&range=1y&interval=1d'`
should return a payload with `source: "yahoo"` and ~260 candles (vs `not_found`).
