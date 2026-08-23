# Backtests & price adjustment

## Where candles come from

Backtests (`scripts/run-backtest.mjs`) and signal runs (`scripts/run-signals.mjs`)
read daily bars from SQLite (`eod_candles`) through a single read boundary:
`toAdjustedCandles()` in `scripts/lib/adjust.mjs`. That helper multiplies
OHLC by the per-row `adj_factor`; volume is passed through raw.

## Adjustment status (verified 2026-08-23)

The Yahoo v8 chain stores **already split-adjusted closes** in `eod_candles.c`
— verified by scanning all 53 stored series: zero >40% daily jumps raw,
while composing event factors on top injected 12 fake 100–950% cliffs
(BAJFINANCE +410%, TATASTEEL +946%, …). Consequences:

- `toAdjustedCandles()` remains the single read boundary for strategies and
  backtests, but until a truly-raw vendor lands it must see `adj_factor = 1`
  (factors were reset 2026-08-23; `recomputeAdjFactors` is no longer called
  during ingest — its docstring carries a premise warning).
- The `adj_factor` machinery (algorithm + unit tests) is kept intact for the
  day a raw-priced source is wired in; then the boundary starts multiplying
  with no consumer changes.
- Data-lineage follow-up: resolved by **ADR-0002** (`docs/adr/0002-eod-price-lineage.md`) —
  bases are now normalized empirically on every write (`scripts/lib/basis.mjs`), guarded by the
  `eod-cliff-sweep` CI test.

**Dividends are NOT adjusted** either way: backtest returns are price
returns. For large-cap Indian universes (NIFTY 50) dividend yield averages
roughly 1–2%/yr; relative rankings are largely unaffected, but absolute
performance understates true holder return by about that much.

## Benchmark semantics (TASK-10)

The engine benchmark is **fixed-weight equal-weight, recenters daily** — not
share-count buy-and-hold. Concretely (`web/src/lib/backtest/engine.ts`):
weights are 1/N over symbols priced on day 0 and never change; each day's
benchmark return is the weight-averaged constituent return; equity compounds
multiplicatively. This equals an equal-weight index rebalanced daily.

Consequences:
- Daily recentering adds a small systematic "rebalancing premium" vs true
  buy&hold (Shannon-rebalance effect): the benchmark slightly sells winners
  into losers every day. For a 50-name universe this is typically a few bps
  per year — immaterial for relative comparisons, which is the benchmark's
  only job.
- Strategy portfolios themselves trade only at monthly rebalances with
  drifted weights between dates, so strategy-vs-benchmark comparisons embed
  that asymmetry. Documented, accepted.

## Scoring model (TASK-10)

- `SnapshotScorer` (backtest CLI path) reads precomputed snapshots — pure,
  O(log n) per lookup.
- `StrategyScorer` (live path) batches all eligible symbol scores per
  rebalance date via `Promise.all`; strategies memoize cross-sectional
  builds per context **including the in-flight promise**
  (`pending` WeakMaps in s100/s172/s174/S099/quality), so concurrent calls
  share one build instead of stampeding duplicates.
- Measured: snapshot-path scoring is not a bottleneck (full 8.5y × 50-symbol
  backtest ≈ 3s end-to-end incl. DB load).

## Known limitations

- Survivorship: universes are today's index constituents applied backward.
  Delisted symbols never appear — the classic upward bias. Quantified order
  of magnitude: US large-cap studies put survivorship uplift at roughly
  +0.5–1.5%/yr for equal-weight universes over multi-decade windows; Indian
  NIFTY-family churn is comparable. Treat absolute CAGRs as optimistic by
  about that much; cross-strategy rankings on the same universe are far less
  affected (shared bias). Backfills of historical constituent sets are the
  real fix (ROADMAP data platform).
- Empty-window runs: if signal-snapshot history is thinner than the window,
  no portfolio forms and the run stays flat at 1.0 — the CLI now warns loudly
  instead of printing a meaningless metrics table.
- Intraday chains (chart panel) are raw-feed prices; they do not consume
  `eod_candles` and are unaffected by this document.
