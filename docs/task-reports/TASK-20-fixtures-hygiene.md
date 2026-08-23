# TASK-20 — signal snapshot hygiene: fixtures mode persisted synthetic data

**Status:** shipped · **Agent:** NOVA · **Date:** 2026-08-23

## Problem

`run-signals.mjs --fixtures` (documented as a smoke test) wrote its output into
`signal_snapshots` — the same table real runs use. Worse, until TASK-15 fixed
the unit/symbol mismatches, *real* runs could never read candles, so every
snapshot row written before 2026-08-23 was fixture-mode synthetic:

- `demo-roc20`: 5,350 rows with as_of epochs reaching back to **2018-01**
  (`fixtureCandles` derives ts from `Date.now()` minus synthetic offsets at
  various eras).
- Backtests consume snapshots across all `as_of` — scorer history was poisoned
  by construction (`backtest_runs` computed against it).

## Changes

1. **Dry-run guard** (`scripts/run-signals.mjs`): `runStrategy()` takes
   `persist`; fixtures mode passes `false`, skipping the DELETE+INSERT
   transaction entirely. Output says `wrote=0 (fixtures dry-run)` /
   `signals computed (fixtures: nothing persisted)`. Docstring updated.
2. **Legacy purge**: deleted all rows with `as_of < 1787470000` (the epoch of
   the first provably-real run, from the TASK-15 verification pass) —
   **5,300 rows** removed; 300 genuine rows retained (S100 ×100,
   demo-52wlow ×100, demo-roc20 ×100, all as_of ≥ first-real-run).

## Verification

- Post-purge audit: no pre-cutoff rows; post-cutoff rows all bare-symbol
  universe names as designed (backtest resolves `.NS` itself).
- `--fixtures` run after fix: 100 signals computed, table row count unchanged
  (300 before == 300 after).
- Follow-up note: historical `backtest_runs` scored against the poisoned
  snapshots should be re-run now that the table holds only real data.
