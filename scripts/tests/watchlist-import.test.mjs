/**
 * TASK-726 — watchlist import is a confirmed REPLACE, not a silent merge.
 *
 * export → trim dead symbols → re-import must restore the trimmed list;
 * the old union-merge silently resurrected removed entries. "merge" mode
 * stays available as an explicit opt-in.
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

const { parseImport, applyImport, importWatchlist } = await import(
  "../../web/src/lib/watchlist.ts"
);

const entry = (symbol, exchange = "NSE") => ({
  symbol, exchange, name: symbol, shortName: symbol, type: "Equity", sector: "",
});

test("parseImport validates and dedupes without touching storage", () => {
  store.clear();
  const rows = [entry("A"), entry("A"), entry("B", "BSE"), { junk: true }];
  const parsed = parseImport(JSON.stringify(rows));
  assert.equal(parsed.length, 2, "junk dropped, dupes collapsed");
  assert.equal(store.size, 0, "parse alone writes nothing");
  assert.equal(parseImport("not json"), null);
  assert.equal(parseImport("{}"), null);
  assert.equal(parseImport("[]"), null);
});

test("applyImport replace overwrites; merge unions", () => {
  store.clear();
  applyImport([entry("A"), entry("B")], "replace");
  const n = applyImport([entry("B"), entry("C")], "replace");
  let list = JSON.parse(store.get("niftyterm.watchlist"));
  assert.deepEqual(list.map((x) => x.symbol), ["B", "C"], "replace honors removals");
  assert.equal(n, 2);
  applyImport([entry("D")], "merge");
  list = JSON.parse(store.get("niftyterm.watchlist"));
  assert.deepEqual(list.map((x) => x.symbol), ["B", "C", "D"]);
});

test("compat wrapper importWatchlist defaults to replace", () => {
  store.clear();
  applyImport([entry("OLD")], "replace");
  assert.equal(importWatchlist(JSON.stringify([entry("NEW")])), 1);
  const list = JSON.parse(store.get("niftyterm.watchlist"));
  assert.deepEqual(list.map((x) => x.symbol), ["NEW"]);
});
