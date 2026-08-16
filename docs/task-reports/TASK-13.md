# TASK-13 — Breadth & flows pipeline + /api/breadth

Status: DONE. Files: `scripts/ingest-breadth.mjs`, `scripts/tests/breadth.test.mjs`,
`web/src/app/api/breadth/route.ts`, `data/raw/breadth/` (raw cache, gitignored).

## Sources observed (2026-08-16, live)

**India VIX — Yahoo `v8 chart ^INDIAVIX` (primary): STILL 429 (IP-throttled ~7 h).**
Fallback engaged: Google Finance `google.com/finance/quote/INDIA_VIX:INDEXNSE?hl=en`
(curl, HTML). Response: 1 MB page with `AF_initDataCallback` blocks; the record
`[["INDIA_VIX","INDEXNSE"], gid, null, [[[1],[[[y,m,d,15,30,…],[close,chg,chgPct,…]],…]]]]`
embeds a 1 M daily close series (22 points, daily bars stamped 15:30 IST — 5-min blocks
are filtered out by that hour/min discriminator). Stored as **`vix_spot`** (22 rows,
2026-07-16 → 2026-08-14, close 11.31). Cross-checked vs NSE `allIndices` "INDIA VIX"
last=11.32 ✓. Same-day duplicate closes collapsed (keep latest).

**FII/DII — NSE `GET /api/fiidiiTradeReact` (WORKS, no auth):** returns ONLY the latest
trading day, exactly 2 rows — no history, no equity/debt split (`?csv=true` same).
```json
[{"buyValue":"14295.49","category":"DII","date":"14-Aug-2026","netValue":"356.4","sellValue":"13939.09"},
 {"buyValue":"12854.44","category":"FII/FPI","date":"14-Aug-2026","netValue":"508.12","sellValue":"12346.32"}]
```
Mapped to `{date, fii_equity:null, fii_debt:null, di_equity:null, di_debt:null,
fii_total, di_total}` (₹ Cr net). `merged-daily-reports?key=fiidii` → `"No Data Found"`
(rejected). Running the ingest daily accumulates ~1 row per trading day.

**Breadth — computed from `eod_candles` (name `breadth`):** eod_candles was 1-symbol
partial (concurrent agent's ingest) → bootstrapped `node scripts/ingest-eod.mjs
--universe nifty50 --quick` (50/50 symbols, 17,890 candles, all via Moneycontrol —
Yahoo 429). A/D + 52W (rolling 252d incl. current day, symbol must have ≥252 closes)
computed per day, gap-safe (own previous close). 340-day span computed, newest 30
stored. 2026-08-14: adv=11 dec=39 unc=0 hi=0 lo=1 (50 symbols). The
`breadth_spot` path (Yahoo 1d → Moneycontrol 1y → Google 1M, per-symbol) is
implemented and unit-tested but unused this run (eod path won).

## CLI

`node scripts/ingest-breadth.mjs [--days N]` (default 30). Idempotent
`INSERT … ON CONFLICT(name,ts) DO NOTHING`; re-run today: vix_spot 0 new/22 skipped,
fiidii 0/1, breadth 0/30 ✓. Summary JSON on stdout.

## Route — GET /api/breadth

Joins per-day across names (prefers `vix`/`breadth` over `vix_spot`/`breadth_spot`),
newest first; 300 s in-process cache + `Cache-Control: public, s-maxage=300`;
empty `days` + null sources when the DB is missing/empty. Sample (live, :3000):

```json
{"date":"2026-08-14","vix":11.31,"fii_equity":null,"fii_debt":null,"di_equity":null,
 "di_debt":null,"fii_total":508.12,"di_total":356.4,"adv":11,"dec":39,"unc":0,"hi":0,"lo":1}
meta: {"as_of":"2026-08-14","sources":{"vix":"vix_spot","fii":"fiidii","ad":"breadth"}}
```
30 days returned. DB read via `better-sqlite3` (Next externalizes it) with
`createRequire` + inline types (no @types present).

## Tests

`node --test scripts/tests/breadth.test.mjs` → 4/4 pass: A/D incl. gap days,
52W boundary (251 vs 252 closes; mid-window stock excluded), upsert idempotency
(skip + no overwrite), fiidii parser. `npx tsc --noEmit` ✓, `npm run lint` ✓.

## Blockers

- Yahoo 429 persists → vix history + breadth_spot sit behind fallbacks; when Yahoo
  recovers, `vix` (1 y) and `breadth_spot` rows populate automatically.
- `node --test scripts/tests/` (dir arg) is broken on Node 22.17 (tries to require the
  dir); glob form works — package.json already uses it.
- Pre-existing failures in `scripts/tests/fundamentals.test.mjs` (network) and
  `strategies.test.mjs` (.ts import) — other agents' files, untouched.
- fiidii history: endpoint caps at latest day; acceptable for the flows dashboard
  (fills one row per daily run).
