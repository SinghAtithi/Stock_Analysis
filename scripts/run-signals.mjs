#!/usr/bin/env node
/**
 * Signal scheduler (T14). Runs registered strategies over a universe and
 * persists signal_snapshots (rank 1..N by score desc).
 *
 * Usage:
 *   node --experimental-strip-types scripts/run-signals.mjs [strategyId] [--universe nifty50|nifty500] [--fixtures]
 *
 * --fixtures: seed deterministic synthetic candles in memory (smoke test when
 * eod_candles is empty; nothing is written to the DB for candles).
 *
 * Node's native type stripping resolves relative import specifiers verbatim,
 * so web/src/lib/strategies/*.ts use extensionless relative imports (they are
 * type-checked by tsc, not resolved by Node). The registerHooks resolve hook
 * below appends ".ts" so Node can load them. No transpiler dependency.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerHooks } from "node:module";
import { openDb, REPO_ROOT } from "./lib/db.mjs";
import { toAdjustedCandles } from "./lib/adjust.mjs";

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

const { getStrategy, listStrategies } = await import(
  "../web/src/lib/strategies/registry.ts"
);

const INSTRUMENTS_PATH = path.join(REPO_ROOT, "web", "src", "data", "instruments.json");
const UNIVERSE_LABEL = { nifty50: "NIFTY 50", nifty500: "NIFTY 500" };
const FIXTURE_DAYS = 50;

function parseArgs(argv) {
  const args = { strategyId: null, universe: "nifty50", fixtures: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--universe") {
      const v = argv[++i];
      if (v !== "nifty50" && v !== "nifty500") {
        console.error(`unknown universe "${v}" (expected nifty50|nifty500)`);
        process.exit(2);
      }
      args.universe = v;
    } else if (a === "--fixtures") {
      args.fixtures = true;
    } else if (a.startsWith("--")) {
      console.error(`unknown flag "${a}"`);
      process.exit(2);
    } else if (args.strategyId === null) {
      args.strategyId = a;
    } else {
      console.error(`unexpected argument "${a}"`);
      process.exit(2);
    }
  }
  return args;
}

function resolveUniverse(universe) {
  const raw = JSON.parse(readFileSync(INSTRUMENTS_PATH, "utf8"));
  const label = UNIVERSE_LABEL[universe];
  const symbols = [];
  const seen = new Set();
  for (const inst of raw) {
    if (inst && Array.isArray(inst.idx) && inst.idx.includes(label) && !seen.has(inst.s)) {
      seen.add(inst.s);
      symbols.push(inst.s);
    }
  }
  return symbols;
}

function hashSeed(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

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

/** Deterministic synthetic candles, in memory only (smoke-test mode). */
function fixtureCandles(symbol) {
  const rng = mulberry32(hashSeed(symbol));
  const drift = (rng() - 0.5) * 0.04;
  let price = 100 + rng() * 400;
  const out = [];
  const now = Date.now();
  const day = 86_400_000;
  for (let i = 0; i < FIXTURE_DAYS; i++) {
    const ts = now - (FIXTURE_DAYS - i) * day;
    price = Math.max(5, price * (1 + drift + (rng() - 0.5) * 0.035));
    const open = price * (1 + (rng() - 0.5) * 0.01);
    const close = price * (1 + (rng() - 0.5) * 0.02);
    const high = Math.max(open, close) * (1 + rng() * 0.015);
    const low = Math.min(open, close) * (1 - rng() * 0.015);
    const volume = Math.floor(1_000_000 * (0.4 + rng()));
    out.push({ time: ts, open, high, low, close, volume });
  }
  return out;
}

function loadDb() {
  const db = openDb();
  const hasCandles =
    db.prepare("SELECT COUNT(*) AS c FROM eod_candles").get().c > 0;
  return { db, hasCandles };
}

