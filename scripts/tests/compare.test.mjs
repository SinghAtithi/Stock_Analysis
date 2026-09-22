import test from "node:test";
import assert from "node:assert/strict";

/* TASK-1546 — compare.ts pure helpers: toSlot/chartUrl/metric direction are
   the logic behind /compare and had no suite. resolveSlot is excluded — it
   performs a live fetch and belongs in a Playwright probe, not node:test. */

const cmp = await import("../../web/src/lib/compare.ts");

const slot = (over = {}) => ({
  symbol: "RELIANCE",
  name: "Reliance Industries",
  shortName: "RELIANCE",
  exchange: "NSE",
  type: "Equity",
  sector: "Energy",
  ...over,
});

test("toSlot: shortName falls back to symbol, sector defaults empty", () => {
  const out = cmp.toSlot({
    symbol: "TCS",
    name: "Tata Consultancy Services",
    shortName: "",
    exchange: "NSE",
    type: "Equity",
    sector: null,
  });
  assert.equal(out.shortName, "TCS");
  assert.equal(out.sector, "");
  assert.equal(out.symbol, "TCS");
});

test("chartUrl: encodes params and pins the range interval", () => {
  const url = cmp.chartUrl(slot(), "1y");
  assert.ok(url.startsWith("/api/chart?"));
  assert.ok(url.includes("symbol=RELIANCE"));
  assert.ok(url.includes("range=1y&interval=1d"));
  const tricky = cmp.chartUrl(slot({ symbol: "M&M", exchange: "NSE" }), "5d");
  assert.ok(tricky.includes(`symbol=${encodeURIComponent("M&M")}`));
});

test("chartUrl: unknown range falls back to RANGES[5] (1y/1d)", () => {
  const url = cmp.chartUrl(slot(), "bogus-range");
  assert.ok(url.includes("range=1y&interval=1d"));
});

test("metricValue: passes finite numbers, rejects the rest", () => {
  const m = {
    trailingPe: 22.5,
    forwardPe: Number.NaN,
    dividendYield: Number.POSITIVE_INFINITY,
    marketCap: null,
  };
  assert.equal(cmp.metricValue(m, "trailingPe"), 22.5);
  assert.equal(cmp.metricValue(m, "forwardPe"), null);
  assert.equal(cmp.metricValue(m, "dividendYield"), null);
  assert.equal(cmp.metricValue(m, "marketCap"), null);
  assert.equal(cmp.metricValue(null, "trailingPe"), null);
});

test("betterSide: lower wins for valuation, higher for returns", () => {
  assert.equal(cmp.betterSide(20, 30, "lower"), "a");
  assert.equal(cmp.betterSide(20, 30, "higher"), "b");
  assert.equal(cmp.betterSide(0.15, 0.1, "higher"), "a");
});

test("betterSide: ties, missing sides, and neutral never highlight", () => {
  assert.equal(cmp.betterSide(20, 20, "lower"), null);
  assert.equal(cmp.betterSide(null, 20, "lower"), null);
  assert.equal(cmp.betterSide(20, null, "higher"), null);
  assert.equal(cmp.betterSide(1, 2, "neutral"), null);
  assert.equal(cmp.betterSide(2, 1, "neutral"), null);
});

test("FUND_METRICS: keys resolve, market cap stays neutral", () => {
  const keys = new Set(cmp.FUND_METRICS.map((d) => d.key));
  assert.ok(keys.has("trailingPe") && keys.has("marketCap"));
  const cap = cmp.FUND_METRICS.find((d) => d.key === "marketCap");
  assert.equal(cap.direction, "neutral");
  assert.equal(cmp.FUND_METRICS.length, new Set(cmp.FUND_METRICS.map((d) => d.key)).size);
  const pe = cmp.FUND_METRICS.find((d) => d.key === "trailingPe");
  assert.equal(pe.fmt(22.456), "22.46");
  const roe = cmp.FUND_METRICS.find((d) => d.key === "returnOnEquity");
  assert.equal(roe.fmt(0.152), "15.2%");
});

test("fmtFinite: finite formats, the rest render em-dash", () => {
  assert.equal(cmp.fmtFinite(3.14159), "3.14");
  assert.equal(cmp.fmtFinite(3.14159, 0), "3");
  assert.equal(cmp.fmtFinite(null), "—");
  assert.equal(cmp.fmtFinite(Number.NaN), "—");
  assert.equal(cmp.fmtFinite(Number.POSITIVE_INFINITY), "—");
});
