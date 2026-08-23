/**
 * TASK-866 — deep-link symbol normalization.
 *
 * ?s=reliance (lowercased by chat apps/URL auto-lowercasing) used to miss
 * the exact-match index and silently land on the NIFTY 50 fallback.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { findInstrument } from "../../web/src/lib/instruments.ts";

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
