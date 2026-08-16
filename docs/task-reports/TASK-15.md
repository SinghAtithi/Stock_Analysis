# TASK-15 — S100 Momentum Factor (Jegadeesh-Titman), jury rank #1

**Owner**: quant engineer · 2026-08-16

## Deliverables
- `web/src/lib/strategies/strategies/s100-momentum.ts` — self-registering strategy (`import { register } from "../registry"` + `register(s100MomentumStrategy)` at module top; imports the module → registered, no registry.ts edit needed).
- `scripts/tests/s100.test.mjs` — 7 unit tests.
- `scripts/tests/s100-real.test.mjs` — real-DB run over Nifty 50, asserts + prints top-10.

## Scoring approach (chosen)
Mirrors demo-roc20 **exactly**: a per-context distribution cache (`WeakMap<StrategyContext, Distribution>`, day-keyed + universe-keyed) prefetches the universe's momentum once (concurrency 10), and `compute()` normalizes each symbol against that distribution with `indicators.pctRank` — the framework has no separate cross-sectional helper; the demo's in-context cache **is** the pattern. Score = pctRank of `momentum12` (0-100), never a per-symbol transform: momentum is a relative factor, so raw return → bounded score only via cross-sectional rank. `momentum1` (the skipped month) rides in components for future 12−1 combination.

## Math (as specified, t = last close)
- `momentum12 = close[t-21] / close[t-252] - 1` (12m return, last ~21 sessions skipped)
- `momentum1 = close[t-1] / close[t-21] - 1`
- Guards: <200 valid closes → null (spec floor); operative bound n ≥ 253 so `close[t-252]` exists; non-finite anchors or base ≤ 0 → null. Loads 400d via `ctx.getCandles(symbol, 400)`. ERASABLE TS only.

## Test results
`node --experimental-strip-types --test scripts/tests/s100.test.mjs` (flag from package.json `test` script): **7/7 pass** — (a) RISER > FLAT > FALLER cross-sectionally, sign checks; (b) <200 closes → null; (c) exact 12-1 math on 253-close geometric fixture (`1.001^231−1`, `1.001^20−1`, and `≠ 1.001^21−1` proving the t-21 skip); (d) flat all-equal series → momentum 0, score 50, no NaN; plus meta record + self-registration + non-finite-anchor → null. Real run: **1/1 pass**, 50/50 symbols scored (min history JIOFIN 741 rows ≥ 253).

## Real-data run (as-of 2026-08-14, eod_candles)
| rank | symbol | score | momentum12 | momentum1 |
|---|---|---|---|---|
| 1 | SHRIRAMFIN.NS | 100.00 | +0.6245 | +0.1053 |
| 2 | HINDALCO.NS | 97.96 | +0.4007 | +0.0906 |
| 3 | ADANIENT.NS | 95.92 | +0.3700 | −0.0592 |
| 4 | TITAN.NS | 93.88 | +0.3535 | +0.0947 |
| 5 | ADANIPORTS.NS | 91.84 | +0.3360 | −0.0922 |
| 6 | EICHERMOT.NS | 89.80 | +0.3088 | +0.0919 |
| 7 | SBIN.NS | 87.76 | +0.2808 | +0.0502 |
| 8 | NESTLEIND.NS | 85.71 | +0.2748 | +0.0586 |
| 9 | BAJAJ-AUTO.NS | 83.67 | +0.2633 | +0.1287 |
| 10 | APOLLOHOSP.NS | 81.63 | +0.2362 | −0.0324 |

Plausible vs the period: SHRIRAMFIN +62% 12m (skip-window), HINDALCO metals rally, TITAN, SBIN — sensible momentum leaders; negative momentum1 on top names is the classic skip-window behavior the JT construction handles.

## Observations (not blockers — not my files)
1. `run-signals.mjs` compares `ts >= since` where `since` is epoch **millis** but `eod_candles.ts` is epoch **seconds** → real runs currently return 0 candles/signals for every symbol. My real harness mirrors the query with seconds. Worth a one-line fix (data agent / T18).
2. `instruments.json` stores bare symbols (`ADANIENT`), `eod_candles` uses `.NS` — universe resolution for real runs needs the suffix map (my harness does it). Registry/demo tests unaffected.

## Verification
`npm run lint` + `npx tsc --noEmit` green (see session log). No files outside the four owned ones touched.
