import { registerHooks } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

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

const { s172DualStrategy, ASSETS, CASH, ret12 } = await import(
  "../../web/src/lib/strategies/strategies/s172-dual.ts"
);
const { s174TsmStrategy, realizedVol } = await import(
  "../../web/src/lib/strategies/strategies/s174-tsm.ts"
);
const { getStrategy } = await import("../../web/src/lib/strategies/registry.ts");

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

/** Candles from an explicit price path (deterministic, no noise). */
function pricesToCandles(prices) {
  const day = 86_400_000;
  const base = Date.now();
  return prices.map((p, i) => ({
    time: base - (prices.length - i) * day,
    open: p, high: p, low: p, close: p, volume: 100000,
  }));
}

function fixtureCtx(symbols) {
  const candles = new Map(
    symbols.map((s) => [s.symbol, s.prices ? pricesToCandles(s.prices) : synthCandles(s.symbol, s.days ?? 320, s.drift ?? 0)])
  );
  return {
    getCandles: (sym) => candles.get(sym) ?? [],
    getUniverse: () => symbols.map((s) => s.symbol),
  };
}

const DAYS = 320; // enough for 200d SMA + 12-1 return (283 needed)

// --- S172: dual momentum ----------------------------------------------------

test("S172 risk-on regime: ranks by 12-1 return, top scores 100", async () => {
  const ctx = fixtureCtx([
    { symbol: "NIFTY 50", drift: 0.005, days: DAYS },
    { symbol: "SENSEX", drift: 0.001, days: DAYS },
    { symbol: "GOLDBEES", drift: -0.005, days: DAYS },
  ]);
  const riser = await s172DualStrategy.compute(ctx, "NIFTY 50");
  const mid = await s172DualStrategy.compute(ctx, "SENSEX");
  const faller = await s172DualStrategy.compute(ctx, "GOLDBEES");
  const cash = await s172DualStrategy.compute(ctx, CASH);
  assert.ok(riser && mid && faller && cash);

  assert.equal(riser.components.regime, "risk-on");
  assert.equal(riser.components.rank, 1);
  assert.equal(riser.score, 100, "top of the risk-on stack scores 100");
  assert.ok(riser.components.sma200 > 1, "RISER above its 200d SMA");
  assert.ok(riser.components.ret12 > 0);

  assert.ok(mid.score < riser.score, "second-ranked scores lower");
  assert.ok(mid.score > 0);
  assert.equal(faller.score, 0, "negative-momentum asset scores 0");
  assert.equal(cash.score, 0, "cash scores 0 in a risk-on regime");
  assert.equal(cash.components.regime, "risk-on");
});

test("S172 cash regime when the top asset's 12-1 return is negative", async () => {
  const ctx = fixtureCtx([
    { symbol: "NIFTY 50", drift: -0.004, days: DAYS },
    { symbol: "SENSEX", drift: -0.006, days: DAYS },
  ]);
  const top = await s172DualStrategy.compute(ctx, "NIFTY 50");
  const cash = await s172DualStrategy.compute(ctx, CASH);
  assert.ok(top && cash);
  assert.ok(top.components.ret12 < 0, "best available asset still negative");
  assert.equal(top.components.regime, "cash");
  assert.equal(top.components.rank, 1);
  assert.equal(top.score, 0, "risky assets are 0 in cash regime");
  assert.equal(cash.score, 100, "cash scores 100 in cash regime");
});

test("S172 absolute-momentum gate: above-SMA required even when top-ranked", async () => {
  const prices = [];
  for (let t = 0; t < 151; t++) prices.push(100 + (100 / 150) * t); // rise to 200
  for (let t = 151; t < 321; t++) prices.push(200 - (20 / 170) * (t - 150)); // bleed to 180
  const ctx = fixtureCtx([{ symbol: "NIFTY 50", prices }]);
  const sig = await s172DualStrategy.compute(ctx, "NIFTY 50");
  assert.ok(sig);
  assert.ok(sig.components.ret12 > 0, "12-1 return is positive (top-ranked)");
  assert.ok(sig.components.sma200 < 1, "price below its 200d SMA");
  assert.equal(sig.components.regime, "risk-on");
  assert.equal(sig.components.rank, 1);
  assert.equal(sig.score, 0, "absolute-momentum gate forces risk-off");
});

