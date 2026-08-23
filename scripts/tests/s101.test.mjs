/**
 * S101 Low-Volatility Anomaly — unit suite (TASK-60).
 * Mirrors s100.test.mjs conventions: deterministic synthetic candles,
 * fixture ctx, registry checks.
 *
 * Run: npm test  (from web/)  ·  node --test scripts/tests/s101.test.mjs
 */
import { registerHooks } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";

registerHooks({
  resolve(specifier, context, nextResolve) {
    const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
    const hasExtension = /\.[a-z0-9]+$/i.test(specifier);
    if (isRelative && !hasExtension) return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  },
});

const { s101LowVolStrategy, realizedVol } = await import(
  "../../web/src/lib/strategies/strategies/s101-low-vol.ts"
);
const { getStrategy, listStrategies } = await import(
  "../../web/src/lib/strategies/registry.ts"
);

const DAY = 86_400_000;

/** Flat closes → zero realized vol; wobbly closes → high vol. */
function candles(shape, n = 200) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const close =
      shape === "flat" ? 100 : 100 * (1 + Math.sin(i / 2.5) * 0.06); // ±6% swings
    out.push({ time: i * DAY, open: close, high: close, low: close, close, volume: 1000 });
  }
  return out;
}

function ctx(symbols, nowMs = 1_750_000_000_000) {
  const map = new Map(symbols.map((s) => [s.symbol, s.candles]));
  return {
    now: () => nowMs,
    getCandles: async (sym) => map.get(sym) ?? [],
    getUniverse: () => symbols.map((s) => s.symbol),
  };
}

test("S101 meta matches the jury record", () => {
  assert.equal(s101LowVolStrategy.meta.id, "S101");
  assert.equal(s101LowVolStrategy.meta.juryRank, 6);
  assert.equal(s101LowVolStrategy.meta.edgeScore, 8.83);
  assert.equal(s101LowVolStrategy.meta.universe, "nifty50");
  assert.equal(s101LowVolStrategy.meta.category, "volatility");
});

test("S101 self-registers on import and screener listing includes it", () => {
  assert.ok(getStrategy("S101"));
  assert.ok(listStrategies().some((s) => s.meta.id === "S101"), "listStrategies auto-lists");
});

test("realizedVol of flat closes is 0; annualized scale sane on noisy series", () => {
  assert.equal(realizedVol(candles("flat").map((c) => c.close)), 0);
  const v = realizedVol(candles("wobbly").map((c) => c.close));
  assert.ok(v > 0.15 && v < 3, `annualized vol ${v} in a plausible band`);
});

test("insufficient history → null (127-close floor)", () => {
  assert.equal(realizedVol(candles("wobbly").map((c) => c.close).slice(0, 100)), null);
  assert.equal(realizedVol([]), null);
});

test("non-positive close in window → null, never NaN", () => {
  const closes = candles("wobbly").map((c) => c.close);
  closes[closes.length - 5] = 0;
  assert.equal(realizedVol(closes), null);
});

test("anomaly inversion: calm symbol outscores wild symbol", async () => {
  const result = await s101LowVolStrategy.compute(
    ctx([
      { symbol: "CALM", candles: candles("flat") },
      { symbol: "WILD", candles: candles("wobbly") },
    ]),
    "CALM"
  );
  assert.ok(result && result.score > 90, `calm scores near 100, got ${result?.score}`);
  assert.equal(result.components.sampleSize, 2);
});

test("wild symbol scores near the bottom of the same distribution", async () => {
  const c = ctx([
    { symbol: "CALM", candles: candles("flat") },
    { symbol: "WILD", candles: candles("wobbly") },
  ]);
  const calm = await s101LowVolStrategy.compute(c, "CALM");
  const wild = await s101LowVolStrategy.compute(c, "WILD");
  assert.ok(wild && calm, "both scored");
  assert.ok(wild.score < 10, `wild scores near 0, got ${wild.score}`);
  assert.ok(calm.score + wild.score === 100, "inverted percentile pair sums to 100");
});

test("short-history symbol returns null while others still score", async () => {
  const short = candles("wobbly").slice(0, 60);
  const sig = await s101LowVolStrategy.compute(
    ctx([
      { symbol: "CALM", candles: candles("flat") },
      { symbol: "SHORT", candles: short },
    ]),
    "SHORT"
  );
  assert.equal(sig, null, "null policy for insufficient history");
});

test("point-in-time safe: identical data at two as-of stamps gives identical scores", async () => {
  const syms = [
    { symbol: "CALM", candles: candles("flat") },
    { symbol: "WILD", candles: candles("wobbly") },
  ];
  const a = await s101LowVolStrategy.compute(ctx(syms, 1_750_000_000_000), "CALM");
  const b = await s101LowVolStrategy.compute(ctx(syms, 1_754_000_000_000), "CALM");
  assert.deepEqual(a.components, b.components, "no wall-clock leakage");
});