function makeContext(db, universeSymbols, fixtures) {
  // universe labels are bare ("RELIANCE") but eod_candles keys are suffixed
  // ("RELIANCE.NS") — resolve once so real candles are actually read
  const dbSymbols = new Set(
    db.prepare("SELECT DISTINCT symbol FROM eod_candles").all().map((r) => r.symbol)
  );
  const resolveCandleSymbol = (s) =>
    dbSymbols.has(s) ? s : dbSymbols.has(`${s}.NS`) ? `${s}.NS` : s;
  const stmt = db.prepare(
    "SELECT ts, o, h, l, c, v, adj_factor FROM eod_candles WHERE symbol = ? AND ts >= ? ORDER BY ts ASC"
  );
  return {
    universe: universeSymbols,
    async getCandles(symbol, lookbackDays) {
      if (fixtures) return fixtureCandles(symbol);
      // eod_candles.ts is epoch SECONDS (see schema) — Date.now() is ms; mixing
      // them filtered out every row and silently nulled all signals
      const since = Math.floor(Date.now() / 1000) - lookbackDays * 86_400 * 1.6;
      const rows = stmt.all(resolveCandleSymbol(symbol), since);
      return toAdjustedCandles(rows);
    },
    getUniverse(_universe) {
      // The runner decides what is being scored; cross-sectional strategies
      // rank against the runner's universe regardless of the label requested.
      return universeSymbols;
    },
  };
}

async function runStrategy(strategy, ctx, db, asOf, universeLabel) {
  const t0 = Date.now();
  const signals = [];
  let failed = 0;
  for (const symbol of ctx.universe) {
    try {
      const signal = await strategy.compute(ctx, symbol);
      if (signal) signals.push(signal);
    } catch (err) {
      failed++;
      console.error(`  ! ${strategy.meta.id}/${symbol}: ${err.message}`);
    }
  }

  signals.sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));
  const ranked = signals.map((s, i) => ({ ...s, rank: i + 1 }));

  const del = db.prepare(
    "DELETE FROM signal_snapshots WHERE strategy_id = ? AND as_of = ?"
  );
  const ins = db.prepare(
    "INSERT INTO signal_snapshots (strategy_id, symbol, score, rank, components_json, as_of) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const run = db.transaction(() => {
    del.run(strategy.meta.id, asOf);
    for (const s of ranked) {
      ins.run(
        strategy.meta.id,
        s.symbol,
        s.score,
        s.rank,
        JSON.stringify(s.components),
        asOf
      );
    }
  });
  run();

  console.log(`\n[${strategy.meta.id}] ${strategy.meta.name}`);
  console.log(
    `  category=${strategy.meta.category} universe=${universeLabel} signals=${ranked.length} failed=${failed} wrote=${ranked.length} ms=${Date.now() - t0}`
  );
  if (ranked.length > 0) {
    const top = ranked.slice(0, 5);
    for (const s of top) {
      console.log(
        `  #${String(s.rank).padStart(2)} ${s.symbol.padEnd(12)} ${String(s.score).padStart(6)} ${JSON.stringify(s.components)}`
      );
    }
  }
  return ranked.length;
}

const args = parseArgs(process.argv.slice(2));
const universeSymbols = resolveUniverse(args.universe);
const { db, hasCandles } = loadDb();

console.log(`universe=${args.universe} (${universeSymbols.length} symbols, deduped)`);
console.log(`eod_candles rows>0: ${hasCandles}  fixtures=${args.fixtures}`);

const strategies = args.strategyId
  ? [getStrategy(args.strategyId)]
  : listStrategies();
if (strategies.some((s) => s === undefined)) {
  console.error(`unknown strategy "${args.strategyId}"`);
  console.error(`registered: ${listStrategies().map((s) => s.meta.id).join(", ")}`);
  process.exit(1);
}

const ctx = makeContext(db, universeSymbols, args.fixtures);
const asOf = Math.floor(Date.now() / 1000);

let total = 0;
for (const strategy of strategies) {
  if (strategy.meta.universe !== args.universe) {
    console.log(`note: ${strategy.meta.id} design universe=${strategy.meta.universe}, running on ${args.universe}`);
  }
  total += await runStrategy(strategy, ctx, db, asOf, args.universe);
}

db.close();
console.log(`\ndone: ${strategies.length} strategy(ies), ${total} signals written, as_of=${asOf}`);
