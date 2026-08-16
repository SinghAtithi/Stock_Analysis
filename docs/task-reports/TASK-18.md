# TASK-18 — Quality trio: S096 Gross Profitability + S102 RMW proxy + S095 Accruals

**Owner**: quant engineer · 2026-08-16

## Deliverables
- `web/src/lib/strategies/strategies/quality.ts` — one self-contained strategy module `S18-quality` (registry wiring lands with a later task; `registry.ts` untouched). Exports `computeQuality` (pure per-symbol extraction), `buildComposite` (pure cross-sectional scoring), `qualityStrategy`.
- `scripts/tests/quality.test.mjs` — 17 tests (all pass).
- This report. No other files touched; committed files only: these three.

## Metric formulas + exact source keys
All inputs come from `scripts/ingest-fundamentals.mjs` `flattenMetrics()` (flat shape = `metrics_json`, exact keys below) or the raw `module_json` (quoteSummary.result[0], nested shape). Both shapes accepted and fixture-verified.

- **S096** `gpA = grossProfit / totalAssets`. Source chain (nested): `financialData.grossProfits` → `financialData.grossProfit` → `incomeStatementHistory[0].grossProfit` → derivation `totalRevenue − costOfRevenue` (income statement). Flat: `grossProfit` (populated by T10 from `financialData.grossProfits` — documented in flattenMetrics).
- **S102** `opMargin = operatingIncome / totalRevenue` (`financialData` preferred, income statement fallback; flat keys `operatingIncome`, `totalRevenue`).
- **S095** `accruals`, two documented variants:
  - **ΔNOA (preferred)**: `NOA = totalAssets − cash − (totalLiabilities − totalDebt)` — simplification: non-debt liabilities = TL − TD, so NOA = operating assets net of operating liabilities; `accruals = (NOA_cur − NOA_prior) / avg(totalAssets)` from `balanceSheetHistory.balanceSheetStatements[0..1]` (full depth on both years required; cash aliases `cash`/`cashAndShortTermInvestments`/`cashCashEquivalentsAndShortTermInvestments`, TL aliases `totalLiabilities`/`totalLiabilitiesNetMinorityInterest`).
  - **Sloan CFO proxy (fallback)** when depth is missing: `(netIncome − CFO) / avg(totalAssets)`, avg = (TA_cur+TA_prior)/2 else TA_cur; flat shape uses T10's `accrual_netIncome`, `accrual_operatingCashFlow`, `accrual_totalAssetsCur`, `accrual_totalAssetsPrior`. Component `accrualModel: "noa"|"cfo"|null` records the variant.
- Higher accruals = lower quality → inverted in the composite.

## Composite
- z per metric = `(x − mean)/max(std, 1e-9)`, clamped ±3, over the run's universe (n ≥ 3); composite z = equal-weight `(zGp + zOp − zAcc)/3`.
- score 0-100 = equal-weight mean of per-metric tie-averaged percentile ranks (`pctRank`), accrual rank inverted — the robust transform of the z composite that stays meaningful for small cross-sections.
- Single-symbol run (documented transform): lone values sit at percentile 0; with all 3 metrics the inversion yields a deterministic 33.33 placeholder; z components null when n < 3. Never NaN, never throws.
- Components: `{gpA, opMargin, accruals, zGp, zOp, zAcc, composite, accrualModel, sampleSize}`.
- Meta: id `S18-quality`, juryRank 4 / edgeScore 9.0 = best of family (S096), documented in description.

## Test results
- `node --experimental-strip-types --test scripts/tests/quality.test.mjs` → **17/17 pass**: hand-computed S096 (300/1000 = 0.3), S102 (180/950), ΔNOA (NOA 600/510, Δ 90/950 = 0.0947368), CFO proxy (20/950, −20/1000), income-statement GP source + derivation, `{raw,fmt}`/string coercion, missing/NaN/zero data → null components (no crash), 3-fixture z logic (z = √(3/2), composite 100/50/0), partial-row composite, strategy-level cross-section, empty-DB graceful null, no-getFundamentals runner shape, single- and two-symbol universes, meta honesty.
- Empty-DB real run: simulated runner contexts (no `getFundamentals`; `getFundamentals → null`) over 5 symbols → 0 signals, exit 0.
- `npx tsc --noEmit` clean; my files lint-clean (repo-wide lint has 658 pre-existing errors in other agents' in-flight files — `next.config.ts`/`tsconfig.json` T21 changes and untracked strategies; confirmed present without my changes).

## Blockers
None for this task. Notes: fundamentals table still empty (Yahoo throttle, T10) — strategy fixture-verified, degrades to null gracefully. `S18-quality` is not yet in the registry (runner wiring is a later task's file); registered via import when the runner adopts fundamental-backed strategies.
