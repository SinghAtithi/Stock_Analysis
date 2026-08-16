# TASK-20 — S081 Piotroski F-Score (jury rank #9)

**Owner**: quant engineer · 2026-08-16 · Files: `web/src/lib/strategies/strategies/s081-fscore.ts`
(created), `scripts/tests/fscore.test.mjs` (created), this report.

## Implementation

Self-registering (calls `register()` on import from `../registry`), erasable-only TS —
no enums/namespaces/parameter properties, `import type` for types, so Node's native
type stripping loads it. `compute()` never throws (try/catch → null).

**Null rule**: a criterion whose inputs are missing is *unknown* (not false). If
unknown count ≥ 4 → whole signal `null` (too little prior-year data to be meaningful).
Emitted signals count unknown criteria as not-passing (conservative). Score
`0-100 = (fscore/9)*100`, `round2`.

## Criterion → stored key mapping

Current-year values read from the flat `metrics_json` (flattenMetrics EXACT keys);
prior-year values read from the raw `module_json` histories (flattenMetrics only
flattens one year; the two-year accrual inputs are the `accrual_*` keys below).
`getFundamentals` is expected to return the fundamentals row with parsed
`metrics_json`/`module_json`; a bare flat-metrics object is also accepted.

| # | Criterion | Cur (metrics_json) | Prior (module_json) |
|---|-----------|--------------------|----------------------|
| 1 | ROA > 0 | `netIncome` (fallback `accrual_netIncome`) / `totalAssets` (fallback `accrual_totalAssetsCur`) | — |
| 2 | OCF > 0 | `accrual_operatingCashFlow` | — |
| 3 | ΔROA > 0 | as p1 | `incomeStatementHistory[1].netIncome` / `accrual_totalAssetsPrior` (fallback `balanceSheetStatements[1].totalAssets`) |
| 4 | CFO > NI | `accrual_operatingCashFlow` vs p1's `netIncome` | — |
| 5 | Δleverage < 0 | `totalDebt` / assets | `balanceSheetStatements[1].totalDebt` / prior assets |
| 6 | Δcurrent ratio > 0 | `balanceSheetStatements[0].currentAssets/currentLiabilities` | `balanceSheetStatements[1].currentAssets/currentLiabilities` |
| 7 | No dilution | **`defaultKeyStatistics.sharesOutstanding`** (documented key; not flattened) | `balanceSheetStatements[1].totalCommonSharesOutstanding` |
| 8 | Δgross margin > 0 | `grossProfit` / `totalRevenue` | `incomeStatementHistory[1].grossProfit` / `.totalRevenue` |
| 9 | Δasset turnover > 0 | `totalRevenue` / assets | prior revenue / prior assets |

Denominators must be > 0 (`ratio()` returns null otherwise); all values
null-safe through `num()`/`rawOf()` (accepts `{raw, fmt}` and numeric strings).

## Fixture verification (hand-computed)

Perfect company (score 9/9 = 100): NI 500, assets 5000, prior assets 4500,
OCF 600, debt 1000, revenue 2000, GP 800; prior NI 400, prior debt 1200,
prior revenue 1500, prior GP 550, CR 3.0→2.0, shares 100≤120.
ROA 0.10>0 · OCF 600>0 · ΔROA 0.10>0.0889 · CFO>NI 600>500 · ΔLev 0.20<0.2667 ·
ΔCR 3.0>2.0 · shares 100≤120 · ΔGM 0.40>0.3667 · ΔTurn 0.40>0.3333 → **9/9**.

Worst company (score 0): NI −100, OCF −150 (both periods' priors worse or neutral
on every axis) → all nine fail → **0/9**.

Missing prior-year (flat metrics only, no `module_json`) → 6/9 unknown ≥ 4 → **null**.
Per-criterion flips verify each inequality on exact numbers (e.g. ΔLev 0.27>0.2667
→ p5=0; CR 1.0<2.0 → p6=0; GM 0.4333>0.40 → p8=0; turnover 0.5111>0.40 → p9=0;
coupled inputs netIncome/OCF flip p1+p3 / p2+p4 jointly — asserted as exact vectors).
One missing prior (shares only) → emitted with fscore 8, p7=0, score 88.89.

## Test results

`node --experimental-strip-types --test scripts/tests/fscore.test.mjs` → **9/9 pass**.
Empty-DB cases: `getFundamentals → null` ⇒ null; context without `getFundamentals`
⇒ null; throwing `getFundamentals` ⇒ null (never throws).
Real run vs live `db/data/app.db` (fundamentals = 0 rows): `compute("RELIANCE")`
→ **null, exit 0** (verified via /tmp/opencode/t20-realrun.mjs).
`npx tsc --noEmit` + eslint: **clean for my files** (remaining tsc/lint errors are
concurrent agents' in-flight T15–T19 files + a modified tsconfig — not mine).
Meta: id `S081`, category `value`, juryRank 9, edgeScore 8.67 (RANKINGS.md),
universe nifty500, `inputs: []`.

## Blockers

None. Live scoring waits on the fundamentals fill (Yahoo throttle, T10 report);
the strategy already nulls gracefully. Note: run-signals.mjs does not yet wire
`getFundamentals` into the context (later task — not in T20 scope).
