import { NextResponse } from "next/server";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { listStrategies } from "@/lib/strategies/registry";
import { findInstrument } from "@/lib/instruments";

/* /api/signals — T21. Latest signal_snapshots for a strategy, joined with the
 * local instrument index (name/sector/indices) and the quotes table (price,
 * change_pct, LEFT — null when absent). Strategy ids validated against the
 * registry; sector matches the instruments.json `sec` field.
 * 60s module-level cache (Map keyed by query string).
 * DB access: scripts/lib/db.mjs's dynamic driver detection cannot survive
 * Turbopack bundling (build-time evaluation of import.meta.url-derived paths
 * bakes in 'undefined/...'), so the same read-only access is inlined here —
 * static require("better-sqlite3") resolves from web/node_modules (verified). */

export const dynamic = "force-dynamic";

const require = createRequire(import.meta.url);

interface SnapshotRow {
  symbol: string;
  score: number | null;
  rank: number;
  components_json: string | null;
  as_of: number;
}

interface QuoteRow {
  symbol: string;
  price: number | null;
  change_pct: number | null;
}

interface DbLike {
  prepare(sql: string): { get(...args: unknown[]): unknown; all(...args: unknown[]): unknown[] };
  close(): void;
}

const DB_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../db/data/app.db"
);

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; body: { status: number; body: unknown } }>();

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const SORTS = new Set(["score", "rank", "symbol"]);

interface Params {
  strategy: string;
  limit: number;
  offset: number;
  sector: string | null;
  sort: string;
  order: "asc" | "desc";
}

function parseIntParam(raw: string | null, fallback: number): number {
  if (raw === null) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function buildParams(url: URL): Params | { error: string; status: number } {
  const strategy = url.searchParams.get("strategy") ?? "";
  if (!strategy) {
    return { error: "missing_strategy", status: 400 };
  }
  const sort = url.searchParams.get("sort") ?? "rank";
  if (!SORTS.has(sort)) {
    return { error: "unknown_sort", status: 400 };
  }
  const orderRaw = url.searchParams.get("order") ?? "";
  const order: "asc" | "desc" =
    orderRaw === "desc" || orderRaw === "asc"
      ? orderRaw
      : sort === "score"
        ? "desc"
        : "asc";
  return {
    strategy,
    limit: Math.min(
      MAX_LIMIT,
      Math.max(1, parseIntParam(url.searchParams.get("limit"), DEFAULT_LIMIT))
    ),
    offset: Math.max(0, parseIntParam(url.searchParams.get("offset"), 0)),
    sector: url.searchParams.get("sector"),
    sort,
    order,
  };
}

function openReadOnly(): DbLike {
  const Database = require("better-sqlite3") as unknown as new (
    dbPath: string,
    opts: { readonly: true }
  ) => DbLike;
  return new Database(DB_PATH, { readonly: true });
}

function readSnapshots(strategyId: string): { rows: SnapshotRow[]; asOf: number | null } {
  const db = openReadOnly();
  try {
    const asOfRow = db
      .prepare("SELECT MAX(as_of) AS as_of FROM signal_snapshots WHERE strategy_id = ?")
      .get(strategyId) as { as_of: number | null };
    if (asOfRow.as_of === null) return { rows: [], asOf: null };
    const rows = db
      .prepare(
        "SELECT symbol, score, rank, components_json, as_of FROM signal_snapshots WHERE strategy_id = ? AND as_of = ?"
      )
      .all(strategyId, asOfRow.as_of) as SnapshotRow[];
    return { rows, asOf: asOfRow.as_of };
  } finally {
    db.close();
  }
}

function readQuotes(symbols: string[]): Map<string, QuoteRow> {
  const out = new Map<string, QuoteRow>();
  if (symbols.length === 0) return out;
  const db = openReadOnly();
  try {
    const placeholders = symbols.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT symbol, price, change_pct FROM quotes WHERE symbol IN (${placeholders})`
      )
      .all(...symbols) as QuoteRow[];
    for (const r of rows) out.set(r.symbol, r);
  } finally {
    db.close();
  }
  return out;
}

function buildBody(params: Params): { status: number; body: unknown } {
  const strategyMeta = listStrategies().find((s) => s.meta.id === params.strategy);
  if (!strategyMeta) {
    return {
      status: 400,
      body: { error: "unknown_strategy", strategy: params.strategy },
    };
  }

  const { rows, asOf } = readSnapshots(params.strategy);
  const quotes = readQuotes(rows.map((r) => r.symbol));

  const items = rows
    .map((row) => {
      const inst = findInstrument(row.symbol);
      let components: Record<string, unknown> | null = null;
      if (row.components_json) {
        try {
          components = JSON.parse(row.components_json);
        } catch {
          components = null;
        }
      }
      const quote = quotes.get(row.symbol);
      return {
        rank: row.rank,
        symbol: row.symbol,
        name: inst?.n ?? row.symbol,
        sector: inst?.sec ?? null,
        indices: inst?.idx ?? [],
        score: row.score ?? null,
        components,
        price: quote?.price ?? null,
        changePct: quote?.change_pct ?? null,
      };
    })
    .filter((item) => {
      if (!params.sector) return true;
      return (item.sector ?? "").toUpperCase() === params.sector.toUpperCase();
    });

  items.sort((a, b) => {
    let cmp: number;
    if (params.sort === "rank") cmp = a.rank - b.rank;
    else if (params.sort === "score")
      cmp = (a.score ?? -Infinity) - (b.score ?? -Infinity);
    else cmp = a.symbol.localeCompare(b.symbol);
    return params.order === "desc" ? -cmp : cmp;
  });

  const page = items.slice(params.offset, params.offset + params.limit);

  return {
    status: 200,
    body: {
      strategy: {
        id: strategyMeta.meta.id,
        name: strategyMeta.meta.name,
        juryRank: strategyMeta.meta.juryRank,
        edgeScore: strategyMeta.meta.edgeScore,
        asOf,
      },
      meta: { count: page.length, universe: "nifty50" },
      items: page,
    },
  };
}

export function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = buildParams(url);
  if ("error" in parsed) {
    return NextResponse.json(
      { error: parsed.error, strategy: url.searchParams.get("strategy") ?? null },
      { status: parsed.status }
    );
  }
  const key = url.search;
  const now = Date.now();
  const hit = cache.get(key);
  if (!hit || now - hit.at > CACHE_TTL_MS) {
    cache.set(key, { at: now, body: buildBody(parsed) });
  }
  const { status, body } = cache.get(key)!.body;
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" },
  });
}
