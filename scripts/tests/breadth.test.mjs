import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { openDb } from "../lib/db.mjs";
import { applyMigrations } from "../migrate.mjs";
import {
  computeBreadthSeries,
  dayKey,
  upsertBreadthRows,
  parseFiiDii,
} from "../ingest-breadth.mjs";

function tempDb() {
  const dir = mkdtempSync(path.join(tmpdir(), "niftyterm-breadth-test-"));
  const db = openDb(path.join(dir, "test.db"));
  return { dir, db };
}

const D = (i) => i * 86_400; /* fixture day keys: i trading days from epoch */

test("A/D math on fixture candle set including gap days", () => {
  /* Symbol A: day1=100, day2=110 (up), day3 GAP, day4=105 (down vs its own prev), day5=105 (unchanged).
   * Symbol B: day1=50, day2=45 (down), day4=45 (unchanged), day5=60 (up). */
  const series = new Map([
    ["A", [{ ts: D(1), c: 100 }, { ts: D(2), c: 110 }, { ts: D(4), c: 105 }, { ts: D(5), c: 105 }]],
    ["B", [{ ts: D(1), c: 50 }, { ts: D(2), c: 45 }, { ts: D(4), c: 45 }, { ts: D(5), c: 60 }]],
  ]);
  const rows = computeBreadthSeries(series, { window: 2 });

  assert.equal(rows.length, 4, "union of days 1,2,4,5");
  const byDay = Object.fromEntries(rows.map((r) => [r.ts, r]));

  /* day1: no prev-day comparison possible for either symbol */
  assert.deepEqual(
    [byDay[D(1)].adv, byDay[D(1)].dec, byDay[D(1)].unc],
    [0, 0, 0],
    "first day contributes nothing to adv/dec"
  );

  /* day2: A up, B down; window(2) -> A hi (110>=max(100,110)), B lo (45<=min(50,45)) */
  assert.deepEqual(
    [byDay[D(2)].adv, byDay[D(2)].dec, byDay[D(2)].unc, byDay[D(2)].hi, byDay[D(2)].lo],
    [1, 1, 0, 1, 1],
    "day2 adv/dec/hi/lo"
  );

  /* day4 (gap day 3 missing): A down vs day2 close, B unchanged vs day2 close */
  assert.deepEqual(
    [byDay[D(4)].adv, byDay[D(4)].dec, byDay[D(4)].unc],
    [0, 1, 1],
    "gap day compares against each symbol's own previous close"
  );
  /* window(2) on day4: A 105 ties its window low (110,105) -> lo; B 45 ties (45,45) -> hi+lo */
  assert.deepEqual([byDay[D(4)].hi, byDay[D(4)].lo], [1, 2]);

  /* day5: A unchanged (105==105), B up (45->60) */
  assert.deepEqual(
    [byDay[D(5)].adv, byDay[D(5)].dec, byDay[D(5)].unc],
    [1, 0, 1],
    "day5 adv/dec/unc"
  );
  assert.deepEqual([byDay[D(5)].hi, byDay[D(5)].lo], [2, 1], "day5 hi/lo");
});

test("52W window boundary: stock added mid-window does not contribute", () => {
  /* X has exactly 252 closes (window full on day252, not on day251).
   * Y has only 100 closes — never reaches a full window. */
  const make = (symbol, n) => ({
    [symbol]: Array.from({ length: n }, (_, i) => ({ ts: D(i + 1), c: 100 })),
  });
  const series = new Map([
    ...Object.entries(make("X", 252)),
    ...Object.entries(make("Y", 100)),
  ]);
  const rows = computeBreadthSeries(series, { window: 252 });

  const day251 = rows.find((r) => r.ts === D(251));
  const day252 = rows.find((r) => r.ts === D(252));

  assert.ok(day251, "day251 present");
  assert.equal(day251.hi, 0, "251 closes < window -> no 52W contribution");
  assert.equal(day251.lo, 0);
  assert.ok(day252, "day252 present");
  assert.equal(day252.hi, 1, "252 closes -> X qualifies; Y (100 closes) does not");
  assert.equal(day252.lo, 1);
});

test("upsert idempotency: existing dates are skipped and not overwritten", (t) => {
  const { dir, db } = tempDb();
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  applyMigrations(db);

  const rows = [
    { ts: D(10), payload: { date: "2026-08-10", adv: 5, dec: 3, unc: 2, hi: 1, lo: 0 } },
    { ts: D(11), payload: { date: "2026-08-11", adv: 1, dec: 9, unc: 0, hi: 0, lo: 1 } },
  ];

  const first = upsertBreadthRows(db, "breadth", rows);
  assert.equal(first.inserted, 2);
  assert.equal(first.skipped, 0);

  /* re-run with a different payload for the same dates -> all skipped, originals kept */
  const second = upsertBreadthRows(db, "breadth", [
    { ts: D(10), payload: { date: "2026-08-10", adv: 99 } },
    { ts: D(11), payload: { date: "2026-08-11", adv: 99 } },
  ]);
  assert.equal(second.inserted, 0);
  assert.equal(second.skipped, 2);

  const count = db.prepare("SELECT COUNT(*) AS n FROM breadth_series WHERE name = 'breadth'").get();
  assert.equal(count.n, 2, "no duplicate rows");

  const row = db
    .prepare("SELECT payload_json FROM breadth_series WHERE name = 'breadth' AND ts = ?")
    .get(D(10));
  assert.equal(JSON.parse(row.payload_json).adv, 5, "existing payload not overwritten");
});

test("parseFiiDii maps the observed NSE response shape", () => {
  const fixture = [
    { buyValue: "14295.49", category: "DII", date: "14-Aug-2026", netValue: "356.4", sellValue: "13939.09" },
    { buyValue: "12854.44", category: "FII/FPI", date: "14-Aug-2026", netValue: "508.12", sellValue: "12346.32" },
  ];
  const row = parseFiiDii(fixture);
  assert.ok(row, "parses observed shape");
  assert.equal(row.payload.date, "2026-08-14");
  assert.equal(row.payload.fii_total, 508.12);
  assert.equal(row.payload.di_total, 356.4);
  assert.equal(row.ts, dayKey(Date.parse("2026-08-14T00:00:00Z") / 1000));
  assert.equal(parseFiiDii([{ category: "DII", date: "14-Aug-2026", netValue: "1" }]), null, "missing FII row rejected");
});
