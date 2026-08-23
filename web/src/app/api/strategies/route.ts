import { NextResponse } from "next/server";
import path from "node:path";
import { listStrategies } from "@/lib/strategies/registry";

/* /api/strategies — curated registry view for the screener picker.
   Returns id/name/category/juryRank/edgeScore/universe for every registered
   strategy, ordered by jury rank (unranked last), plus each strategy's latest
   completed backtest evidence (TASK-61) in one grouped query. 60s cache. */

export const dynamic = "force-dynamic";

interface DbLike {
  prepare(sql: string): { all(...args: unknown[]): unknown[] };
  close(): void;
}

const DB_PATH = path.join(process.cwd(), "..", "db", "data", "app.db");

function openReadOnly(): DbLike | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- native module, must not be bundled
    const Database = require("better-sqlite3") as unknown as new (
      dbPath: string,
      opts?: { readonly?: boolean }
    ) => DbLike;
    return new Database(DB_PATH, { readonly: true });
  } catch {
    return null; // no DB yet (fresh checkout) — evidence stays null
  }
}

interface MetricsShape {
  cagr?: number | null;
  sharpe?: number | null;
  maxDrawdown?: number | null;
  strategy?: MetricsShape;
}

/** Latest completed run per strategy, single grouped query. */
function latestBacktests(): Map<string, { id: string; finishedAt: number | null; metrics: MetricsShape }> {
  const out = new Map<
    string,
    { id: string; finishedAt: number | null; metrics: MetricsShape }
  >();
  const db = openReadOnly();
  if (!db) return out;
  try {
    const rows = db
      .prepare(
        `SELECT r.strategy_id AS strategyId, r.id, r.finished_at AS finishedAt, r.metrics_json AS metricsJson
         FROM backtest_runs r
         JOIN (
           SELECT strategy_id, MAX(created_at) AS mc
           FROM backtest_runs WHERE status = 'completed' GROUP BY strategy_id
         ) latest ON latest.strategy_id = r.strategy_id AND latest.mc = r.created_at
         WHERE r.status = 'completed'`
      )
      .all() as { strategyId: string; id: string; finishedAt: number | null; metricsJson: string }[];
    for (const row of rows) {
      let parsed: MetricsShape | null = null;
      try {
        parsed = JSON.parse(row.metricsJson) as MetricsShape;
      } catch {
        continue;
      }
      // CLI writes {strategy:{...}}; the API writer flattens — accept both
      const metrics = parsed?.strategy ?? parsed ?? {};
      out.set(row.strategyId, { id: row.id, finishedAt: row.finishedAt, metrics });
    }
  } finally {
    db.close();
  }
  return out;
}

let cacheAt = 0;
let cacheBody: unknown = null;

export function GET() {
  const now = Date.now();
  if (!cacheBody || now - cacheAt > 60_000) {
    const runs = latestBacktests();
    const all = listStrategies().map((s) => {
      const run = runs.get(s.meta.id);
      return {
        id: s.meta.id,
        name: s.meta.name,
        category: s.meta.category,
        juryRank: s.meta.juryRank,
        edgeScore: s.meta.edgeScore,
        universe: s.meta.universe,
        inputs: s.meta.inputs,
        backtest: run
          ? {
              id: run.id,
              finishedAt: run.finishedAt,
              cagr: run.metrics.cagr ?? null,
              sharpe: run.metrics.sharpe ?? null,
              maxDrawdown: run.metrics.maxDrawdown ?? null,
            }
          : null,
      };
    });
    all.sort(
      (a, b) =>
        (a.juryRank ?? Number.MAX_SAFE_INTEGER) -
        (b.juryRank ?? Number.MAX_SAFE_INTEGER)
    );
    cacheBody = { strategies: all, count: all.length };
    cacheAt = now;
  }
  return NextResponse.json(cacheBody, {
    headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" },
  });
}
