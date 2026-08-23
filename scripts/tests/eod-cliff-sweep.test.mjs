/**
 * TASK-26 AC4 — backfill verification as a standing CI gate.
 * Sweeps every eod_candles series for impossible single-day moves (>40%).
 * Real Indian equities never move that much in a day; a hit means bases were
 * spliced or adjustment corrupted — exactly the TASK-15/26 incident class.
 *
 * Skips (does not fail) when the local DB is absent or thin, so fresh
 * checkouts and CI runners without ingested data stay green.
 *
 * Run: npm test  (from web/)  ·  node --test scripts/tests/eod-cliff-sweep.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import { openDb, DEFAULT_DB_PATH } from "../../scripts/lib/db.mjs";

const CLIFF = 0.4;
const MIN_ROWS = 1000; // below this the sweep proves nothing

test("eod_candles series contain no >40% single-day moves", () => {
  if (!existsSync(DEFAULT_DB_PATH)) return; // no data yet — nothing to verify
  if (statSync(DEFAULT_DB_PATH).size < MIN_ROWS * 64) return; // thin fixture db
  const db = openDb(DEFAULT_DB_PATH);
  try {
    const symbols = db.prepare("SELECT DISTINCT symbol FROM eod_candles").all().map((r) => r.symbol);
    if (symbols.length === 0) return;
    const offenders = [];
    for (const s of symbols) {
      const rows = db.prepare("SELECT ts, c FROM eod_candles WHERE symbol = ? ORDER BY ts").all(s);
      for (let i = 1; i < rows.length; i++) {
        const prev = rows[i - 1].c;
        if (prev > 0 && Math.abs(rows[i].c / prev - 1) > CLIFF) {
          offenders.push(`${s} @ ${new Date(rows[i].ts * 1000).toISOString().slice(0, 10)}`);
        }
      }
    }
    assert.deepEqual(offenders, [], `basis-splice cliffs detected (run scripts/ingest-eod.mjs to re-reconcile): ${offenders.slice(0, 10).join(", ")}`);
  } finally {
    db.close();
  }
});
