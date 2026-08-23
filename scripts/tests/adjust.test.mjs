/**
 * TASK-15 — strategies/backtests must consume split-adjusted candles.
 * Guards scripts/lib/adjust.mjs, the single read-boundary both runners use.
 *
 * Run: npm test  (from web/)  ·  node --test scripts/tests/adjust.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { toAdjustedCandles } from "../../scripts/lib/adjust.mjs";

const row = (over = {}) => ({
  ts: 1_750_000_000,
  o: 100,
  h: 110,
  l: 95,
  c: 105,
  v: 1_000,
  adj_factor: 1,
  ...over,
});

test("adjusted series is continuous across a 2:1 split (raw 100 → 50, factor 2)", () => {
  const out = toAdjustedCandles([row({ adj_factor: 1 }), row({ ts: 2, o: 50, h: 55, l: 48, c: 52, adj_factor: 2 })]);
  assert.equal(out[0].close, 105);
  assert.equal(out[1].close, 104);
  assert.ok(Math.abs(out[0].close - out[1].close) < 5, "no fake crash across ex-date");
});

test("OHLC all scale by factor; volume stays raw", () => {
  const [c] = toAdjustedCandles([row({ adj_factor: 3 })]);
  assert.equal(c.open, 300);
  assert.equal(c.high, 330);
  assert.equal(c.low, 285);
  assert.equal(c.close, 315);
  assert.equal(c.volume, 1_000, "share-count not adjusted");
  assert.equal(c.time, 1_750_000_000);
});

test("missing/invalid factors fall back to 1 (never zero out prices)", () => {
  for (const f of [undefined, null, 0, -2, Number.NaN]) {
    const [c] = toAdjustedCandles([row({ adj_factor: f })]);
    assert.equal(c.close, 105, `factor ${f} treated as 1`);
  }
});
