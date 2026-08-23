import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listStrategies } from "@/lib/strategies/registry";
import {
  runBacktest,
  SnapshotScorer,
  DEFAULT_COST_PCT,
  DEFAULT_SLIPPAGE_PCT,
} from "@/lib/backtest/engine";
import type { Candle } from "@/lib/types";
import instruments from "@/data/instruments.json" with { type: "json" };

/* /api/backtest — submit and read backtest runs (TASK-28).
 * GET                → recent runs (history list)
 * GET ?id=<runId>    → single run incl. equity curve
 * POST               → validate config, run the engine inline (~seconds),
 *                      persist to backtest_runs, return {id}.
 * Inline execution is deliberate: runs take seconds on the NIFTY-50 daily
 * store, and node-server background tasks after a response are not
 * guaranteed across hosts. status still models pending→completed. */

export const dynamic = "force-dynamic";

interface DbLike {
  prepare(sql: string): { get(...args: unknown[]): unknown; all(...args: unknown[]): unknown[]; run(...args: unknown[]): unknown };
  close(): void;
}

const DB_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../db/data/app.db"
);

const UNIVERSES = new Set(["nifty50", "nifty500"]);

interface RunRow {
  id: string;
  strategy_id: string;
  status: string;
  created_at: number | null;
  finished_at: number | null;
  config_json: string;
  metrics_json: string | null;
}

