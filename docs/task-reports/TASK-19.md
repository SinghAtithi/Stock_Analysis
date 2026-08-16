# TASK-19 — Value family: S099 HML + S076 Net-Net + S078 Low P/E + S080 Magic Formula

Status: COMPLETE (2026-08-16)
Files: `web/src/lib/strategies/strategies/s099-value.ts` (created),
`scripts/tests/value.test.mjs` (created), this report.
Ownership: my three files only — no changes to registry.ts, run-signals.mjs,
ingest-*.mjs, package.json, LOG/ROADMAP/RANKINGS.

## Formulas + source keys

All four are cross-sectional: raw metric → universe z-score (population
std) → score = clamp(50 + 50·z, 0, 100). One shared distribution loader
(per-context/day cache, concurrency 10, mirroring demo-roc20).

- **S099 B/M**: `bm = 1/priceToBook` (≡ total book equity / marketCap).
  Fallback `bookValue/lastClose`. Deviation from task wording documented:
  Yahoo `bookValue` is PER-SHARE, so `bookValue/marketCap` is dimensionally
  wrong (B·S² scale); `1/priceToBook` is the exact B/M.
- **S076 NCAV**: `(currentAssets − totalLiabilities) / marketCap`. T10
  flattenMetrics does NOT emit these keys, so read defensively:
  metrics_json `currentAssets ?? totalCurrentAssets` and `totalLiabilities`,
  else raw module_json `balanceSheetHistory.balanceSheetStatements[0].
  totalCurrentAssets / totalLiabilities`.
- **S078 EY**: `earningsYield` (=1/trailingPE) with direct `1/trailingPE`
  fallback.
- **S080 Magic Formula**: `ebitEv = operatingIncome / EV` with
  `EV = marketCap + totalDebt − totalCash` (EV>0 guard); `roic =
  returnOnCapital`, fallback `EBIT/(totalAssets − totalCash)`. Score =
  equal-weight z-mean of the two (degrades to one when the other is null).
- **Composite** (component of every signal): equal-weight z-mean of all five
  metrics → 0-100. Components: `{bm, ncav, ey, ebitEv, roic, composite,
  sampleSize}`.

## Hand-verified fixtures (tests/value.test.mjs)

Universe A/B/C/D — mcap 1000/500/2000/400, P/B 2.0/5.0/1.0/0.8, P/E
20/10/50/8, debt 200/400/100/0, cash 100/50/300/100, EBIT 110/68/90/60,
ROIC 0.20/0.10/0.30/0.15, CA/TL 800/300, 300/250, 900/800, 600/100 →
bm 0.50/0.20/1.00/1.25; ncav 0.50/0.10/0.05/1.25; ey 0.05/0.10/0.02/0.125;
EV 1100/850/1800/300; ebitEv 0.10/0.08/0.05/0.20. Hand z-scores e.g.
bm −0.577/−1.307/0.638/1.246 → S099 clamps B→0, D→100. Scores cross-checked
against an independent inline mean/std implementation in the test (exact
match to 2dp). 25 tests: valueMetrics unit ratios, NCAV dual-shape keys,
B/M fallback, EV guards (zero/negative EV → null ebitEv), NaN/string
coercion, rankings + clamp endpoints per strategy, composite equality,
missing-row/partial-data/1-symbol/no-getFundamentals/no-getUniverse → null,
never throws.

## Test results

`node --experimental-strip-types --test scripts/tests/value.test.mjs` →
**25/25 pass**. `npx tsc --noEmit` clean for my file; `npx eslint
src/lib/strategies/strategies/s099-value.ts` clean.

## Real run (empty DB)

Temp script against the real DB (fundamentals 0 rows, read-only): nifty50
50 symbols, all four strategies → **0 signals, 0 failed, exit 0**. Seeded
in-memory run scores correctly (HDFCBANK leads NCAV/composite, TATAMOTORS
leads EY, RELIANCE leads B/M).

## Blockers / notes

- Runner `makeContext` (run-signals.mjs) does not wire `getFundamentals`
  yet — real DB signals require that wiring (data/runner task, not mine to
  touch). Strategy handles an absent `getFundamentals` gracefully.
- NCAV keys absent from flattenMetrics → dual-shape read; consider adding
  `currentAssets`/`totalLiabilities` to T10 flattening.
- Concurrent agents mid-edit: quality.ts/s172-dual.ts/backtest/engine.ts
  have their own tsc errors — not mine, not touched.
