import test from "node:test";
import assert from "node:assert/strict";

/* TASK-1377 — strategy mixer: weight normalization math + device-scoped mix
   preset storage (sanitization, name-dedupe/cap on save, restore). */

/* minimal browser shims so lib modules can run under node:test */
class FakeCustomEvent {
  constructor(type) {
    this.type = type;
  }
}
if (typeof globalThis.CustomEvent === "undefined") {
  globalThis.CustomEvent = FakeCustomEvent;
}
const store = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
  dispatchEvent: () => true,
  addEventListener() {},
  removeEventListener() {},
};

const mixer = await import("../../web/src/lib/mixer.ts");

const w = (strategyId, weight) => ({ strategyId, weight });

test("sanitizeMixPresets drops junk rows and coerces fields", () => {
  const good = {
    id: "a1",
    name: "Aggressive desk",
    weights: [w("S100", 70), w("S101", 30)],
    createdAt: 42,
  };
  const out = mixer.sanitizeMixPresets([
    good,
    null,
    { id: "", name: "x", weights: [] },
    { id: "b2", name: "bad weights", weights: [{ strategyId: "S100", weight: "heavy" }] },
    { id: "c3", name: "partial", weights: [w("S100", 50), null] },
    "string",
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].name, "Aggressive desk");
  assert.equal(out[0].weights.length, 2);
  assert.equal(out[1].name, "partial");
  assert.equal(out[1].weights.length, 1, "null weights are dropped, preset survives");
});

test("sanitizeMixPresets caps names at 40 chars and weights at 10 strategies", () => {
  const many = Array.from({ length: 12 }, (_, i) => w(`S${i}`, 10));
  const [p] = mixer.sanitizeMixPresets([
    { id: "d4", name: "n".repeat(80), weights: many, createdAt: 1 },
  ]);
  assert.equal(p.name.length, 40);
  assert.equal(p.weights.length, mixer.MAX_MIX_STRATEGIES);
});

test("normalizeWeights: single weight becomes 100", () => {
  const out = mixer.normalizeWeights([w("S100", 100)]);
  assert.equal(out.size, 1);
  assert.equal(out.get("S100"), 100);
});

test("normalizeWeights: two weights scale to sum exactly 100", () => {
  const out = mixer.normalizeWeights([w("S100", 80), w("S101", 20)]);
  const sum = [...out.values()].reduce((a, b) => a + b, 0);
  assert.equal(sum, 100);
  assert.equal(out.get("S100"), 80);
  assert.equal(out.get("S101"), 20);
});

test("normalizeWeights: zero and sub-0.5 weights are removed", () => {
  const out = mixer.normalizeWeights([w("S100", 70), w("S101", 30), w("S104", 0), w("S099", 0.4)]);
  assert.equal(out.size, 2);
  assert.equal(out.get("S100"), 70);
  assert.equal(out.get("S101"), 30);
});

test("normalizeWeights: all-zero mix yields an empty map", () => {
  assert.equal(mixer.normalizeWeights([w("S100", 0), w("S101", 0)]).size, 0);
  assert.equal(mixer.normalizeWeights([]).size, 0);
});

test("normalizeWeights: rounding drift snaps onto the largest weight", () => {
  const out = mixer.normalizeWeights([
    w("S100", 33),
    w("S101", 33),
    w("S104", 34),
  ]);
  const sum = [...out.values()].reduce((a, b) => a + b, 0);
  assert.equal(sum, 100);
});

test("saveMixPreset dedupes by name, newest first, capped at 20", () => {
  store.clear();
  for (let i = 0; i < 25; i++) {
    mixer.saveMixPreset(`mix ${i}`, [w("S100", 100)]);
  }
  let list = mixer.getMixPresetsSnapshot();
  assert.equal(list.length, 20);
  assert.equal(list[0].name, "mix 24");
  assert.equal(list[0].weights[0].strategyId, "S100");
  // re-saving an existing name replaces it and moves it to the top
  mixer.saveMixPreset("mix 10", [w("S101", 60), w("S104", 40)]);
  list = mixer.getMixPresetsSnapshot();
  assert.equal(list.length, 20);
  assert.equal(list[0].name, "mix 10");
  assert.equal(list[0].weights.length, 2);
  assert.equal(list.filter((p) => p.name === "mix 10").length, 1);
});

test("saveMixPreset refuses empty names and empty weights", () => {
  store.clear();
  assert.equal(mixer.saveMixPreset("", [w("S100", 100)]), false);
  assert.equal(mixer.saveMixPreset("  ", [w("S100", 100)]), false);
  assert.equal(mixer.saveMixPreset("only zero", [w("S100", 0)]), false);
  assert.equal(mixer.saveMixPreset("kept", [w("S100", 100)]), true);
});

test("restoreMixPreset re-inserts a deleted preset at its old index", () => {
  store.clear();
  mixer.saveMixPreset("a", [w("S100", 100)]);
  mixer.saveMixPreset("b", [w("S101", 100)]);
  mixer.saveMixPreset("c", [w("S104", 100)]);
  const list = mixer.getMixPresetsSnapshot();
  const target = list.find((p) => p.name === "b");
  const index = list.indexOf(target);
  mixer.deleteMixPreset(target.id);
  assert.equal(mixer.getMixPresetsSnapshot().some((p) => p.id === target.id), false);
  assert.equal(mixer.restoreMixPreset(target, index), true);
  const restored = mixer.getMixPresetsSnapshot();
  assert.equal(restored[1].name, "b");
  assert.equal(restored.length, 3);
});