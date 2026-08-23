import { NextResponse } from "next/server";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

/* /api/fundamentals?symbol=RELIANCE — T49. Normalized fundamental metrics for
 * one symbol from the fundamentals table (metrics_json written by
 * scripts/ingest-fundamentals.mjs, Yahoo quoteSummary v10).
 *
 * Response: { metrics: {...} | null, meta: { as_of: string | null, source: string | null } }
 * Margins are derived here (not stored): gross/op/net over totalRevenue.
 * Freshness rides the X-Fetched-At response header (ISO) so clients can show
 * an as-of stamp without parsing the body.
 * Empty table / unknown symbol → metrics:null with 200 (UI renders empty state).
 */

export const dynamic = "force-dynamic";

const require = createRequire(import.meta.url);

const DB_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../db/data/app.db"
);

interface MetricsRow {
  metrics_json: string;
  fetched_at: number;
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function margin(part: unknown, revenue: unknown): number | null {
  const p = numOrNull(part);
  const r = numOrNull(revenue);
  if (p === null || r === null || r === 0) return null;
  return p / r;
}

// one readonly handle per process (TASK-56)
let cachedDb: {
  prepare(sql: string): { get(...args: string[]): MetricsRow | undefined };
} | null = null;

function readFundamentals(symbol: string) {
  try {
    if (!cachedDb) {
      const Database = require("better-sqlite3") as unknown as {
        new (path: string, opts: { readonly: true }): {
          prepare(sql: string): { get(...args: string[]): MetricsRow | undefined };
        };
      };
      cachedDb = new Database(DB_PATH, { readonly: true });
    }
    const db = cachedDb;
    const row = db
      .prepare("SELECT metrics_json, fetched_at FROM fundamentals WHERE symbol = ?")
      .get(symbol.toUpperCase());
    if (!row) return null;
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(row.metrics_json);
    } catch {
      return null;
    }
    return { raw, fetchedAt: row.fetched_at };
  } catch {
    return null;
  }
}

function normalize(raw: Record<string, unknown>) {
  return {
    trailingPe: numOrNull(raw.trailingPE),
    forwardPe: numOrNull(raw.forwardPE),
    priceToBook: numOrNull(raw.priceToBook),
    priceToSales: numOrNull(raw.priceToSales),
    dividendYield: numOrNull(raw.dividendYield),
    earningsYield: numOrNull(raw.earningsYield),
    returnOnEquity: numOrNull(raw.returnOnEquity),
    returnOnAssets: numOrNull(raw.returnOnAssets),
    debtToEquity: numOrNull(raw.debtToEquity),
    currentRatio: numOrNull(raw.currentRatio),
    grossMargin: margin(raw.grossProfit, raw.totalRevenue),
    operatingMargin: margin(raw.operatingIncome, raw.totalRevenue),
    netMargin: margin(raw.netIncome, raw.totalRevenue),
    sector: typeof raw.sector === "string" ? raw.sector : null,
    industry: typeof raw.industry === "string" ? raw.industry : null,
    marketCap: numOrNull(raw.marketCap),
  };
}

export function GET(request: Request) {
  const url = new URL(request.url);
  const symbol = (url.searchParams.get("symbol") ?? "").trim().replace(/\.(NS|BO)$/i, "");

  const emptyHeaders = { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" };

  if (!symbol) {
    return NextResponse.json(
      { metrics: null, meta: { as_of: null, source: null } },
      { headers: emptyHeaders },
    );
  }

  const found = readFundamentals(symbol);
  if (!found) {
    return NextResponse.json(
      { metrics: null, meta: { as_of: null, source: null } },
      { headers: emptyHeaders },
    );
  }

  const body = {
    metrics: normalize(found.raw),
    meta: {
      as_of: new Date(found.fetchedAt * 1000).toISOString(),
      source: "yahoo",
    },
  };

  return NextResponse.json(body, {
    headers: {
      ...emptyHeaders,
      "X-Fetched-At": body.meta.as_of ?? "",
    },
  });
}
