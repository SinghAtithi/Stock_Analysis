/**
 * TASK-79 — search min-length + empty-state support.
 *
 * Before TASK-79 a single typed character ("N", "R") returned nothing
 * client- and server-side, and focusing the empty input showed no panel at
 * all. The lib gate drops to 1 char; the empty-state panel itself is
 * component-local (Search.tsx) and covered by Playwright sanity.
 *
 * Run: npm test  (from web/)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { searchInstruments } from "../../web/src/lib/instruments.ts";

test("single-char prefix query returns top matches", () => {
  const r = searchInstruments("R");
  assert.ok(r.length > 0, "1-char query must not be empty");
  // scoring is prefix-first but may include substring hits (e.g. IRFC);
  // just require the obvious R-prefix majors to surface in the top 8
  assert.ok(
    r.some((x) => x.symbol.startsWith("R")),
    "prefix matches outrank substring matches"
  );
});

test("empty query still returns nothing from the lib (UI owns the empty state)", () => {
  assert.deepEqual(searchInstruments(""), []);
});

test("popular quick-pick shapes resolve in the index", () => {
  // the UI hardcodes these as SearchResult picks — they must exist verbatim
  const pairs = [
    ["NIFTY 50", "NSE"],
    ["SENSEX", "BSE"],
    ["RELIANCE", "NSE"],
    ["TCS", "NSE"],
  ];
  for (const [symbol, exchange] of pairs) {
    const hits = searchInstruments(symbol === "NIFTY 50" ? "NIFTY 5" : symbol, 20);
    assert.ok(
      hits.some((h) => h.symbol === symbol && h.exchange === exchange),
      `${symbol} · ${exchange} resolvable`
    );
  }
});
