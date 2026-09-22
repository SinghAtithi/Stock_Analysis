import test from "node:test";
import assert from "node:assert/strict";

/* TASK-1540 — watchlist undo/lookup ops: parse/apply/import/merge are covered
   by watchlist-import.test.mjs + screener-presets.test.mjs, but the TASK-83
   undo primitive (insertWatchlistAt), isInWatchlist, exportWatchlist, and the
   snapshot getters had no suite. */

/* minimal browser shims so the lib module runs under node:test */
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

const wl = await import("../../web/src/lib/watchlist.ts");

const entry = (symbol, exchange = "NSE") => ({
  symbol,
  name: `${symbol} Ltd`,
  shortName: symbol,
  exchange,
  type: "Equity",
  sector: "",
});

const reset = () => {
  store.delete(wl.WATCHLIST_KEY);
};

test("insertWatchlistAt restores an entry at its original position", () => {
  reset();
  wl.applyImport([entry("A"), entry("B"), entry("C")], "replace");
  wl.removeFromWatchlist("B", "NSE");
  assert.deepEqual(wl.loadWatchlist().map((e) => e.symbol), ["A", "C"]);
  wl.insertWatchlistAt(entry("B"), 1);
  assert.deepEqual(wl.loadWatchlist().map((e) => e.symbol), ["A", "B", "C"]);
});

test("insertWatchlistAt re-add never duplicates", () => {
  reset();
  wl.applyImport([entry("A"), entry("B")], "replace");
  wl.insertWatchlistAt(entry("A"), 1);
  const symbols = wl.loadWatchlist().map((e) => e.symbol);
  assert.deepEqual(symbols, ["B", "A"]);
});

test("insertWatchlistAt clamps out-of-range indices", () => {
  reset();
  wl.applyImport([entry("A"), entry("B")], "replace");
  wl.insertWatchlistAt(entry("Z"), -5);
  assert.equal(wl.loadWatchlist()[0].symbol, "Z");
  wl.insertWatchlistAt(entry("Y"), 999);
  const symbols = wl.loadWatchlist().map((e) => e.symbol);
  assert.equal(symbols[symbols.length - 1], "Y");
});

test("isInWatchlist matches on symbol+exchange", () => {
  reset();
  wl.applyImport([entry("A", "NSE")], "replace");
  assert.equal(wl.isInWatchlist({ symbol: "A", exchange: "NSE" }), true);
  assert.equal(wl.isInWatchlist({ symbol: "A", exchange: "BSE" }), false);
  assert.equal(wl.isInWatchlist({ symbol: "ZZZ", exchange: "NSE" }), false);
});

test("exportWatchlist round-trips the stored list", () => {
  reset();
  wl.applyImport([entry("A"), entry("B")], "replace");
  assert.deepEqual(JSON.parse(wl.exportWatchlist()), wl.loadWatchlist());
});

test("server snapshot is the default list (no storage on server)", () => {
  assert.deepEqual(wl.getServerWatchlistSnapshot(), wl.DEFAULT_WATCHLIST);
});

test("getWatchlistSnapshot keeps reference while storage is unchanged", () => {
  reset();
  const first = wl.getWatchlistSnapshot();
  assert.equal(wl.getWatchlistSnapshot(), first);
  wl.addToWatchlist(entry("NEW"));
  const after = wl.getWatchlistSnapshot();
  assert.notEqual(after, first);
  assert.ok(after.some((e) => e.symbol === "NEW"));
});
