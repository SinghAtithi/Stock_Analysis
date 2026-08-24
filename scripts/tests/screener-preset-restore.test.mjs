/**
 * TASK-386 — saved-view delete undo.
 *
 * Deleting a preset used to be instant + unrecoverable. restoreScreenerPreset
 * re-inserts the exact deleted object at (a clamp of) its old index so a
 * mis-tap loses nothing; double-undo stays idempotent.
 *
 * Run: npm test  (from web/)
 */
import test from "node:test";
import assert from "node:assert/strict";

class FakeCustomEvent { constructor(t) { this.type = t; } }
if (typeof globalThis.CustomEvent === "undefined") globalThis.CustomEvent = FakeCustomEvent;
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

const lib = await import("../../web/src/lib/screenerPresets.ts");
const { saveScreenerPreset, deleteScreenerPreset, restoreScreenerPreset } = lib;

let seq = 0;
const SNAP = { strategy: "S100", sortKey: null, sortDir: "desc" };
const mk = (name) => {
  const id = `id${++seq}`;
  return {
    id,
    name,
    strategy: SNAP.strategy,
    sortKey: null,
    sortDir: "desc",
    createdAt: Date.now() + seq,
  };
};
const seed = (name) => { saveScreenerPreset(name, SNAP); return lib.getScreenerPresetsSnapshot().find((x) => x.name === name); };
const names = () => lib.getScreenerPresetsSnapshot().map((x) => x.name);

test("delete then restore puts the preset back at its old index", () => {
  store.clear();
  let a, b2, c;
  a = seed("ROC"); b2 = seed("MOM"); c = seed("VAL");
  // stored newest-first: [VAL, MOM, ROC]
  deleteScreenerPreset(b2.id);
  assert.deepEqual(names(), ["VAL", "ROC"]);
  assert.equal(restoreScreenerPreset(b2, 1), true);
  assert.deepEqual(names(), ["VAL", "MOM", "ROC"], "re-inserted at its old slot");
});

test("restore at out-of-range index clamps to the end", () => {
  store.clear();
  seed("ONE");
  const gone = mk("GONE");
  assert.equal(restoreScreenerPreset(gone, 99), true);
  assert.deepEqual(names(), ["ONE", "GONE"], "clamped index appends at end");
});

test("double-undo is idempotent (no duplicate ids)", () => {
  store.clear();
  store.clear();
  const p = seed("SOLO");
  deleteScreenerPreset(p.id);
  restoreScreenerPreset(p, 0);
  restoreScreenerPreset(p, 0);
  const snap = lib.getScreenerPresetsSnapshot().map((x) => x.id);
  assert.equal(new Set(snap).size, snap.length, "no duplicate ids");
  assert.equal(snap.length, 1);
});
