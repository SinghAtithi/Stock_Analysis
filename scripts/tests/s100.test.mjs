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

const { s100MomentumStrategy } = await import(
  "../../web/src/lib/strategies/strategies/s100-momentum.ts"
);
const { getStrategy } = await import("../../web/src/lib/strategies/registry.ts");

// --- fixture helpers (mirror strategies.test.mjs) -----------------------------

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
  const prices = new Map(
    symbols.map((s) => [s.symbol, synthCandles(s.symbol, s.days ?? 60, s.drift ?? 0)])
  );
  return {
    getCandles: (sym) => prices.get(sym) ?? [],
    getUniverse: () => symbols.map((s) => s.symbol),
  };
}

const round4 = (x) => Math.round(x * 10000) / 10000;

/** Exact closes for a geometric series: close[i] = 100 * growth^i. */
function geometricCandles(n, growth) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const close = 100 * Math.pow(growth, i);
    out.push({ time: i, open: close, high: close, low: close, close, volume: 1000 });
  }
  return out;
}

// --- S100 strategy ------------------------------------------------------------

test("S100 meta matches the jury record", () => {
  assert.equal(s100MomentumStrategy.meta.id, "S100");
  assert.equal(s100MomentumStrategy.meta.name, "Momentum Factor (JT)");
  assert.equal(s100MomentumStrategy.meta.category, "momentum");
  assert.equal(s100MomentumStrategy.meta.juryRank, 1);
  assert.equal(s100MomentumStrategy.meta.edgeScore, 9.83);
  assert.equal(s100MomentumStrategy.meta.universe, "nifty50");
  assert.ok(s100MomentumStrategy.meta.inputs.includes("pctRank"));
});

test("S100 self-registers on import", () => {
  const s = getStrategy("S100");
  assert.ok(s, "register() called at module top, registry sees it");
  assert.equal(s.meta.id, "S100");
});

test("S100 ranks cross-sectional momentum: rising > flat > falling", async () => {
  const ctx = fixtureCtx([
    { symbol: "RISER", drift: 0.01, days: 400 },
    { symbol: "FLAT", drift: 0.0, days: 400 },
    { symbol: "FALLER", drift: -0.01, days: 400 },
  ]);
  const a = await s100MomentumStrategy.compute(ctx, "RISER");
  const b = await s100MomentumStrategy.compute(ctx, "FLAT");
  const c = await s100MomentumStrategy.compute(ctx, "FALLER");
  assert.ok(a && b && c, "all three symbols score");
  assert.ok(a.score > b.score && b.score > c.score, "rising > flat > falling");
  assert.ok(a.components.momentum12 > 0, "RISER has positive 12m momentum");
  assert.ok(c.components.momentum12 < 0, "FALLER has negative 12m momentum");
  assert.ok(a.score >= 0 && a.score <= 100, "score in 0..100");
  assert.equal(a.rank, 0, "rank assigned by runner, not strategy");
  assert.equal(a.components.sampleSize, 3);
});

test("S100 returns null with insufficient history", async () => {
  const ctx = fixtureCtx([
    { symbol: "SHORT", drift: 0.0, days: 199 },
    { symbol: "LONG", drift: 0.005, days: 400 },
    { symbol: "LONG2", drift: -0.005, days: 400 },
  ]);
  assert.equal(await s100MomentumStrategy.compute(ctx, "SHORT"), null, "<200 closes -> null");
  assert.ok(await s100MomentumStrategy.compute(ctx, "LONG"), "sufficient history scores");
  assert.equal(await s100MomentumStrategy.compute(ctx, "NOSUCH"), null);
});

test("S100 exact 12-1 momentum math on a constructed fixture", async () => {
  // n = 253 closes: t = 252, close[t-21] = idx 231, close[t-252] = idx 0.
  const n = 253;
  const exact = geometricCandles(n, 1.001);
  const other = geometricCandles(n, 1.002);
  const ctx = {
    getCandles: (sym) => (sym === "EXACT" ? exact : other),
    getUniverse: () => ["EXACT", "OTHER"],
  };
  const sig = await s100MomentumStrategy.compute(ctx, "EXACT");
  assert.ok(sig, "exact fixture scores");

  // momentum12 = close[t-21]/close[t-252] - 1 = 1.001^231 - 1 (skip honored).
  assert.equal(
    sig.components.momentum12,
    round4(Math.pow(1.001, 231) - 1),
    "12m return anchored at close[t-21] and close[t-252]"
  );
  // momentum1 = close[t-1]/close[t-21] - 1 = 1.001^20 - 1 (excludes today,
  // spans the 21-session skip window).
  assert.equal(
    sig.components.momentum1,
    round4(Math.pow(1.001, 20) - 1),
    "1m return spans close[t-1] to close[t-21]"
  );
  assert.notEqual(
    sig.components.momentum1,
    round4(Math.pow(1.001, 21) - 1),
    "skip window must end at t-21, not t"
  );
  assert.equal(sig.components.sampleSize, 2);
  assert.ok(sig.components.pctRank >= 0 && sig.components.pctRank <= 100);
});

test("S100 is NaN-safe on a flat series", async () => {
  const flat = Array.from({ length: 300 }, (_, i) => ({
    time: i,
    open: 100,
    high: 100,
    low: 100,
    close: 100,
    volume: 1000,
  }));
  const ctx = {
    getCandles: () => flat,
    getUniverse: () => ["FLAT1", "FLAT2"],
  };
  const a = await s100MomentumStrategy.compute(ctx, "FLAT1");
  const b = await s100MomentumStrategy.compute(ctx, "FLAT2");
  assert.ok(a && b, "all-equal closes still score");
  assert.equal(a.components.momentum12, 0, "zero return, not NaN");
  assert.equal(a.components.momentum1, 0);
  assert.equal(a.score, 50, "tie-averaged pctRank midpoint");
  assert.ok(Number.isFinite(a.score));
  for (const v of Object.values(a.components)) {
    assert.ok(v === null || Number.isFinite(v), "no NaN in components");
  }
});

test("S100 returns null when anchor closes are non-finite", async () => {
  const good = geometricCandles(300, 1.001);
  const bad = geometricCandles(300, 1.001);
  bad[bad.length - 1].close = NaN; // close[t] itself is never used, so corrupt the t-21 anchor
  bad[bad.length - 1 - 21].close = NaN; // close[t-21], the momentum12 end anchor
  const ctx = {
    getCandles: (sym) => (sym === "BAD" ? bad : sym === "GOOD" ? good : good),
    getUniverse: () => ["BAD", "GOOD", "GOOD2"],
  };
  assert.equal(await s100MomentumStrategy.compute(ctx, "BAD"), null);
  assert.ok(await s100MomentumStrategy.compute(ctx, "GOOD"), "unaffected symbol still scores");
});
