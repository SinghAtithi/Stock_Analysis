# TASK-15 — signals/backtests consume split-adjusted closes

**Status:** shipped · **Agents:** SABLE (wiring), NOVA (verification + data-truth correction) · **Date:** 2026-08-23

## What was requested

Signals and backtests read `eod_candles.c` raw; `adj_factor` was never applied.
ACs: wire both runners through an adjusted read boundary, fixture test for
split continuity, dividend-policy doc, re-run snapshots and diff.

## What verification actually found

The task's premise did not survive contact with the data. Evidence sweep over
all 53 stored series (`eod_candles`, 135k rows):

| probe | raw `c` series | `c × adj_factor` |
|---|---|---|
| >40% single-day moves | **0** | **12** |

Every one of the 12 lands exactly on a factor boundary: BAJFINANCE.NS
2016-09-08 factor 1→5 (+410%), TATASTEEL.NS 2022-07-28 1→10 (+946%),
EICHERMOT.NS 2020-08-24 1→10 (+903%), etc. Raw closes are continuous across
each ex-date because **the Yahoo v8 chain stores already split-adjusted
closes** (TATASTEEL July-2022 raw ≈ ₹96 where true unadjusted traded ≈ ₹950).
`recomputeAdjFactors` then composed event ratios *on top* → double
adjustment → fake cliffs that would have poisoned every score once wired.

Two additional latent blockers found while verifying:

1. **Unit mismatch** — `run-signals.mjs` computed `since` in milliseconds
   against a seconds epoch column → every real-candle query returned 0 rows.
2. **Symbol-space mismatch** — universes are bare (`RELIANCE`) while candles
   are keyed `.NS`; combined with (1) this meant the signal pipeline had
   never successfully read a real candle (historic snapshots were
   fixtures-mode synthetic).

## Changes

- `scripts/lib/adjust.mjs` — `toAdjustedCandles()` read boundary (kept; safe at identity, correct when a raw vendor lands). Wired into both runners.
- `scripts/run-signals.mjs` — seconds-based window; DB-symbol resolution (bare→`.NS`); adjusted mapping.
- `scripts/run-backtest.mjs` — same boundary for the bulk loader.
- `scripts/tests/adjust.test.mjs` — split continuity, OHLC scaling, invalid-factor guard.
- `scripts/ingest-eod.mjs` — `recomputeAdjFactors` call disabled with premise warning in both docstrings.
- `docs/backtest.md` — verified adjustment status, dividend limitation (price-only returns), upgrade path.
- Data fix — reset 33,520 corrupted factors to 1 (recomputable from `corporate_actions` anytime); post-reset cliff count: **0**.
- Follow-up filed: **TASK-26** (per-source provenance ADR, Yahoo re-basing drift, raw-vendor decision).

## Result

`run-signals.mjs`: 150 signals from real candles across `demo-roc20`,
`demo-52wlow` and `S100` (registry expanded by TASK-19 mid-task); backtests
trade the continuous series through the same boundary.
