CREATE TABLE IF NOT EXISTS instruments (
  s TEXT PRIMARY KEY,
  e TEXT,
  n TEXT,
  sector TEXT,
  industry TEXT,
  indices_json TEXT,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS eod_candles (
  symbol TEXT NOT NULL,
  ts INTEGER NOT NULL,
  o REAL,
  h REAL,
  l REAL,
  c REAL,
  v REAL,
  adj_factor REAL DEFAULT 1,
  PRIMARY KEY (symbol, ts)
);

CREATE TABLE IF NOT EXISTS quotes (
  symbol TEXT PRIMARY KEY,
  price REAL,
  prev_close REAL,
  change REAL,
  change_pct REAL,
  ts INTEGER,
  source TEXT
);

CREATE TABLE IF NOT EXISTS fundamentals (
  symbol TEXT PRIMARY KEY,
  module_json TEXT,
  metrics_json TEXT,
  fetched_at INTEGER
);

CREATE TABLE IF NOT EXISTS analyst_data (
  symbol TEXT PRIMARY KEY,
  payload_json TEXT,
  derived_json TEXT,
  fetched_at INTEGER
);

CREATE TABLE IF NOT EXISTS corporate_actions (
  symbol TEXT NOT NULL,
  ts INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT,
  PRIMARY KEY (symbol, ts, type)
);

CREATE TABLE IF NOT EXISTS signal_snapshots (
  strategy_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  score REAL,
  rank INTEGER,
  components_json TEXT,
  as_of INTEGER NOT NULL,
  PRIMARY KEY (strategy_id, symbol, as_of)
);

CREATE TABLE IF NOT EXISTS breadth_series (
  name TEXT NOT NULL,
  ts INTEGER NOT NULL,
  payload_json TEXT,
  PRIMARY KEY (name, ts)
);

CREATE TABLE IF NOT EXISTS watchlists (
  id TEXT PRIMARY KEY,
  scope TEXT,
  data_json TEXT,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  device_id TEXT,
  type TEXT,
  payload_json TEXT,
  active INTEGER DEFAULT 1,
  created_at INTEGER,
  fired_at INTEGER
);

CREATE TABLE IF NOT EXISTS backtest_runs (
  id TEXT PRIMARY KEY,
  strategy_id TEXT,
  config_json TEXT,
  status TEXT,
  metrics_json TEXT,
  equity_json TEXT,
  created_at INTEGER,
  finished_at INTEGER
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  provider TEXT,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  applied_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_eod_candles_symbol ON eod_candles (symbol);
CREATE INDEX IF NOT EXISTS idx_signal_snapshots_strategy_as_of ON signal_snapshots (strategy_id, as_of);
CREATE INDEX IF NOT EXISTS idx_alerts_device ON alerts (device_id);
CREATE INDEX IF NOT EXISTS idx_breadth_series_name ON breadth_series (name);