test("S172 returns null for missing or short series (NaN-safe)", async () => {
  assert.equal(await s172DualStrategy.compute(fixtureCtx([]), "NIFTY 50"), null);
  assert.equal(await s172DualStrategy.compute(fixtureCtx([]), CASH), null, "no assets -> unknown regime");
  assert.equal(
    await s172DualStrategy.compute(fixtureCtx([{ symbol: "NIFTY 50", days: 100 }]), "NIFTY 50"),
    null, "short history"
  );
  assert.equal(
    await s172DualStrategy.compute(fixtureCtx([{ symbol: "UNKNOWN" }]), "UNKNOWN"), null,
    "not in the asset universe"
  );

  const nanSeries = synthCandles("NIFTY 50", DAYS, 0.005);
  nanSeries[DAYS - 1 - 21 - 252].close = NaN; // corrupt the 12-1 base price
  const ctx = { getCandles: (sym) => (sym === "NIFTY 50" ? nanSeries : []) };
  assert.equal(await s172DualStrategy.compute(ctx, "NIFTY 50"), null, "NaN in window -> null");

  const nanSeries2 = synthCandles("SENSEX", DAYS, 0.005);
  nanSeries2[DAYS - 1 - 21].close = NaN; // corrupt the 12-1 current leg
  assert.equal(
    await s172DualStrategy.compute({ getCandles: (s) => (s === "SENSEX" ? nanSeries2 : []) }, "SENSEX"),
    null, "NaN at the current leg -> null");
});

// --- S174: time-series momentum ---------------------------------------------

test("S174 sign and vol-scaling math", async () => {
  const riserCandles = synthCandles("NIFTY 50", DAYS, 0.005);
  const fallerCandles = synthCandles("SENSEX", DAYS, -0.005);
  const ctx = { getCandles: (sym) => (sym === "NIFTY 50" ? riserCandles : fallerCandles) };
  const riser = await s174TsmStrategy.compute(ctx, "NIFTY 50");
  const faller = await s174TsmStrategy.compute(ctx, "SENSEX");
  assert.ok(riser && faller);

  assert.equal(riser.components.sign, 1);
  assert.ok(riser.components.ret12 > 0);
  const vol = realizedVol(riserCandles.map((c) => c.close));
  assert.ok(vol && vol > 0);
  assert.ok(Math.abs(riser.components.exposure - 0.15 / vol) < 0.01, "exposure = volTarget / realizedVol (2dp)");
  assert.equal(riser.score, Math.min(100, Math.round((50 + (0.15 / vol) * 50) * 100) / 100), "score = clamp(50 + exposure*50)");

  assert.equal(faller.components.sign, -1);
  assert.ok(faller.components.ret12 < 0);
  assert.ok(faller.score < 50, "short-side scores below neutral");
  assert.ok(faller.score >= 0);
  assert.equal(faller.components.exposure < 0, true);
});

test("S174 clamps at full-target long exposure (low vol)", async () => {
  const candles = synthCandles("NIFTY 50", DAYS, 0.02); // strong steady trend, low noise
  const ctx = { getCandles: () => candles };
  const sig = await s174TsmStrategy.compute(ctx, "NIFTY 50");
  assert.ok(sig);
  assert.equal(sig.components.sign, 1);
  assert.equal(sig.score, 100, "exposure >= 1 clamps at 100");
});

test("S174 NaN-safety: zero-vol, NaN and short series yield null, never NaN", async () => {
  const flat = pricesToCandles(new Array(DAYS).fill(100));
  const ctxFlat = { getCandles: () => flat };
  const flatSig = await s174TsmStrategy.compute(ctxFlat, "NIFTY 50");
  assert.equal(flatSig, null, "zero realized vol -> no signal, not NaN");

  const nanSeries = synthCandles("NIFTY 50", DAYS, 0.005);
  nanSeries[DAYS - 1 - 21 - 252].close = NaN;
  assert.equal(await s174TsmStrategy.compute({ getCandles: (s) => (s === "NIFTY 50" ? nanSeries : []) }, "NIFTY 50"), null);

  assert.equal(await s174TsmStrategy.compute(fixtureCtx([{ symbol: "NIFTY 50", days: 50 }]), "NIFTY 50"), null);
  assert.equal(await s174TsmStrategy.compute(fixtureCtx([]), "SENSEX"), null);
});

