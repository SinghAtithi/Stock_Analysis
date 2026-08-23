/**
 * TASK-1465 — client-key derivation + limiter-store eviction.
 *
 * Before this task, backtest/tracker/board keyed every per-IP limit on the
 * LEFTMOST x-forwarded-for hop — a header any caller sets for free. Rotating
 * it rotated every budget; flooding unique keys tripped the old clear-all
 * and reset honest users' counters. These tests pin:
 *   - direct exposure: rotating spoof headers changes NOTHING (one key)
 *   - TRUST_PROXY=1: the RIGHTMOST XFF hop wins (your proxy appended it)
 *   - eviction: expired entries go first, then oldest-touched — an active
 *     key survives a 6000-key flood.
 *
 * Run: npm test  (from web/)  ·  node --test scripts/tests/client-key.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { clientKeyFrom } from "../../web/src/lib/clientKey.ts";
import { evictOldest } from "../../web/src/lib/tiers.ts";
import { resetTierUsage, gateBacktestRun } from "../../web/src/lib/tiers.ts";

function h(headers) {
  return new Headers(headers);
}

const withEnv = (vars, fn) => {
  const saved = { ...process.env };
  try {
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fn();
  } finally {
    process.env = saved;
  }
};

test("direct exposure (default): rotating spoof headers cannot change the key", () => {
  withEnv({ TRUST_PROXY: undefined }, () => {
    const base = clientKeyFrom(h({}));
    assert.equal(base, "direct");
    for (const spoof of [
      h({ "x-forwarded-for": "1.2.3.4" }),
      h({ "x-forwarded-for": "5.6.7.8, 1.2.3.4" }),
      h({ "x-real-ip": "9.9.9.9" }),
      h({ "x-forwarded-for": `${"a".repeat(300)}` }),
    ]) {
      assert.equal(clientKeyFrom(spoof), "direct", "spoof must not mint new budgets");
    }
  });
});

test("TRUST_PROXY=1: RIGHTMOST xff hop wins (proxy-appended), leftmost is attacker noise", () => {
  withEnv({ TRUST_PROXY: "1" }, () => {
    assert.equal(
      clientKeyFrom(h({ "x-forwarded-for": "1.2.3.4, 10.0.0.9" })),
      "ip:10.0.0.9",
      "spoofed leftmost ignored"
    );
    assert.equal(
      clientKeyFrom(h({ "x-forwarded-for": " 1.2.3.4 , 10.0.0.9 , 192.168.1.1 " })),
      "ip:192.168.1.1"
    );
    assert.equal(clientKeyFrom(h({ "x-real-ip": "10.0.0.7" })), "ip:10.0.0.7", "xff absent → real-ip");
    assert.equal(clientKeyFrom(h({})), "ip:direct");
    // whitespace-only hops don't crash or become empty keys
    assert.equal(clientKeyFrom(h({ "x-forwarded-for": " , , " })), "ip:direct");
  });
});

test("evictOldest: expired entries swept anywhere, then oldest-trimmed to target; live kept", () => {
  const map = new Map();
  map.set("dead-early", [0]); // ancient stamp, front of queue
  map.set("live-user", [Date.now() - 1000]);
  for (let i = 0; i < 50; i += 1) map.set(`flood-${i}`, [Date.now()]);
  map.set("dead-late", [0]); // ancient stamp, back of queue

  // the client touches the API again — delete+set is what every limiter
  // call site does on access, moving the key to the LRU tail
  const liveStamp = map.get("live-user");
  map.delete("live-user");
  map.set("live-user", liveStamp);

  evictOldest(map, 30, 20, (stamps) => stamps.some((t) => Date.now() - t < 60_000));

  assert.ok(map.size <= 30, `bounded, got ${map.size}`);
  assert.ok(!map.has("dead-early") && !map.has("dead-late"), "expired entries swept regardless of position");
  assert.ok(map.has("live-user"), "recently-touched key survives a flood");
});

test("flood cannot reset an ACTIVE writer's tier window (LRU, not clear-all)", () => {
  withEnv({ TRUST_PROXY: undefined }, () => {
    resetTierUsage();
    gateBacktestRun("dev:active-writer");
    // flood past the cap; the writer keeps using the API between waves,
    // refreshing its recency the way any live client naturally does
    for (let i = 0; i < 5500; i += 1) {
      gateBacktestRun(`dev:flood-${i}`);
      if (i % 1000 === 0) gateBacktestRun("dev:active-writer");
    }
    // its spent runs still count: within free-tier cap of 3 it must trip
    let used = false;
    for (let i = 0; i < 3 && !used; i += 1) {
      if (!gateBacktestRun("dev:active-writer").ok) used = true;
    }
    assert.ok(used, "active key kept its spent budget through the flood");
    resetTierUsage();
  });
});
