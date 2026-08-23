# TASK-34 — walk-forward snapshot backfill

**Status:** shipped · **Agent:** NOVA · **Date:** 2026-08-23

**Motivation:** after the TASK-20 purge, `signal_snapshots` held only current-day ranks.
`SnapshotScorer` picks the latest `as_of <= rebalanceDate`, so every backtest showed
`investedDays=0, cagr=0` — nothing to score against history.

## Changes

- **Point-in-time contract** (`web/src/lib/strategies/types.ts`): optional
  `ctx.now(): number` (epoch ms). All wall-clock logic in strategies now flows through
  `evalNow(ctx)/evalDay(ctx)` (`pointInTime.ts`): the six distribution-cache day keys
  (roc20, S100, S099, S172, S174, quality) and S104's event-age window. Without this,
  multi-stamp backfills reuse stale caches keyed on the real present.
- **Runner** (`scripts/run-signals.mjs`): `--as-of YYYY-MM-DD` pins one evaluation instant;
  `--backfill-months N` sweeps the last N month-ends plus today. `getCandles` windows anchor
  to the stamp (no lookahead); DELETE+INSERT per `(strategy_id, as_of)` keeps reruns idempotent.
  Both flags hard-reject `--fixtures` (synthetic data can never reach snapshots — TASK-20).
- **Static guard** (`scripts/tests/point-in-time.test.mjs`): no strategy source may reference
  `Date.now()` directly; plus determinism test (same candles at two as-of stamps ⇒ identical scores)
  and evalNow/evalDay contract tests. Stamp math covered in `scripts/tests/stamps.test.mjs`
  (month-end rolls, year boundary, leap Feb).

## Verification

- `run-signals S100 --backfill-months 92 --universe nifty50`: 92/92 stamps × 50 signals,
  zero failures; S100 snapshot history now 98 distinct as_of stamps / 4,900 real rows.
- `run-backtest S100 --start 2018-01-01`: **CAGR +20.40% vs bench +17.26%, Sharpe 0.749 vs 0.664,
  exposure 87.44%, turnover 11.6%/yr** over 2,141 trading days / 104 rebalances.
  The strategy leg is alive for the first time.

## Notes / follow-ups

- Repeated same-day runs each get a fresh `as_of` second → near-duplicate current-day sets.
  Harmless for scoring (latest wins) but worth deduping in a future pass (TASK-28 adjacent).
- Remaining registry strategies can be backfilled with the same one-liner; left to scheduler cron.
