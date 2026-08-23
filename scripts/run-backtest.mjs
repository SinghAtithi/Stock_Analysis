#!/usr/bin/env node
/**
 * Backtest CLI (T23). Long-only monthly-rebalanced top-N backtest over
 * signal_snapshots, with costs, vs an equal-weight buy-and-hold universe.
 *
 * Usage:
 *   node --experimental-strip-types scripts/run-backtest.mjs [strategyId]
 *     [--strategy <id>] [--universe nifty50|nifty500] [--top N] [--start YYYY-MM-DD]
 *     [--end YYYY-MM-DD] [--cost 0.15] [--slippage 0.05]
 *
 * --cost / --slippage are one-way percentages (0.15 = 15 bps brokerage).
 * Loads candles from eod_candles and latest signal_snapshots per strategy
 * (as_of <= rebalance date, nearest), runs the engine, prints a metrics
 * table and the equity curve head/tail, and persists a row in backtest_runs.
 *
 * Node's native type stripping resolves relative import specifiers verbatim,
 * so web/src/lib/backtest/*.ts use extensionless relative imports (type
 * checked by tsc, resolved by the registerHooks resolve hook below, which
 * appends ".ts"). No transpiler dependency.
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

const { runBacktest, SnapshotScorer } = await import(
  "../web/src/lib/backtest/engine.ts"
);
const { computeSeriesMetrics, computeMetrics, RF_ANNUAL } = await import(
  "../web/src/lib/backtest/metrics.ts"
);

const INSTRUMENTS_PATH = path.join(REPO_ROOT, "web", "src", "data", "instruments.json");
const UNIVERSE_LABEL = { nifty50: "NIFTY 50", nifty500: "NIFTY 500" };
const PRE_WINDOW_DAYS = 400; // lookback for the first day's return

function parseArgs(argv) {
  const args = {
    strategyId: null,
    universe: "nifty50",
    top: 20,
    start: "2018-01-01",
    end: null,
    cost: 0.15,
    slippage: 0.05,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--universe") {
      const v = argv[++i];
      if (v !== "nifty50" && v !== "nifty500") {
        console.error(`unknown universe "${v}" (expected nifty50|nifty500)`);
        process.exit(2);
      }
      args.universe = v;
    } else if (a === "--top") {
      const v = Number(argv[++i]);
      if (!Number.isInteger(v) || v < 1) {
        console.error(`--top must be a positive integer, got "${argv[i]}"`);
        process.exit(2);
      }
      args.top = v;
    } else if (a === "--start" || a === "--end") {
      const v = argv[++i];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
        console.error(`${a} must be YYYY-MM-DD, got "${v}"`);
        process.exit(2);
      }
      if (a === "--start") args.start = v;
      else args.end = v;
    } else if (a === "--cost" || a === "--slippage") {
      const v = Number(argv[++i]);
      if (!Number.isFinite(v) || v < 0) {
        console.error(`${a} must be a non-negative percentage, got "${argv[i]}"`);
        process.exit(2);
      }
      if (a === "--cost") args.cost = v;
      else args.slippage = v;
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

function resolveUniverseCandleSymbols(universe, dbSymbols) {
  const raw = JSON.parse(readFileSync(INSTRUMENTS_PATH, "utf8"));
  const label = UNIVERSE_LABEL[universe];
  const dbSet = new Set(dbSymbols);
  const seen = new Set();
  const out = [];
  for (const inst of raw) {
    if (!inst || !Array.isArray(inst.idx) || !inst.idx.includes(label)) continue;
    // instruments.json stores bare symbols ("ADANIENT"); eod_candles stores
    // exchange-qualified ("ADANIENT.NS"). Resolve either form.
    const resolved = dbSet.has(inst.s) ? inst.s : dbSet.has(`${inst.s}.NS`) ? `${inst.s}.NS` : null;
    if (resolved && !seen.has(resolved)) {
      seen.add(resolved);
      out.push(resolved);
    }
  }
  return out;
}

function fmtPct(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return "n/a";
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(2)}%`;
}

function fmtNum(v, digits = 3) {
  if (v === null || v === undefined || !Number.isFinite(v)) return "n/a";
  return v.toFixed(digits);
}

function printEquityHeadTail(equity, n = 5) {
  const row = (p) =>
    `  ${p.date}   ${p.strat.toFixed(6).padStart(12)}   ${p.bench.toFixed(6).padStart(12)}`;
  console.log("  date         strategy     benchmark");
  for (let i = 0; i < Math.min(n, equity.length); i++) console.log(row(equity[i]));
  if (equity.length > 2 * n) {
    console.log(`  ... ${equity.length - 2 * n} days omitted ...`);
    for (let i = equity.length - n; i < equity.length; i++) console.log(row(equity[i]));
  } else if (equity.length > n) {
    for (let i = n; i < equity.length; i++) console.log(row(equity[i]));
  }
}

const args = parseArgs(process.argv.slice(2));
if (!args.strategyId) {
  console.error("missing strategy id (positional or --strategy <id>)");
  process.exit(2);
}

const db = openDb();
try {
  const dbSymbols = db.prepare("SELECT DISTINCT symbol FROM eod_candles").all().map((r) => r.symbol);
  const universe = resolveUniverseCandleSymbols(args.universe, dbSymbols);
  if (universe.length === 0) {
    console.error(`no ${args.universe} symbols with candles in eod_candles`);
    process.exit(1);
  }

  const startTs =
    Math.floor(Date.parse(`${args.start}T00:00:00Z`) / 1000) - PRE_WINDOW_DAYS * 86_400;
  // adj_factor included: backtests must trade the split-adjusted series (TASK-15)
  const candleRows = db
    .prepare("SELECT symbol, ts, o, h, l, c, v, adj_factor FROM eod_candles WHERE ts >= ? ORDER BY ts ASC")
    .all(startTs);
  const candlesBySymbol = new Map();
  for (const r of candleRows) {
    if (!candlesBySymbol.has(r.symbol)) candlesBySymbol.set(r.symbol, []);
    candlesBySymbol.get(r.symbol).push(r);
  }
  for (const [sym, rows] of candlesBySymbol) {
    candlesBySymbol.set(sym, toAdjustedCandles(rows));
  }
  for (const sym of universe) {
    if (!candlesBySymbol.has(sym)) {
      console.error(`no candles for ${sym} — run the eod ingest first`);
      process.exit(1);
    }
  }

  const dbSet = new Set(dbSymbols);
  const resolveSnapshotSymbol = (s) =>
    dbSet.has(s) ? s : dbSet.has(`${s}.NS`) ? `${s}.NS` : null;

  const snapRows = db
    .prepare("SELECT symbol, score, as_of FROM signal_snapshots WHERE strategy_id = ? ORDER BY as_of ASC")
    .all(args.strategyId);
  const snapshotRows = [];
  for (const r of snapRows) {
    if (r.score === null || !Number.isFinite(r.score)) continue;
    const sym = resolveSnapshotSymbol(r.symbol);
    if (sym && universe.includes(sym)) snapshotRows.push({ symbol: sym, score: r.score, as_of: r.as_of });
  }
  const scorer = new SnapshotScorer(snapshotRows);

  const config = {
    topN: args.top,
    rebalance: "monthly",
    startDate: args.start,
    endDate: args.end ?? undefined,
    costPct: args.cost / 100,
    slippagePct: args.slippage / 100,
  };

  console.log(`strategy=${args.strategyId} universe=${args.universe} (${universe.length} symbols with candles)`);
  console.log(`snapshots loaded=${snapshotRows.length}  top=${args.top}  window=${args.start}..${args.end ?? "max"}`);
  console.log(`cost=${args.cost}% + slippage=${args.slippage}% one-way  rf=${RF_ANNUAL * 100}% annual\n`);

  const t0 = Date.now();
  const result = await runBacktest(candlesBySymbol, scorer, config);
  console.log(`engine: ${result.equity.length} trading days, ${result.rebalanceDates.length} rebalances, ${Date.now() - t0}ms`);

  /* fidelity guard (TASK-10): a flat-at-1 equity curve means the scorer never
     produced a portfolio for this window — typically snapshot history thinner
     than the window. Say so loudly instead of printing a meaningless table. */
  const formed = result.trades.filter((t) => t.added.length > 0 || t.held.length > 0).length;
  if (formed === 0 && result.rebalanceDates.length > 0) {
    console.warn(
      `\nWARNING: no portfolio was ever formed — strategy stayed in cash for the whole window.\n` +
        `snapshot coverage: ${new Set(snapshotRows.map((r) => r.as_of)).size} distinct as_of dates vs ` +
        `${result.rebalanceDates.length} rebalances. Backtests need monthly signal history\n` +
        `(run signals:run on a schedule) before metrics are meaningful.`
    );
  }

  const m = computeMetrics({
    equity: result.equity,
    totalTurnover: result.totalTurnover,
    investedDays: result.investedDays,
  });
  const bench = computeSeriesMetrics(result.equity.map((e) => ({ date: e.date, value: e.bench })));

  console.log("\nMETRICS");
  console.log("  metric        strategy     benchmark");
  console.log(`  CAGR          ${fmtPct(m.cagr).padStart(10)}  ${fmtPct(bench.cagr).padStart(10)}`);
  console.log(`  Ann. vol      ${fmtPct(m.annualizedVol).padStart(10)}  ${fmtPct(bench.annualizedVol).padStart(10)}`);
  console.log(`  Sharpe        ${fmtNum(m.sharpe).padStart(10)}  ${fmtNum(bench.sharpe).padStart(10)}`);
  console.log(`  Sortino       ${fmtNum(m.sortino).padStart(10)}  ${fmtNum(bench.sortino).padStart(10)}`);
  console.log(`  Max drawdown  ${fmtPct(m.maxDrawdown ? -m.maxDrawdown : 0).padStart(10)}  ${fmtPct(bench.maxDrawdown ? -bench.maxDrawdown : 0).padStart(10)}`);
  if (m.maxDrawdownPeakDate) {
    console.log(`    peak ${m.maxDrawdownPeakDate} -> trough ${m.maxDrawdownTroughDate}`);
  }
  console.log(`  Hit rate      ${fmtPct(m.hitRate).padStart(10)}  ${fmtPct(bench.hitRate).padStart(10)}`);
  console.log(`  Total return  ${fmtPct(m.totalReturn).padStart(10)}  ${fmtPct(bench.totalReturn).padStart(10)}`);
  console.log(`  Turnover/yr   ${fmtPct(m.annualizedTurnover).padStart(10)}  -`);
  console.log(`  Exposure      ${fmtPct(m.exposure).padStart(10)}  100.00%`);
  console.log(`  Years / days  ${fmtNum(m.years, 2).padStart(10)}  ${fmtNum(bench.years, 2).padStart(10)}`);

  console.log("\nTRADES");
  console.log(`  ${result.trades.length} rebalances, gross turnover ${fmtPct(result.totalTurnover)} total, cost paid ${fmtPct(result.totalTurnover * (config.costPct + config.slippagePct))}`);
  const lastTrade = result.trades[result.trades.length - 1];
  if (lastTrade) {
    console.log(`  last rebalance ${lastTrade.date}: +${lastTrade.added.join(",") || "—"} -${lastTrade.removed.join(",") || "—"} held ${lastTrade.held.length}`);
  }

  console.log("\nEQUITY CURVE");
  printEquityHeadTail(result.equity);

  const now = Math.floor(Date.now() / 1000);
  const runId = crypto.randomUUID();
  const metricsJson = JSON.stringify({
    strategy: m,
    benchmark: bench,
    rfAnnual: RF_ANNUAL,
    config: result.config,
  });
  db.prepare(
    "INSERT INTO backtest_runs (id, strategy_id, config_json, status, metrics_json, equity_json, created_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(runId, args.strategyId, JSON.stringify(result.config), "completed", metricsJson, JSON.stringify(result.equity), now, now);
  console.log(`\nrun persisted: backtest_runs.id=${runId} status=completed`);
} catch (err) {
  console.error(`backtest failed: ${err.message}`);
  process.exit(1);
} finally {
  db.close();
}