test("S174 CASH is neutral (sign 0, score 50)", async () => {
  const ctx = fixtureCtx([{ symbol: "NIFTY 50", drift: 0.005, days: DAYS }]);
  const cash = await s174TsmStrategy.compute(ctx, CASH);
  assert.ok(cash);
  assert.equal(cash.score, 50);
  assert.equal(cash.components.sign, 0);
  assert.equal(cash.components.ret12, 0);
  assert.equal(cash.components.exposure, 0);
});

// --- registry / helpers ------------------------------------------------------

test("S172/S174 self-register and carry jury metadata", () => {
  const s172 = getStrategy("S172");
  const s174 = getStrategy("S174");
  assert.ok(s172 && s174, "importing the modules registered them");
  assert.equal(s172.meta.juryRank, 5);
  assert.equal(s174.meta.juryRank, 3);
  assert.ok(Array.isArray(ASSETS) && ASSETS.length === 3);
  assert.equal(CASH, "CASH");
});

test("ret12 skips the last month and is NaN-safe", () => {
  const closes = new Array(300).fill(100).map((v, i) => (i < 273 ? 100 : 100 + i * 0.01));
  const got = ret12(closes);
  assert.ok(Number.isFinite(got), "computes on enough data");
  assert.equal(ret12(new Array(100).fill(100)), null, "short history");
  const nan = [...closes];
  nan[300 - 1 - 21 - 252] = NaN; // base leg of the 12-1 window
  assert.equal(ret12(nan), null, "NaN on the 12-1 base leg");
});

// --- REAL RUN: live asset series from eod_candles (read-only) ---------------

test("REAL RUN: S172/S174 regime on live asset data", async () => {
  // needs the local ingest DB (gitignored) — skip on fresh checkouts/CI.
  // Size floor (same contract as eod-cliff-sweep): an empty/thin app.db can
  // be manufactured mid-run by another suite calling openDb() — existsSync
  // alone is not enough to prove real data.
  const dbPath = path.join(process.cwd(), "..", "db", "data", "app.db");
  if (!existsSync(dbPath) || statSync(dbPath).size < 64_000) {
    console.log("  [real-run] no local ingest DB — skipping (CI/fresh checkout)");
    return;
  }
  let db;
  try {
    const { openDb } = await import("../lib/db.mjs");
    db = openDb();
    const count = db.prepare("SELECT COUNT(*) c FROM eod_candles WHERE symbol IN ('NIFTY 50','SENSEX','GOLDBEES')").get().c;
    if (count === 0) {
      console.log("  [real-run] no asset series in eod_candles — run scripts/fetch-assets.mjs first; skipping");
      return;
    }
    const stmt = db.prepare(
      "SELECT ts, o, h, l, c, v FROM eod_candles WHERE symbol = ? AND ts >= ? ORDER BY ts ASC"
    );
    const ctx = {
      getUniverse: () => [...ASSETS, CASH],
      async getCandles(symbol, lookbackDays) {
        const since = Math.floor(Date.now() / 1000) - lookbackDays * 86_400 * 1.6;
        return stmt.all(symbol, since).map((r) => ({
          time: r.ts, open: r.o, high: r.h, low: r.l, close: r.c, volume: r.v,
        }));
      },
    };
    for (const strategy of [s172DualStrategy, s174TsmStrategy]) {
      console.log(`\n[${strategy.meta.id}] ${strategy.meta.name}`);
      let n = 0;
      for (const sym of [...ASSETS, CASH]) {
        const sig = await strategy.compute(ctx, sym);
        if (!sig) { console.log(`  ${sym.padEnd(10)} no-signal`); continue; }
        n++;
        console.log(`  ${sym.padEnd(10)} score=${String(sig.score).padStart(6)}  ${JSON.stringify(sig.components)}`);
        assert.ok(sig.score >= 0 && sig.score <= 100);
        assert.ok(sig.rank === 0);
      }
      assert.ok(n > 0, "at least one asset scored");
    }
  } catch (e) {
    throw e;
  } finally {
    db?.close();
  }
});