function openDb(write: boolean): DbLike | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- native module, must not be bundled
    const Database = require("better-sqlite3") as unknown as new (
      dbPath: string,
      opts?: { readonly?: boolean; fileMustExist?: boolean }
    ) => DbLike;
    return new Database(DB_PATH, write ? {} : { readonly: true });
  } catch (e: unknown) {
    console.error("[api/backtest] sqlite open failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

function listRuns() {
  const db = openDb(false);
  if (!db) return [];
  try {
    const rows = db
      .prepare(
        `SELECT id, strategy_id, status, created_at, finished_at, config_json, metrics_json
         FROM backtest_runs ORDER BY created_at DESC LIMIT 50`
      )
      .all() as RunRow[];
    return rows.map((r) => ({
      id: r.id,
      strategyId: r.strategy_id,
      status: r.status,
      createdAt: r.created_at,
      finishedAt: r.finished_at,
      config: safeParse(r.config_json),
      metrics: safeParse(r.metrics_json ?? "{}"),
    }));
  } finally {
    db.close();
  }
}

function getRun(id: string) {
  const db = openDb(false);
  if (!db) return null;
  try {
    const r = db
      .prepare(
        `SELECT id, strategy_id, status, created_at, finished_at, config_json, metrics_json, equity_json
         FROM backtest_runs WHERE id = ?`
      )
      .get(id) as (RunRow & { equity_json: string | null }) | undefined;
    if (!r) return null;
    return {
      id: r.id,
      strategyId: r.strategy_id,
      status: r.status,
      createdAt: r.created_at,
      finishedAt: r.finished_at,
      config: safeParse(r.config_json),
      metrics: safeParse(r.metrics_json ?? "{}"),
      equity: safeParse(r.equity_json ?? "[]"),
    };
  } finally {
    db.close();
  }
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function loadCandles(symbols: Set<string>): Map<string, Candle[]> {
  const db = openDb(false);
  const out = new Map<string, Candle[]>();
  if (!db) return out;
  try {
    const rows = db
      .prepare(`SELECT symbol, ts, o, h, l, c, v FROM eod_candles ORDER BY symbol, ts ASC`)
      .all() as { symbol: string; ts: number; o: number; h: number; l: number; c: number; v: number }[];
    /* eod_candles may store bare or exchange-qualified symbols ("RELIANCE"
       vs "RELIANCE.NS") — accept either form (same convention as the CLI) */
    const qualified = new Set<string>();
    for (const s of symbols) {
      qualified.add(s);
      qualified.add(`${s}.NS`);
    }
    for (const r of rows) {
      if (!qualified.has(r.symbol)) continue;
      let arr = out.get(r.symbol);
      if (!arr) out.set(r.symbol, (arr = []));
      arr.push({ time: r.ts, open: r.o, high: r.h, low: r.l, close: r.c, volume: r.v });
    }
  } finally {
    db.close();
  }
  return out;
}

function snapshotScorer(strategyId: string): SnapshotScorer | null {
  const db = openDb(false);
  if (!db) return null;
  try {
    const rows = db
      .prepare(`SELECT symbol, score, as_of FROM signal_snapshots WHERE strategy_id = ?`)
      .all(strategyId) as { symbol: string; score: number; as_of: number }[];
    return new SnapshotScorer(rows);
  } finally {
    db.close();
  }
}

function universeSymbols(universe: string): Set<string> {
  const key = universe === "nifty500" ? "NIFTY 500" : "NIFTY 50";
  const list = instruments as { s: string; idx?: string[] }[];
  return new Set(list.filter((i) => i.idx?.includes(key)).map((i) => i.s));
}

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (id) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) {
      return NextResponse.json({ error: "invalid_id" }, { status: 400 });
    }
    const run = getRun(id);
    if (!run) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json(run);
  }
  return NextResponse.json({ runs: listRuns() });
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const strategyId = String(body.strategyId ?? "");
  const strategy = listStrategies().find((s) => s.meta.id === strategyId);
  if (!strategy) {
    return NextResponse.json({ error: "unknown_strategy" }, { status: 400 });
  }

  const universe = String(body.universe ?? "nifty50");
  if (!UNIVERSES.has(universe)) {
    return NextResponse.json({ error: "invalid_universe" }, { status: 400 });
  }

  const start = String(body.start ?? "");
  const end = body.end === undefined || body.end === null || body.end === "" ? undefined : String(body.end);
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRe.test(start) || (end !== undefined && !dateRe.test(end))) {
    return NextResponse.json({ error: "invalid_dates" }, { status: 400 });
  }
  if (end && end < start) {
    return NextResponse.json({ error: "invalid_range" }, { status: 400 });
  }

  const topN = clampInt(body.top, 1, 50, 10);
  /* cost/slippage arrive in percent (0.05 = 5 bps), engine wants fractions */
  const costPct = clampNum(body.cost, 0, 1, DEFAULT_COST_PCT * 100) / 100;
  const slippagePct = clampNum(body.slippage, 0, 1, DEFAULT_SLIPPAGE_PCT * 100) / 100;

  const scorer = snapshotScorer(strategyId);
  if (!scorer) {
    return NextResponse.json({ error: "db_unavailable" }, { status: 503 });
  }

  const symbols = universeSymbols(universe);
  const rawCandles = loadCandles(symbols);
  /* snapshots score bare symbols; align candle keys to the same space */
  const candlesBySymbol = new Map<string, Candle[]>();
  for (const [sym, arr] of rawCandles) {
    candlesBySymbol.set(sym.replace(/\.NS$/, ""), arr);
  }
  if (candlesBySymbol.size === 0) {
    return NextResponse.json({ error: "no_candles" }, { status: 409 });
  }

  const result = await runBacktest(candlesBySymbol, scorer, {
    topN,
    rebalance: "monthly",
    startDate: start,
    endDate: end,
    costPct,
    slippagePct,
  });

  const { createHash } = await import("node:crypto");
  const id = createHash("sha256")
    .update(`${strategyId}|${universe}|${start}|${end ?? ""}|${topN}|${costPct}|${slippagePct}|${Date.now()}`)
    .digest("hex")
    .slice(0, 24);

  const now = Math.floor(Date.now() / 1000);
  const db = openDb(true);
  if (db) {
    try {
      db.prepare(
        `INSERT INTO backtest_runs (id, strategy_id, config_json, status, metrics_json, equity_json, created_at, finished_at)
         VALUES (?, ?, ?, 'completed', ?, ?, ?, ?)`
      ).run(
        id,
        strategyId,
        JSON.stringify({ topN, rebalance: "monthly", startDate: start, endDate: end ?? result.config.endDate, universe, costPct, slippagePct }),
        JSON.stringify({
          cagr: metricsOf(result.equity).cagr,
          totalTurnover: result.totalTurnover,
          investedDays: result.investedDays,
          rebalances: result.rebalanceDates.length,
        }),
        JSON.stringify(result.equity),
        now,
        now
      );
    } catch (e: unknown) {
      console.error("[api/backtest] persist failed:", e instanceof Error ? e.message : e);
    } finally {
      db.close();
    }
  }

  return NextResponse.json({
    id,
    status: "completed",
    config: { strategyId, universe, topN, startDate: start, endDate: end ?? result.config.endDate },
    totalTurnover: result.totalTurnover,
    investedDays: result.investedDays,
    rebalanceDates: result.rebalanceDates.length,
    equity: result.equity,
    warning:
      result.trades.every((t) => t.added.length === 0 && t.held.length === 0)
        ? "No portfolio was ever formed — signal snapshot history is thinner than this window."
        : undefined,
  });
}

function clampInt(v: unknown, min: number, max: number, dflt: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function clampNum(v: unknown, min: number, max: number, dflt: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}

/** Minimal cumulative-return CAGR for the persisted metrics summary. */
function metricsOf(equity: { date: string; strat: number }[]): { cagr: number | null } {
  if (equity.length < 2) return { cagr: null };
  const first = new Date(`${equity[0].date}T00:00:00Z`).getTime();
  const last = new Date(`${equity[equity.length - 1].date}T00:00:00Z`).getTime();
  const years = (last - first) / (365.25 * 86_400_000);
  const total = equity[equity.length - 1].strat / equity[0].strat;
  if (years <= 0 || total <= 0) return { cagr: null };
  return { cagr: Math.pow(total, 1 / years) - 1 };
}
