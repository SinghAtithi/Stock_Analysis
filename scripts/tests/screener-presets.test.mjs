import test from "node:test";
import assert from "node:assert/strict";

/* TASK-62 — saved screener views + watchlist cloud-mirror merge rules.
   Pure-logic coverage: preset sanitization, name-dedupe/cap on save, and
   the union merge where localStorage wins conflicts (exchange|symbol key). */

const { sanitizePresets } = await import("../../web/src/lib/screenerPresets.ts");

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

const watchlist = await import("../../web/src/lib/watchlist.ts");
const presets = await import("../../web/src/lib/screenerPresets.ts");

const entry = (symbol, exchange = "NSE") => ({
  symbol,
  exchange,
  name: symbol,
  shortName: symbol,
  type: "Equity",
  sector: "",
});

test("sanitizePresets drops junk rows and coerces fields", () => {
  const good = {
    id: "a1",
    name: "Momentum desk",
    strategy: "demo-roc20",
    sortKey: "score",
    sortDir: "desc",
    createdAt: 42,
  };
  const out = sanitizePresets([
    good,
    null,
    { id: "", name: "x", strategy: "s", sortKey: null, sortDir: "asc" },
    { id: "b2", name: "bad dir", strategy: "s", sortKey: null, sortDir: "sideways" },
    "string",
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, "Momentum desk");
});

test("sanitizePresets caps names at 40 chars", () => {
  const [p] = sanitizePresets([
    { id: "c3", name: "n".repeat(80), strategy: "s", sortKey: null, sortDir: "asc", createdAt: 1 },
  ]);
  assert.equal(p.name.length, 40);
});

test("saveScreenerPreset dedupes by name, newest first, capped at 20", () => {
  store.clear();
  for (let i = 0; i < 25; i++) {
    presets.saveScreenerPreset(`view ${i}`, {
      strategy: `strategy-${i}`,
      sortKey: null,
      sortDir: "asc",
    });
  }
  let list = presets.getScreenerPresetsSnapshot();
  assert.equal(list.length, 20);
  assert.equal(list[0].name, "view 24");
  // re-saving an existing name replaces it and moves it to the top
  presets.saveScreenerPreset("view 10", {
    strategy: "demo-roc20",
    sortKey: "score",
    sortDir: "desc",
  });
  list = presets.getScreenerPresetsSnapshot();
  assert.equal(list.length, 20);
  assert.equal(list[0].name, "view 10");
  assert.equal(list[0].strategy, "demo-roc20");
  assert.equal(list.filter((p) => p.name === "view 10").length, 1);
});

test("mergeIntoWatchlist unions by exchange|symbol, local wins conflicts", () => {
  store.clear();
  store.set(
    watchlist.WATCHLIST_KEY,
    JSON.stringify([entry("RELIANCE"), entry("TCS"), entry("SENSEX", "BSE")])
  );
  // mirror carries a stale RELIANCE variant (local must win), plus fresh rows
  const incoming = [
    { ...entry("RELIANCE"), name: "Mirror-renamed Reliance", sector: "Energy" },
    entry("INFY"),
    entry("SENSEX", "BSE"),
  ];
  const added = watchlist.mergeIntoWatchlist(incoming);
  assert.equal(added, 1);

  const merged = watchlist.loadWatchlist();
  assert.equal(merged.length, 4);
  const rel = merged.find((e) => e.symbol === "RELIANCE");
  assert.equal(rel.name, "RELIANCE", "local entry kept verbatim");
  assert.ok(merged.some((e) => e.symbol === "INFY"));
  assert.equal(merged.filter((e) => e.symbol === "SENSEX").length, 1);

  // re-merging the same payload is a no-op
  assert.equal(watchlist.mergeIntoWatchlist(incoming), 0);
});

test("mergeIntoWatchlist ignores malformed payloads", () => {
  store.clear();
  assert.equal(watchlist.mergeIntoWatchlist([]), 0);
  assert.equal(watchlist.mergeIntoWatchlist([null, { symbol: "" }, "x"]), 0);
});
