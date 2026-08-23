-- 0002_perf_indexes.sql (TASK-56): composite indexes matching real query shapes.
-- idx_eod_candles_symbol_ts serves the per-symbol time-window reads in
-- run-signals/repair (WHERE symbol = ? AND ts >= ?) instead of symbol-index
-- + row scan. idx_backtest_runs_created_at serves listRuns' ORDER BY
-- created_at DESC LIMIT 50.
CREATE INDEX IF NOT EXISTS idx_eod_candles_symbol_ts ON eod_candles (symbol, ts);
CREATE INDEX IF NOT EXISTS idx_backtest_runs_created_at ON backtest_runs (created_at);
