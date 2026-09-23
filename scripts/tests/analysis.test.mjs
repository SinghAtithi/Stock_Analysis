import test from "node:test";
import assert from "node:assert/strict";

/* TASK-1550 — analysis.ts RSI/trend engine: pure chart math with no suite.
   Synthetic candles only; no I/O. */

const az = await import("../../web/src/lib/analysis.ts");

const candles = (closes) =>
  closes.map((c, i) => ({ time: 1_700_000_000 + i * 86400, open: c, high: c * 1.01, low: c * 0.99, close: c, volume: 1000 }));

const input = (closes, over = {}) => ({
  symbol: "RELIANCE",
  name: "Reliance Industries",
  currency: "INR",
  exchange: "NSE",
  regularMarketTime: 1_700_000_000,
  previousClose: null,
  fiftyTwoWeekHigh: null,
  fiftyTwoWeekLow: null,
  change: null,
  changePct: null,
  range: "1y",
  interval: "1d",
  candles: candles(closes),
  source: "yahoo",
  ...over,
});
const rising = (n, from = 100, step = 1) => Array.from({ length: n }, (_, i) => from + i * step);
const falling = (n, from = 300, step = 1) => Array.from({ length: n }, (_, i) => from - i * step);

test("rsi: sustained gains pin high, sustained losses pin low", () => {
  assert.equal(az.rsi(rising(30), 14), 100);
  assert.equal(az.rsi(falling(30), 14), 0);
});

test("rsi: flat history is null, short history is null", () => {
  assert.equal(az.rsi(Array(30).fill(100), 14), null);
  assert.equal(az.rsi(rising(14), 14), null);
  assert.equal(az.rsi(rising(5), 14), null);
});

test("rsi: mixed series stays inside (0, 100)", () => {
  const closes = rising(15).concat(falling(15, 114));
  const out = az.rsi(closes, 14);
  assert.ok(out > 0 && out < 100, `out of range: ${out}`);
});

test("analyzeChart: null on empty input", () => {
  assert.equal(az.analyzeChart(input([])), null);
});

test("analyzeChart: rising market reads uptrend with bullish alignment", () => {
  const out = az.analyzeChart(input(rising(250)));
  assert.equal(out.trend, "uptrend");
  assert.ok(out.signals.some((s) => s.includes("bullish ma alignment (20>50>200)")));
  assert.ok(out.signals.some((s) => s.includes("overbought") || s.includes("neutral")));
  assert.equal(out.window.bars, 250);
  assert.ok(out.window.high >= out.quote.price);
});

test("analyzeChart: falling market reads downtrend with bearish alignment", () => {
  const out = az.analyzeChart(input(falling(250)));
  assert.equal(out.trend, "downtrend");
  assert.ok(out.signals.some((s) => s.includes("bearish ma alignment (20<50<200)")));
  assert.ok(out.signals.some((s) => s.includes("oversold")));
});

test("analyzeChart: short history cannot classify trend", () => {
  const out = az.analyzeChart(input(rising(30)));
  assert.equal(out.trend, "unknown");
  assert.equal(out.indicators.sma200, null);
});

test("analyzeChart: meta carries range/interval/source plus stale flags", () => {
  const out = az.analyzeChart(input(rising(30), { stale: true, degraded: "daily" }));
  assert.equal(out.meta.range, "1y");
  assert.equal(out.meta.stale, true);
  assert.equal(out.meta.degraded, "daily");
  assert.equal(out.quote.exchange, "NSE");
});
