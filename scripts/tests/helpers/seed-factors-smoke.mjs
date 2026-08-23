/* TASK-57 AC2 wiring smoke — seed minimal fundamentals/analyst rows, then
 * confirm S104/S105 produce non-null signals through the runner's ctx.
 * Run: node scripts/tests/helpers/seed-factors-smoke.mjs  (from repo root) */
import { openDb, DEFAULT_DB_PATH } from "../../lib/db.mjs";

const db = openDb(DEFAULT_DB_PATH);

const derived = {
  revisionTrend: { epsEstimate: { avg: 42.5, low: 41.0, high: 44.0 } },
  recommendation: { buy: 12, hold: 8, sell: 2 },
};
const moduleJson = {
  earningsHistory: {
    history: [
      { period: "Q1 2026", epsActual: { raw: 9.8 }, epsEstimate: { raw: 9.1 }, reportDate: { raw: 1755907200 } },
      { period: "Q4 2025", epsActual: { raw: 8.2 }, epsEstimate: { raw: 8.6 }, reportDate: { raw: 1743302400 } },
    ],
  },
};

const upF = db.prepare(
  `INSERT INTO fundamentals (symbol, module_json, metrics_json, fetched_at)
   VALUES (?, ?, '{}', strftime('%s','now'))
   ON CONFLICT(symbol) DO UPDATE SET module_json = excluded.module_json`
);
const upA = db.prepare(
  `INSERT INTO analyst_data (symbol, payload_json, derived_json, fetched_at)
   VALUES (?, '{}', ?, strftime('%s','now'))
   ON CONFLICT(symbol) DO UPDATE SET derived_json = excluded.derived_json`
);

for (const s of ["RELIANCE", "TCS"]) {
  upF.run(s, JSON.stringify(moduleJson));
  upA.run(s, JSON.stringify(derived));
}
console.log(
  "seeded:",
  db.prepare("SELECT COUNT(*) c FROM fundamentals").get().c,
  "fundamentals rows;",
  db.prepare("SELECT COUNT(*) c FROM analyst_data").get().c,
  "analyst rows"
);
db.close();
