import { registerHooks } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";

registerHooks({
  resolve(specifier, context, nextResolve) {
    const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
    const hasExtension = /\.[a-z0-9]+$/i.test(specifier);
    if (isRelative && !hasExtension) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { istSessionOpen, istNow, chartCacheTtlMs, istTradingDay, minutesUntilOpen, TRADING_HOLIDAYS } = await import(
  "../../web/src/lib/session.ts"
);

// IST is UTC+5:30 with no DST. Session Mon–Fri 09:15–15:30 IST
// === Mon–Fri 03:45–10:00 UTC.
const utc = (y, mo, da, h, mi) => new Date(Date.UTC(y, mo - 1, da, h, mi));

test("istNow maps a UTC instant onto the IST calendar", () => {
  // 2026-08-17T00:00:00Z is 05:30 IST Monday
  const p = istNow(utc(2026, 8, 17, 0, 0));
  assert.equal(p.h, 5);
  assert.equal(p.m, 30);
  assert.equal(istWeekdayName(p), "Mon");
});

function istWeekdayName(p) {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][
    new Date(p.y, p.mo - 1, p.da).getDay()
  ];
}

test("session open boundaries (Mon)", () => {
  assert.equal(istSessionOpen(utc(2026, 8, 17, 3, 44)), false, "09:14 closed");
  assert.equal(istSessionOpen(utc(2026, 8, 17, 3, 45)), true, "09:15 open");
  assert.equal(istSessionOpen(utc(2026, 8, 17, 6, 0)), true, "11:30 open");
  assert.equal(istSessionOpen(utc(2026, 8, 17, 9, 59)), true, "15:29 open");
  assert.equal(istSessionOpen(utc(2026, 8, 17, 10, 0)), false, "15:30 closed");
  assert.equal(istSessionOpen(utc(2026, 8, 17, 12, 0)), false, "17:30 closed");
});

test("weekends are always closed", () => {
  assert.equal(istSessionOpen(utc(2026, 8, 15, 6, 0)), false, "Sat 11:30 IST");
  assert.equal(istSessionOpen(utc(2026, 8, 16, 6, 0)), false, "Sun 11:30 IST");
});

test("chartCacheTtlMs widens off-session", () => {
  assert.equal(chartCacheTtlMs("5m", true), 60_000);
  assert.equal(chartCacheTtlMs("1d", true), 10 * 60_000);
  assert.equal(chartCacheTtlMs("5m", false), 10 * 60_000);
  assert.equal(chartCacheTtlMs("1d", false), 30 * 60_000);
  // hourly counts as intraday
  assert.equal(chartCacheTtlMs("1h", true), 60_000);
});

// TASK-462: trading-holiday awareness
test("trading holidays close the session on weekdays", () => {
  assert.ok(TRADING_HOLIDAYS.has("2026-10-02"), "Gandhi Jayanti in calendar");
  // Oct 2 2026 is a Friday: mid-session UTC time would normally be open
  assert.equal(istSessionOpen(utc(2026, 10, 2, 6, 0)), false, "holiday Friday closed");
  assert.equal(istTradingDay(istNow(utc(2026, 10, 2, 6, 0))), false);
});

test("non-holiday weekday still opens (guard against over-blocking)", () => {
  assert.equal(istSessionOpen(utc(2026, 10, 9, 6, 0)), true, "Fri Oct 9 open");
});

test("minutesUntilOpen skips a holiday to the next trading day", () => {
  // Fri Oct 2 2026 is a holiday; 07:00 IST = 01:30 UTC → after close
  const now = utc(2026, 10, 2, 1, 30);
  const mins = minutesUntilOpen(now);
  // next open: Mon Oct 5 09:15 IST. From Fri 07:00 IST that is
  // 3*1440 - 420 + 555 = 4500 min
  assert.equal(mins, 3 * 1440 - 420 + 555);
});
