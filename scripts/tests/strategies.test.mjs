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

const indicators = await import("../../web/src/lib/strategies/indicators.ts");
const { register, getStrategy, listStrategies } = await import(
  "../../web/src/lib/strategies/registry.ts"
);
const { roc20Strategy } = await import("../../web/src/lib/strategies/demo/roc20.ts");
const { w52LowStrategy } = await import("../../web/src/lib/strategies/demo/52wlow.ts");

// --- fixture helpers ---------------------------------------------------------

function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic synthetic candles: drift per symbol, noise per day. */
function synthCandles(symbol, days, drift) {
  const rng = mulberry32(symbol.split("").reduce((h, c) => h + c.charCodeAt(0), 7));
  let price = 100;
  const out = [];
  const day = 86_400_000;
  const base = Date.now();
  for (let i = 0; i < days; i++) {
    price = Math.max(5, price * (1 + drift + (rng() - 0.5) * 0.01));
    const open = price * (1 + (rng() - 0.5) * 0.005);
    const close = price * (1 + (rng() - 0.5) * 0.005);
    out.push({
      time: base - (days - i) * day,
      open,
      high: Math.max(open, close),
      low: Math.min(open, close),
      close,
      volume: 100000,
    });
  }
  return out;
}

function fixtureCtx(symbols) {
  const prices = new Map(symbols.map((s) => [s.symbol, synthCandles(s.symbol, s.days ?? 60, s.drift ?? 0)]));
  return {
    getCandles: (sym) => prices.get(sym) ?? [],
    getUniverse: () => symbols.map((s) => s.symbol),
  };
}

const approx = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// --- indicators --------------------------------------------------------------

