/**
 * TASK-34 — backfill evaluation stamps.
 * Run: npm test  (from web/)  ·  node --test scripts/tests/stamps.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { monthEndBefore, backfillStamps } from "../../scripts/lib/stamps.mjs";

const DAY = 86_400;

test("monthEndBefore lands on the last second of the target month", () => {
  // Wed 2026-08-23T10:00:00Z
  const now = Date.UTC(2026, 7, 23, 10) / 1000;
  assert.equal(monthEndBefore(now, 0), Date.UTC(2026, 7, 31, 23, 59, 59) / 1000);
  assert.equal(monthEndBefore(now, 1), Date.UTC(2026, 6, 31, 23, 59, 59) / 1000);
  assert.equal(monthEndBefore(now, 2), Date.UTC(2026, 5, 30, 23, 59, 59) / 1000); // Jun has 30d
});

test("year boundary rolls correctly (Jan → Dec of prior year)", () => {
  const jan15 = Date.UTC(2026, 0, 15) / 1000;
  const dec31 = monthEndBefore(jan15, 1);
  const d = new Date(dec31 * 1000);
  assert.equal(d.getUTCFullYear(), 2025);
  assert.equal(d.getUTCMonth(), 11);
  assert.equal(d.getUTCDate(), 31);
});

test("leap February handled", () => {
  const mar2024 = Date.UTC(2024, 2, 5) / 1000; // Mar 5 2024
  const febEnd = monthEndBefore(mar2024, 1);   // one month-end back → Feb
  assert.equal(new Date(febEnd * 1000).getUTCMonth(), 1);
  assert.equal(new Date(febEnd * 1000).getUTCDate(), 29); // 2024 is a leap year
});

test("backfillStamps: N months → N-1 month-ends + final current stamp, strictly increasing", () => {
  const now = Math.floor(Date.UTC(2026, 7, 23) / 1000);
  const stamps = backfillStamps(now, 6);
  assert.equal(stamps.length, 6);
  assert.equal(stamps[stamps.length - 1], now);
  for (let i = 1; i < stamps.length; i++) assert.ok(stamps[i] > stamps[i - 1], "increasing");
  // first stamp = 5 month-ends before Aug ⇒ end of Mar 2026
  const first = new Date(stamps[0] * 1000);
  assert.equal(first.getUTCMonth(), 2); // March
});

test("backfillStamps with months=1 degenerates to [now]", () => {
  const now = 1_900_000_000;
  assert.deepEqual(backfillStamps(now, 1), [now]);
});
