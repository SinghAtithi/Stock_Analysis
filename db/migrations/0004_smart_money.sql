-- TASK-1415: smart-money radar — block/bulk deals + insider (SAST) + promoter
-- pledge feed. Daily ingest (scripts/ingest-smart-money.mjs) writes normalized
-- rows here; /api/smart-money serves them grouped by symbol with a jury
-- strategy tag (S113/S122/S107) applied at read time (web/src/lib/smartMoney.ts).
--
-- id is a stable natural key (kind|trade_date|symbol|client|side|qty|price) so
-- re-ingests are idempotent upserts, never duplicates.
--
-- smart_money_status tracks per-source health: a source that responded with a
-- hard block (403/404/empty-on-trading-day) is recorded so the UI can show the
-- honest "Source blocked/offline" empty state instead of a bare empty list.

CREATE TABLE IF NOT EXISTS smart_money_feed (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  symbol TEXT NOT NULL,
  security_name TEXT,
  client TEXT,
  buy_sell TEXT,
  qty REAL,
  price REAL,
  value REAL,
  trade_date TEXT NOT NULL,
  source TEXT NOT NULL,
  raw_json TEXT,
  ingested_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_smart_money_symbol_date ON smart_money_feed (symbol, trade_date);
CREATE INDEX IF NOT EXISTS idx_smart_money_date ON smart_money_feed (trade_date DESC, kind);

CREATE TABLE IF NOT EXISTS smart_money_status (
  source TEXT PRIMARY KEY,
  ok INTEGER NOT NULL DEFAULT 1,
  error TEXT,
  fetched_at INTEGER NOT NULL,
  detail_json TEXT
);