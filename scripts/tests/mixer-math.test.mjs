import test from "node:test";
import assert from "node:assert/strict";

/* TASK-1538 — mixerMath normalizeWeights: the composite's weight math had no
   dedicated suite (mixer.test.mjs covers mixer.ts presets, not this module).
   Pure module, no browser shims needed (no window access by design). */

const math = await import("../../web/src/lib/mixerMath.ts");

const w = (strategyId, weight) => ({ strategyId, weight });
const sum = (m) => [...m.values()].reduce((a, b) => a + b, 0);

test("even split normalizes to 50/50 summing exactly 100", () => {
  const out = math.normalizeWeights([w("a", 50), w("b", 50)]);
  assert.equal(out.get("a"), 50);
  assert.equal(out.get("b"), 50);
  assert.equal(sum(out), 100);
});

test("unequal weights keep proportions at one decimal", () => {
  const out = math.normalizeWeights([w("a", 70), w("b", 30)]);
  assert.equal(out.get("a"), 70);
  assert.equal(out.get("b"), 30);
  assert.equal(sum(out), 100);
});

test("rounding drift is snapped onto the largest weight", () => {
  const out = math.normalizeWeights([w("a", 10), w("b", 10), w("c", 10)]);
  assert.equal(sum(out), 100);
  // 33.3 x 3 = 99.9, so ~+0.1 lands on the first max (ties keep first).
  // Float arithmetic leaves 33.400000000000006 — compare with tolerance.
  assert.ok(Math.abs(out.get("a") - 33.4) < 1e-9);
  assert.equal(out.get("b"), 33.3);
  assert.equal(out.get("c"), 33.3);
});

test("weights below 0.5 are filtered out", () => {
  const out = math.normalizeWeights([w("a", 0.4), w("b", 50)]);
  assert.ok(!out.has("a"));
  assert.equal(out.get("b"), 100);
});

test("invalid entries are skipped, survivors still sum to 100", () => {
  const out = math.normalizeWeights([
    null,
    {},
    w("", 50),
    w("nan", Number.NaN),
    w("inf", Number.POSITIVE_INFINITY),
    w("neg", -5),
    w("str", "50"),
    w("a", 60),
    w("b", 40),
  ]);
  assert.deepEqual([...out.keys()].sort(), ["a", "b"]);
  assert.equal(sum(out), 100);
});

test("empty and all-zero mixes return an empty map", () => {
  assert.equal(math.normalizeWeights([]).size, 0);
  assert.equal(math.normalizeWeights([w("a", 0), w("b", 0.49)]).size, 0);
});

test("single survivor takes the full 100", () => {
  const out = math.normalizeWeights([w("only", 25)]);
  assert.equal(out.get("only"), 100);
});

test("weights are capped at 100 before normalizing", () => {
  const out = math.normalizeWeights([w("a", 150), w("b", 50)]);
  assert.equal(sum(out), 100);
  assert.ok(out.get("a") > out.get("b"));
});

test("MAX_MIX_STRATEGIES export is the documented picker cap", () => {
  assert.equal(math.MAX_MIX_STRATEGIES, 10);
});
