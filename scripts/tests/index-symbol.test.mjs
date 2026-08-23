/* index-symbol.test.mjs — TASK-997: index detection must not rely on symbol
 * tokens alone; 63 BSE indices (AUTO, 200EQW, TECK…) were typed Equity, so
 * getChart skipped the caret-Yahoo path and charts 404'd upstream.
 * Run: npm test  (from web/)
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { isIndexSymbol } from "../../web/src/lib/instruments.ts";
import instruments from "../../web/src/data/instruments.json" with { type: "json" };

test("legacy symbol tokens still detect indices", () => {
  for (const s of ["NIFTY 50", "SENSEX", "BANKNIFTY", "FINNIFTY", "INDIA VIX", "NIFTY MIDCAP 100"]) {
    assert.equal(isIndexSymbol(s), true, `${s} should be an index`);
  }
});

test("opaque BSE index symbols are detected via their listing name", () => {
  const cases = [
    ["AUTO", "BSE AUTO"],
    ["200EQW", "BSE 200 EQUAL WEIGHT"],
    ["BANKEX", "BSE BANKEX"],
    ["TECK", "BSE TECK"],
    ["BHRT22", "BSE BHARAT 22 INDEX"],
    ["BS1000", "BSE 1000"],
    ["POWER", "BSE POWER"],
    ["ESG100", "BSE 100 ESG INDEX"],
  ];
  for (const [s, n] of cases) {
    assert.equal(isIndexSymbol(s, n), true, `${s} (${n}) should be an index`);
    assert.equal(isIndexSymbol(s), false, `${s} alone was never token-matched`);
  }
});

test("BSE LIMITED (the exchange's own stock) stays Equity", () => {
  assert.equal(isIndexSymbol("BSE", "BSE LIMITED"), false);
});

test("ETFs with index-flavoured names stay Equity (prefix-only name rule)", () => {
  assert.equal(isIndexSymbol("BANKADD", "DSP Nifty Bank ETF"), false);
  assert.equal(isIndexSymbol("NIF100BEES", "NIP IND ETF NIFTY 100"), false);
  assert.equal(isIndexSymbol("EQUAL50ADD", "DSP Nifty 50 Equal Weight ETF"), false);
});

test("matching is case-insensitive", () => {
  assert.equal(isIndexSymbol("nifty bank"), true);
  assert.equal(isIndexSymbol("auto", "bse auto"), true);
});

test("dataset invariant: every BSE-named listing is an index except BSE LIMITED", () => {
  let bseIndices = 0;
  for (const inst of instruments) {
    if (!inst.n.toUpperCase().startsWith("BSE ")) continue;
    const expected = inst.n.toUpperCase() !== "BSE LIMITED";
    assert.equal(
      isIndexSymbol(inst.s, inst.n),
      expected,
      `${inst.s} (${inst.n}) misclassified`
    );
    if (expected) bseIndices++;
  }
  assert.ok(bseIndices >= 120, `expected ~125 BSE index rows, got ${bseIndices}`);
});
