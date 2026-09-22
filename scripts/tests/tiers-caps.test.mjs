import test from "node:test";
import assert from "node:assert/strict";

/* TASK-1543 — tiers.ts enforcement: eviction/flood paths are covered by
   client-key.test.mjs, but the adversarial core (device keying fallback,
   cap verdicts, pro-env parsing, backtest window) had no suite. These caps
   are the only thing standing between anonymous callers and compute APIs. */

const tiers = await import("../../web/src/lib/tiers.ts");

test("deviceKeyFor: malformed ids fall back to ip-keying, never bypass", () => {
  assert.equal(tiers.deviceKeyFor("valid-dev-01", "1.2.3.4"), "dev:valid-dev-01");
  // too short, too long, hostile chars, empty, nullish → ip fallback
  assert.equal(tiers.deviceKeyFor("short", "1.2.3.4"), "ip:1.2.3.4");
  assert.equal(tiers.deviceKeyFor("x".repeat(65), "1.2.3.4"), "ip:1.2.3.4");
  assert.equal(tiers.deviceKeyFor("../../etc", "1.2.3.4"), "ip:1.2.3.4");
  assert.equal(tiers.deviceKeyFor("semi;colon", "1.2.3.4"), "ip:1.2.3.4");
  assert.equal(tiers.deviceKeyFor("", "1.2.3.4"), "ip:1.2.3.4");
  assert.equal(tiers.deviceKeyFor(null, "1.2.3.4"), "ip:1.2.3.4");
  assert.equal(tiers.deviceKeyFor(undefined, "1.2.3.4"), "ip:1.2.3.4");
});

test("checkCap: boundaries and status mapping per cap kind", () => {
  assert.equal(tiers.checkCap("free", "backtestRunsPerDay", 2).ok, true);
  const denied = tiers.checkCap("free", "backtestRunsPerDay", 3);
  assert.equal(denied.ok, false);
  assert.equal(denied.status, 429);
  assert.equal(denied.reason, "daily_cap_reached");
  assert.equal(denied.limit, 3);
  const alerts = tiers.checkCap("free", "activeAlertsMax", 5);
  assert.equal(alerts.ok, false);
  assert.equal(alerts.status, 402);
  assert.equal(alerts.reason, "alert_cap_reached");
  const mixes = tiers.checkCap("free", "savedMixesMax", 2);
  assert.equal(mixes.ok, false);
  assert.equal(mixes.status, 402);
  assert.equal(mixes.reason, "mix_cap_reached");
  assert.equal(tiers.checkCap("pro", "backtestRunsPerDay", 99).ok, true);
});

test("tierForDevice: env parsing is trimmed, unknown defaults to free", () => {
  const prev = process.env.ALLOW_PRO_DEVICES;
  try {
    delete process.env.ALLOW_PRO_DEVICES;
    assert.equal(tiers.tierForDevice("any-device"), "free");
    assert.equal(tiers.tierForDevice(null), "free");
    process.env.ALLOW_PRO_DEVICES = "  pro-device-1 ,other ";
    assert.equal(tiers.tierForDevice("pro-device-1"), "pro");
    assert.equal(tiers.tierForDevice(" pro-device-1 "), "free"); // no trim on lookup
    assert.equal(tiers.tierForDevice("intruder"), "free");
  } finally {
    if (prev === undefined) delete process.env.ALLOW_PRO_DEVICES;
    else process.env.ALLOW_PRO_DEVICES = prev;
  }
});

test("gateBacktestRun: 3 free runs pass, 4th denied with retryAfter", () => {
  tiers.resetTierUsage();
  const now = Date.now();
  const key = "dev:cap-window-test";
  assert.equal(tiers.gateBacktestRun(key, now).ok, true);
  assert.equal(tiers.gateBacktestRun(key, now).ok, true);
  assert.equal(tiers.gateBacktestRun(key, now).ok, true);
  const fourth = tiers.gateBacktestRun(key, now);
  assert.equal(fourth.ok, false);
  assert.equal(fourth.status, 429);
  assert.ok(fourth.retryAfterSec >= 1);
  tiers.resetTierUsage();
});

test("gateBacktestRun: trailing-24h window expires old slots", () => {
  tiers.resetTierUsage();
  const now = Date.now();
  const key = "dev:window-expiry-test";
  tiers.gateBacktestRun(key, now);
  tiers.gateBacktestRun(key, now);
  tiers.gateBacktestRun(key, now);
  assert.equal(tiers.gateBacktestRun(key, now).ok, false);
  // 24h + 1s later the window is empty again.
  assert.equal(tiers.gateBacktestRun(key, now + 86_400_000 + 1000).ok, true);
  tiers.resetTierUsage();
});

test("gateBacktestRun: ip-keyed callers are capped as free tier", () => {
  tiers.resetTierUsage();
  const now = Date.now();
  const key = "ip:9.9.9.9";
  for (let i = 0; i < 3; i++) assert.equal(tiers.gateBacktestRun(key, now).ok, true);
  assert.equal(tiers.gateBacktestRun(key, now).ok, false);
  tiers.resetTierUsage();
});
