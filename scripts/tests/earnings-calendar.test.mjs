import test from "node:test";
import assert from "node:assert/strict";

/* TASK-1539 — earningsCalendar honesty contract: the /calendar page leans on
   this static curated table plus two pure helpers (upcoming filter, staleness
   counter). No suite covered them. Pure module, no shims needed. */

const cal = await import("../../web/src/lib/earningsCalendar.ts");

test("upcoming filter drops past events and sorts ascending", () => {
  const out = cal.getScheduledResults("2026-10-06");
  assert.ok(out.length > 0);
  assert.ok(out.every((e) => e.date >= "2026-10-06"));
  const dates = out.map((e) => e.date);
  assert.deepEqual(dates, [...dates].sort());
  // TCS (2026-10-05) has passed; INFY (2026-10-06) leads.
  assert.ok(!out.some((e) => e.symbol === "TCS"));
  assert.equal(out[0].symbol, "INFY");
});

test("fully aged-out table returns [] (page empty-state path)", () => {
  assert.deepEqual(cal.getScheduledResults("2027-01-01"), []);
});

test("early date returns the whole curated table", () => {
  const out = cal.getScheduledResults("2026-09-01");
  assert.equal(out.length, cal.SCHEDULED_RESULTS.length);
  assert.ok(out.length >= 30);
});

test("staleness counts days since the manual refresh", () => {
  assert.equal(cal.calendarStaleness("2026-08-29"), 0);
  assert.equal(cal.calendarStaleness("2026-09-12"), 14);
  assert.equal(cal.calendarStaleness("2026-09-13"), 15);
});

test("stale boundary: flag trips only past STALE_AFTER_DAYS", () => {
  assert.equal(cal.STALE_AFTER_DAYS, 14);
  const isStale = (today) => cal.calendarStaleness(today) > cal.STALE_AFTER_DAYS;
  assert.equal(isStale("2026-09-12"), false); // exactly 14 — fresh
  assert.equal(isStale("2026-09-13"), true); // 15 — stale chip
});

test("invalid input degrades to 0, never NaN", () => {
  assert.equal(cal.calendarStaleness("not-a-date"), 0);
  assert.ok(Number.isFinite(cal.calendarStaleness("")));
});

test("dataset invariants hold for every curated event", () => {
  const times = new Set(["After market hours", "During trading hours", "Scheduled"]);
  const filings = new Set(["NSE", "BSE", "Both"]);
  const symbols = new Set();
  for (const e of cal.SCHEDULED_RESULTS) {
    assert.ok(e.symbol.length > 0 && e.name.length > 0 && e.sector.length > 0);
    assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(times.has(e.time), `bad time for ${e.symbol}`);
    assert.ok(filings.has(e.filing), `bad filing for ${e.symbol}`);
    assert.ok(!symbols.has(e.symbol), `duplicate ${e.symbol}`);
    symbols.add(e.symbol);
  }
});

test("honesty constants are present and wired", () => {
  assert.ok(cal.CALENDAR_SOURCE_LABEL.length > 0);
  assert.match(cal.CALENDAR_AS_OF, /^\d{4}-\d{2}-\d{2}$/);
});
