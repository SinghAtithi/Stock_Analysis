# TASK-14 — Strategy framework + registry + scheduler

**Owner**: quant engineer · 2026-08-16

## Framework shape
- `web/src/lib/strategies/types.ts` — erasable-only TS: `StrategyMeta` (id, name, category, `juryRank`/`edgeScore` nullable — RANKINGS.md "Final rank" + "Mean Edge Score"; null = not yet juried), `Signal` (score 0-100, rank, `Record<string, number|string|null>` components), `StrategyContext` (getCandles + optional getFundamentals/getAnalyst/getUniverse), `Strategy`.
- `indicators.ts` — pure, NaN-safe: `sma`, `ema`, `roc`, `zscore`, `pctRank` (tie-averaged 0-100), `safeDiv`. Never throw; null where undefined.
- `registry.ts` — `register`/`getStrategy`/`listStrategies` (juryRank asc, nulls last, id tie-break). Demo strategies self-register at import.
- `demo/roc20.ts` — ROC(20), scored as cross-sectional pctRank (distribution cached per-context, invalidated daily).
- `demo/52wlow.ts` — inverted distance from trailing 252-day high, per-symbol, 0-100.
- `scripts/run-signals.mjs` — resolves universe from `instruments.json` `idx` (deduped; verified field names), loads eod_candles read-only, ranks score-desc 1..N, clear+insert per (strategy, as_of) in one transaction. `--fixtures` = deterministic in-memory synthetic candles (50/symbol, nothing written to DB).

## Strip-types verdict
`node --experimental-strip-types` works on Node v22.17.0, **but** relative imports must carry `.ts` extensions (extensionless → `ERR_MODULE_NOT_FOUND`). tsc forbids `.ts` extensions without `allowImportingTsExtensions` (tsconfig not mine to edit). **Resolution: a 12-line `module.registerHooks` resolve hook** (zero deps, Node ≥22.15) in `run-signals.mjs` + `strategies.test.mjs` appends `.ts` to extensionless relative specifiers; strategies import each other extensionless; type-only imports use `import type` (fully erased). Verified working.

## Test results
`npm test` → **52 pass / 1 fail**. The failure (`fundamentals.test.mjs` "fetch failure without cache") is **pre-existing** — fails on baseline `node --test` without my flag/imports; file owned by the data agent. One transient breadth flake seen in the first combined run, then 4 clean runs (temp-DB file, likely a race with the parallel ingest agent). My 14 strategy tests: indicators NaN-safety/fixtures, pctRank distribution, both demo strategies on synthetic fixtures (rising > flat > falling; at-52w-high = 100), registry ordering incl. null-juryRank last + tie determinism.

## Signals run
Real DB: **eod_candles partially populated mid-ingest by parallel agent** (1 symbol "ADANIENT", 2651 rows, timestamps in 1970 epoch → corrupt/in-flight). Runner correctly filtered → 0 signals, 0 failures, no writes. **Fixtures mode**: 50/50 nifty50 symbols scored per strategy; `signal_snapshots` verified — ranks 1..50, components_json serialized, clear+insert per as_of (two as_of buckets across runs).

## Blockers
None. Note: `MODULE_TYPELESS_PACKAGE_JSON` warning when loading .ts (web/ has no `"type": "module"`) — cosmetic; adding it would be a whole-app change. Pre-existing fundamentals test failure needs the data agent (not mine to fix).
