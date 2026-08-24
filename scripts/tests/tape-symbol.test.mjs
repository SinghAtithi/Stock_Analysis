import { registerHooks } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";

registerHooks({
  resolve(specifier, context, nextResolve) {
    const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
    const hasExtension = /\.[a-z0-9]+$/i.test(specifier);
    if (isRelative && !hasExtension) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { tapeSymbolFor } = await import("../../web/src/lib/marketData.ts");

// TASK-683: tape rows must carry resolvable instrument symbols so a tap
// deep-links to the right chart instead of falling back to NIFTY 50.
test("tapeSymbolFor: indices keep their display symbol", () => {
  assert.equal(tapeSymbolFor("^NSEI"), "NIFTY 50");
  assert.equal(tapeSymbolFor("^BSESN"), "SENSEX");
});

test("tapeSymbolFor: equities drop the Yahoo suffix", () => {
  assert.equal(tapeSymbolFor("SBIN.NS"), "SBIN");
  assert.equal(tapeSymbolFor("M&M.NS"), "M&M");
  assert.equal(tapeSymbolFor("LT.NS"), "LT");
  assert.equal(tapeSymbolFor("BAJFINANCE.NS"), "BAJFINANCE");
});

test("tapeSymbolFor: unknown symbols strip the suffix as a fallback", () => {
  assert.equal(tapeSymbolFor("XYZ.BO"), "XYZ");
  assert.equal(tapeSymbolFor("NEWLIST.NS"), "NEWLIST");
});
