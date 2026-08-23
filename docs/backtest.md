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
- Data-lineage follow-up (raw-vs-adjusted provenance per chain source,
  Yahoo re-basing drift on incremental fetches) is tracked on the board.

**Dividends are NOT adjusted** either way: backtest returns are price
returns. For large-cap Indian universes (NIFTY 50) dividend yield averages
roughly 1–2%/yr; relative rankings are largely unaffected, but absolute
performance understates true holder return by about that much.

## Known limitations

- Survivorship: universes are today's index constituents applied backward.
  Delisted symbols never appear. (Filed for ADR treatment — see ROADMAP.)
- Intraday chains (chart panel) are raw-feed prices; they do not consume
  `eod_candles` and are unaffected by this document.
