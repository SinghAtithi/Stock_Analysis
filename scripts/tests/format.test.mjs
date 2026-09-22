import test from "node:test";
import assert from "node:assert/strict";

/* TASK-1545 — format.ts compact/time helpers: pure, rendered on every price
   and volume in the product, zero coverage before this file. */

const fmt = await import("../../web/src/lib/format.ts");

test("inrCompact: Cr/L thresholds with rupee mark", () => {
  assert.equal(fmt.inrCompact(15_000_000), "₹1.5 Cr");
  assert.equal(fmt.inrCompact(250_000), "₹2.5 L");
  assert.equal(fmt.inrCompact(999), "₹999.00");
  assert.equal(fmt.inrCompact(-2_500_000), "₹-25 L");
});

test("inrCompact: nullish/NaN render as em-dash, never throw", () => {
  assert.equal(fmt.inrCompact(null), "—");
  assert.equal(fmt.inrCompact(undefined), "—");
  assert.equal(fmt.inrCompact(Number.NaN), "—");
  assert.equal(fmt.inrCompact(0), "₹0.00");
});

test("volumeCompact: Cr/L/K ladder without currency mark", () => {
  assert.equal(fmt.volumeCompact(15_000_000), "1.5 Cr");
  assert.equal(fmt.volumeCompact(250_000), "2.5 L");
  assert.equal(fmt.volumeCompact(1_500), "1.5 K");
  assert.equal(fmt.volumeCompact(500), "500");
  assert.equal(fmt.volumeCompact(null), "—");
  assert.equal(fmt.volumeCompact(Number.NaN), "—");
});

test("timeAgo: just-now/minutes/hours ladder", () => {
  const now = Math.floor(Date.now() / 1000);
  assert.equal(fmt.timeAgo(now - 30), "just now");
  assert.equal(fmt.timeAgo(now - 60), "1m ago");
  assert.equal(fmt.timeAgo(now - 300), "5m ago");
  assert.equal(fmt.timeAgo(now - 3599), "59m ago");
  assert.equal(fmt.timeAgo(now - 3600), "1h ago");
  assert.equal(fmt.timeAgo(now - 7200), "2h ago");
});

test("timeAgo: older than a day renders a calendar date", () => {
  const out = fmt.timeAgo(1_577_836_800); // 2020-01-01T00:00:00Z
  assert.ok(!out.includes("ago"));
  assert.match(out, /2020/);
});

test("timeAgo: falsy input renders em-dash", () => {
  assert.equal(fmt.timeAgo(null), "—");
  assert.equal(fmt.timeAgo(undefined), "—");
  assert.equal(fmt.timeAgo(0), "—");
});
