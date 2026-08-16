import { registerHooks } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

const { openDb, REPO_ROOT } = await import("../lib/db.mjs");
const { s100MomentumStrategy } = await import(
  "../../web/src/lib/strategies/strategies/s100-momentum.ts"
);

const INSTRUMENTS_PATH = path.join(REPO_ROOT, "web", "src", "data", "instruments.json");
const LOOKBACK_DAYS = 400;

/**
 * Nifty 50 members as eod_candles symbols. instruments.json stores bare
 * symbols ("ADANIENT"); eod_candles stores exchange-suffixed ("ADANIENT.NS").
 */
function resolveUniverse() {
  const raw = JSON.parse(readFileSync(INSTRUMENTS_PATH, "utf8"));
  const bare = new Set();
  for (const inst of raw) {
    if (inst && Array.isArray(inst.idx) && inst.idx.includes("NIFTY 50")) {
      bare.add(inst.s);
    }
  }
  const db = openDb();
  const dbSymbols = new Set(
    db.prepare("SELECT DISTINCT symbol FROM eod_candles").all().map((r) => r.symbol)
  );
  db.close();
  return [...bare]
    .filter((s) => dbSymbols.has(`${s}.NS`))
    .map((s) => `${s}.NS`)
    .sort();
}

function makeContext(symbols) {
  const db = openDb();
  // eod_candles.ts is stored in epoch seconds (run-signals.mjs compares
  // against millis — pre-existing units mismatch, corrected here).
  const since = Math.floor(Date.now() / 1000) - LOOKBACK_DAYS * 86_400 * 1.6;
  const stmt = db.prepare(
    "SELECT ts, o, h, l, c, v FROM eod_candles WHERE symbol = ? AND ts >= ? ORDER BY ts ASC"
  );
  return {
    db,
    getCandles(symbol) {
      const rows = stmt.all(symbol, since);
      return rows.map((r) => ({
        time: r.ts,
        open: r.o,
        high: r.h,
        low: r.l,
        close: r.c,
        volume: r.v,
      }));
    },
    getUniverse() {
      return symbols;
    },
  };
}

test("S100 real-data run over Nifty 50 eod_candles", async () => {
  const symbols = resolveUniverse();
  assert.ok(symbols.length >= 30, `expected a populated Nifty 50 universe, got ${symbols.length}`);

  const ctx = makeContext(symbols);
  const signals = [];
  for (const symbol of symbols) {
    const sig = await s100MomentumStrategy.compute(ctx, symbol);
    if (sig) signals.push(sig);
  }
  ctx.db.close();

  signals.sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));
  const top10 = signals.slice(0, 10);
  assert.ok(
    top10.length >= 10,
    `expected at least 10 scored signals from ${symbols.length} symbols, got ${signals.length}`
  );

  const asOf = new Date(1786685400 * 1000).toISOString().slice(0, 10);
  console.log(`\nS100 real-data run: universe=${symbols.length} scored=${signals.length} data-as-of=${asOf}`);
  console.log("rank  symbol          score  momentum12  momentum1  pctRank");
  top10.forEach((s, i) => {
    console.log(
      `${String(i + 1).padStart(4)}  ${s.symbol.padEnd(15)} ${String(s.score).padStart(5)}  ${String(s.components.momentum12).padStart(9)}  ${String(s.components.momentum1).padStart(9)}  ${String(s.components.pctRank).padStart(6)}`
    );
  });

  for (const s of top10) {
    assert.ok(Number.isFinite(s.score) && s.score >= 0 && s.score <= 100);
    assert.ok(Number.isFinite(s.components.momentum12), `${s.symbol} momentum12 finite`);
  }
  assert.ok(top10[0].score >= top10[9].score, "top-10 sorted descending");
});
