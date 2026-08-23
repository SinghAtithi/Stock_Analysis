/**
 * TASK-34 AC3 — point-in-time purity of the strategy registry.
 *
 * Walk-forward backfills (--as-of) are only reproducible if strategies derive
 * wall-clock quantities from ctx.now(). These tests pin the contract:
 *   1. evalNow/evalDay fall back to real time only when the runner is silent
 *   2. scoring is identical across different evaluation instants on the same
 *      data (no wall-clock leakage)
 *   3. STATIC GUARD: no strategy source may reference Date.now() directly
 *
 * Run: npm test  (from web/)  ·  node --test scripts/tests/point-in-time.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
    const hasExtension = /\.[a-z0-9]+$/i.test(specifier);
    if (isRelative && !hasExtension) return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  },
});

const STRATEGIES_DIR = path.join(import.meta.dirname, "..", "..", "web", "src", "lib", "strategies");

const { evalNow, evalDay } = await import("../../web/src/lib/strategies/pointInTime.ts");
const { roc20Strategy } = await import("../../web/src/lib/strategies/demo/roc20.ts");

test("evalNow falls back to Date.now only without ctx.now", () => {
  const real = evalNow({});
  assert.ok(Math.abs(real - Date.now()) < 50, "fallback is wall clock");
  const pinned = evalNow({ now: () => 1_700_000_000_000 });
  assert.equal(pinned, 1_700_000_000_000);
});

test("evalDay buckets the injected clock, not wall clock", () => {
  assert.equal(evalDay({ now: () => 0 }), 0);
  const days = Math.floor(Date.now() / 86_400_000);
  assert.equal(evalDay({}), days);
});

function makeCtx(nowMs) {
  // flat upward drift series, 60 daily candles ending "now"
  const end = Math.floor(nowMs / 1000);
  const DAY = 86_400;
  const mk = (sym) =>
    Array.from({ length: 60 }, (_, i) => ({
      time: end - (60 - i) * DAY,
      open: 100 + i + (sym === "TEST2" ? 7 : 0),
      high: 101 + i + (sym === "TEST2" ? 7 : 0),
      low: 99 + i + (sym === "TEST2" ? 7 : 0),
      close: 100 + i + (sym === "TEST2" ? 7 : 0),
      volume: 1000,
    }));
  const cache = new Map();

  return {
    universe: ["TEST", "TEST2"],
    now: () => nowMs,
    async getCandles(symbol) {
      if (!cache.has(symbol)) cache.set(symbol, mk(symbol));
      return cache.get(symbol);
    },
    getUniverse: () => ["TEST", "TEST2"],
  };
}

test("roc20 output depends on data, not the wall clock (two as-of stamps)", async () => {
  const t1 = 1_750_000_000_000;
  const a = await roc20Strategy.compute(makeCtx(t1), "TEST");
  const b = await roc20Strategy.compute(makeCtx(t1 + 40 * 86_400_000), "TEST");
  assert.ok(a && b, "both evaluations produced signals");
  assert.equal(a.score, b.score, "identical data ⇒ identical score at any as-of");
  assert.equal(a.components.roc20, b.components.roc20);
});

test("STATIC GUARD: strategies never call Date.now() directly", () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith(".ts") && entry.name !== "pointInTime.ts" && entry.name !== "types.ts") {
        const src = readFileSync(p, "utf8");
        if (/Date\.now\(/.test(src)) offenders.push(path.relative(STRATEGIES_DIR, p));
      }
    }
  };
  walk(STRATEGIES_DIR);
  assert.deepEqual(offenders, [], "use evalNow(ctx)/evalDay(ctx) from pointInTime.ts");
});
