/**
 * TASK-866 — deep-link symbol normalization.
 *
 * ?s=reliance (lowercased by chat apps/URL auto-lowercasing) used to miss
 * the exact-match index and silently land on the NIFTY 50 fallback.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { findInstrument, stripExchangeSuffix } from "../../web/src/lib/instruments.ts";

test("findInstrument resolves lowercase input", () => {
  assert.equal(findInstrument("reliance")?.s, "RELIANCE");
  assert.equal(findInstrument("  sBin  ")?.s, "SBIN");
});

test("already-uppercase links behave identically", () => {
  assert.deepEqual(findInstrument("RELIANCE"), findInstrument("reliance"));
});

test("empty/garbage still misses", () => {
  assert.equal(findInstrument(""), undefined);
  assert.equal(findInstrument("   "), undefined);
  assert.equal(findInstrument("NOSUCHSYMBOL1"), undefined);
});

test("TASK-358: exchange suffixes strip and imply exchange", () => {
  assert.deepEqual(stripExchangeSuffix("RELIANCE.NS"), { symbol: "RELIANCE", impliedExchange: "NSE" });
  assert.deepEqual(stripExchangeSuffix("TCS.BO"), { symbol: "TCS", impliedExchange: "BSE" });
  assert.deepEqual(stripExchangeSuffix("SENSEX.BSE"), { symbol: "SENSEX", impliedExchange: "BSE" });
  assert.deepEqual(stripExchangeSuffix("RELIANCE"), { symbol: "RELIANCE" });
  assert.equal(findInstrument(stripExchangeSuffix("reliance.ns").symbol)?.s, "RELIANCE");
});