test("sma on fixture", () => {
  assert.deepEqual(indicators.sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
  assert.deepEqual(indicators.sma([1, 2, 3, 4, 5], 5), [null, null, null, null, 3]);
});

test("sma edge cases are NaN-safe", () => {
  assert.deepEqual(indicators.sma([], 3), []);
  assert.deepEqual(indicators.sma([1, 2], 3), [null, null]);
  assert.deepEqual(indicators.sma([1, 2, 3], 0), [null, null, null]);
  assert.deepEqual(indicators.sma([1, NaN, 3], 2), [null, null, null]);
  assert.deepEqual(indicators.sma([NaN, 2, 3], 3), [null, null, null]);
});

test("ema seeds from sma and smooths", () => {
  const got = indicators.ema([1, 2, 3, 4, 5], 3);
  assert.deepEqual(got.slice(0, 2), [null, null]);
  assert.ok(approx(got[2], 2));
  assert.ok(approx(got[3], 3));
  assert.ok(approx(got[4], 4));
});

test("roc returns percent change, null before warm", () => {
  const got = indicators.roc([100, 110, 121, 133.1], 1);
  assert.deepEqual(got.slice(0, 1), [null]);
  assert.ok(approx(got[1], 10));
  assert.ok(approx(got[2], 10));
  assert.ok(approx(got[3], 10));
  assert.deepEqual(indicators.roc([100, 110], 5), [null, null]);
  assert.deepEqual(indicators.roc([100, 0, 50], 1), [null, -100, null]);
});

test("zscore standardizes and nulls on zero variance", () => {
  assert.deepEqual(indicators.zscore([1, 3]), [-1, 1]);
  const three = indicators.zscore([1, 2, 3]);
  assert.ok(approx(three[0], -Math.sqrt(3 / 2)));
  assert.equal(three[1], 0);
  assert.deepEqual(indicators.zscore([5, 5, 5]), [null, null, null]);
  assert.deepEqual(indicators.zscore([1, NaN]), [null, null]);
});

test("pctRank maps sorted values to 0..100", () => {
  assert.deepEqual(indicators.pctRank([10, 20, 30]), [0, 50, 100]);
  const rev = indicators.pctRank([30, 10, 20]);
  assert.deepEqual(rev, [100, 0, 50]);
  assert.deepEqual(indicators.pctRank([5, 5, 5]), [50, 50, 50]);
  assert.deepEqual(indicators.pctRank([7]), [0]);
  assert.deepEqual(indicators.pctRank([NaN, 3]), [null, null]);
});

test("pctRank distribution is a proper percentile ranking", () => {
  const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const got = indicators.pctRank(values);
  assert.ok(got.every((v, i) => approx(v, (i / 9) * 100)));
});

test("safeDiv never throws", () => {
  assert.equal(indicators.safeDiv(4, 2), 2);
  assert.equal(indicators.safeDiv(1, 0), null);
  assert.equal(indicators.safeDiv(NaN, 2), null);
  assert.equal(indicators.safeDiv(1, Infinity), null);
  assert.equal(indicators.safeDiv(Infinity, 1), null);
});

// --- demo strategies ----------------------------------------------------------

test("demo-roc20 ranks momentum cross-sectionally", async () => {
  const ctx = fixtureCtx([
    { symbol: "RISER", drift: 0.02, days: 45 },
    { symbol: "FLAT", drift: 0.0, days: 45 },
    { symbol: "FALLER", drift: -0.02, days: 45 },
  ]);
  const a = await roc20Strategy.compute(ctx, "RISER");
  const b = await roc20Strategy.compute(ctx, "FLAT");
  const c = await roc20Strategy.compute(ctx, "FALLER");
  assert.ok(a && b && c);
  assert.ok(a.score > b.score && b.score > c.score, "rising > flat > falling");
  assert.ok(a.score >= 0 && a.score <= 100);
  assert.ok(Number.isFinite(a.components.roc20));
  assert.equal(a.rank, 0, "rank assigned by runner, not strategy");
});

test("demo-roc20 returns null for missing data", async () => {
  const ctx = fixtureCtx([{ symbol: "RISER", drift: 0.02, days: 45 }]);
  assert.equal(await roc20Strategy.compute(ctx, "NOSUCH"), null);
  assert.equal(await roc20Strategy.compute(ctx, "RISER"), null);
});

test("demo-52wlow scores proximity to 52w high", async () => {
  const atHigh = synthCandles("ATH", 50, 0);
  const peak = Math.max(...atHigh.map((c) => c.high));
  const last = atHigh[atHigh.length - 1];
  last.close = peak;
  last.high = peak;
  last.open = peak * 0.99;

  const ctx = {
    getCandles: (sym) =>
      sym === "ATH" ? atHigh : synthCandles("DEEP", 50, -0.01),
  };
  const near = await w52LowStrategy.compute(ctx, "ATH");
  const far = await w52LowStrategy.compute(ctx, "DEEP");
  assert.ok(near && far);
  assert.equal(near.score, 100, "at the 52w high scores 100");
  assert.ok(far.score < near.score, "far from high scores lower");
  assert.equal(near.components.distancePct, 0);
  assert.ok(near.components.fiftyTwoWeekHigh > 0);
});

test("demo-52wlow returns null on short history", async () => {
  const ctx = { getCandles: () => synthCandles("SHORT", 10, 0) };
  assert.equal(await w52LowStrategy.compute(ctx, "SHORT"), null);
});

test("demo metas are honest about being unranked", () => {
  assert.equal(roc20Strategy.meta.juryRank, null);
  assert.equal(roc20Strategy.meta.edgeScore, null);
  assert.equal(w52LowStrategy.meta.juryRank, null);
  assert.match(roc20Strategy.meta.id, /^demo-/);
});

// --- registry ---------------------------------------------------------------

test("registry exposes demo strategies and sorts by juryRank", () => {
  const d1 = { meta: { id: "d1", juryRank: 5 } };
  const d2 = { meta: { id: "d2", juryRank: 1 } };
  const d3 = { meta: { id: "d3", juryRank: null } };
  const d4 = { meta: { id: "d4", juryRank: 3 } };
  for (const s of [d1, d2, d3, d4]) register(s);

  const list = listStrategies();
  const ids = list.map((s) => s.meta.id);
  assert.ok(ids.indexOf("d2") < ids.indexOf("d4"), "rank 1 before rank 3");
  assert.ok(ids.indexOf("d4") < ids.indexOf("d1"), "rank 3 before rank 5");
  assert.ok(ids.indexOf("d1") < ids.indexOf("d3"), "ranked before unranked");

  const ranked = list.filter((s) => s.meta.juryRank !== null);
  const unranked = list.filter((s) => s.meta.juryRank === null);
  for (const r of ranked) assert.ok(r.meta.juryRank < 6);
  assert.ok(unranked.every((s) => s.meta.id.startsWith("d3") || s.meta.id.startsWith("demo-")),
    "only d3 and demos are unranked");

  assert.equal(getStrategy("demo-roc20").meta.name, "ROC(20) Momentum");
  assert.equal(getStrategy("missing-strategy"), undefined);
});

test("registry order is deterministic on rank ties", () => {
  const e1 = { meta: { id: "e-b", juryRank: 2 } };
  const e2 = { meta: { id: "e-a", juryRank: 2 } };
  register(e1);
  register(e2);
  const ids = listStrategies()
    .filter((s) => s.meta.id.startsWith("e-"))
    .map((s) => s.meta.id);
  assert.deepEqual(ids, ["e-a", "e-b"]);
});
