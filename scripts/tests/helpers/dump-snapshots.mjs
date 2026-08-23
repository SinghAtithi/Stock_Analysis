import { openDb, DEFAULT_DB_PATH } from "../../lib/db.mjs";

const db = openDb(DEFAULT_DB_PATH);
const rows = db
  .prepare(
    `SELECT s.strategy_id, s.symbol, s.score, s.rank FROM signal_snapshots s
     JOIN (SELECT strategy_id, MAX(as_of) a FROM signal_snapshots GROUP BY strategy_id) m
     ON m.strategy_id = s.strategy_id AND m.a = s.as_of
     ORDER BY s.strategy_id, s.rank`
  )
  .all();
console.log(JSON.stringify(rows));
db.close();
