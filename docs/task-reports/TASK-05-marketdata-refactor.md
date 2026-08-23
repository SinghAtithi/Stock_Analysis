# TASK-05 — marketData deep-module refactor: builder, singleflight, budget

**Status:** shipped · **Agent:** CIPHER · **Date:** 2026-08-23
**Scope:** `web/src/lib/marketData.ts` — `getChart` was ~210 lines with the fallback payload
construction block duplicated ×4 (MC-intraday, MC-index, MC-daily, Groww), no request coalescing,
and no overall time ceiling on the fallback chain.

## Change

**1. Shared `fallbackPayload(base, src)` (AC1)** — one construction path for all non-Yahoo
sources: instrument name join, `previousCloseFromCandles`, `dayChange`, and the ≥250-distinct-
IST-days 52W rule (`allow52W=false` for intraday sources → 52W nulls, matching old behaviour).
Optional `filterFuture` (MC intraday's upcoming-session bar drop) and `degraded` (Groww 1d/5d)
are per-call flags. `getChart` is now **22 lines**; the ordered fallback chain lives in
`chartChain` as a list of attempts returning `payload | null | CHAIN_STOP`.

**2. Singleflight (AC2)** — `inflows: Map<cacheKey, Promise>`; concurrent identical requests
await one in-flight chain instead of stampeding upstreams. Map entry is deleted in `finally`.

**3. Upstream budget (AC3)** — `UPSTREAM_BUDGET_MS = 12s` for the whole chain. Every attempt is
raced against remaining budget (`withinBudget`); once spent, remaining fallbacks are skipped and
the request resolves via stale-while-revalidate (6h window) or fail-fast null — exactly the AC's
"budget then stale/fail-fast".

## Behaviour parity (AC4) — byte-exact

Pre/post captures from :3000 across all five branch shapes (market closed ⇒ static data):

| Query | Source hit | Candles | Verdict |
|---|---|---|---|
| RELIANCE 1y/1d | moneycontrol daily | 261 | identical |
| TCS 1mo/15m | moneycontrol intraday | 501 | identical |
| NIFTY index 5d/5m | google | 6 | identical |
| RELIANCE BSE 6mo/1h | moneycontrol | 501 | identical |
| SENSEX index 1mo/1h | moneycontrol index | 25 | identical |

All scalar fields + full candle arrays byte-equal (`PARITY: ALL MATCH`). Guards preserved
verbatim during review: `!isIndex` on MC-intraday/daily+Groww, `!dot` on Google/MC-index,
caret→`.NS` index ordering, equity cross-exchange Yahoo retry, MC-intraday hard-null when all
bars are future-dated.

## Verification (AC5)

`tsc --noEmit` clean · `npm test` green (incl. TASK-07 parser suites + TASK-10 fidelity suites)
· lint 0 errors.

## Incident note (build unblock)

Mid-task, the concurrent backtest-route work introduced untyped `require("better-sqlite3")`,
breaking the shared production build (and briefly :3000). Added
`web/src/types/better-sqlite3.d.ts` ambient declaration to unblock; their route landed moments
later as part of their own commit sequence.
