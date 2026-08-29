import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { retryAfterSec, takeToken } from "@/lib/upstreamGuards";
import { clientKeyFrom } from "@/lib/clientKey";
import {
  groupBySymbol,
  shapeItem,
  SmartMoneyItem,
  SmartMoneyMeta,
  STALE_AFTER_MS,
} from "@/lib/smartMoney";

/* /api/smart-money — smart-money radar feed (TASK-1415).
 * GET → { groups, meta }: rows grouped by symbol with buyer/seller, qty,
 * value and the jury strategy tag (S113/S122/S107 — see lib/smartMoney.ts).
 * Data is written daily by scripts/ingest-smart-money.mjs; this route only
 * reads. meta.blocked is true when the source reported a hard refusal, so
 * the UI can show the honest "source blocked/offline" empty state. */

export const dynamic = "force-dynamic";

interface DbLike {
  prepare(sql: string): {
    get(...args: unknown[]): unknown;
    all(...args: unknown[]): unknown[];
  };
  close(): void;
}

const DB_PATH = path.join(process.cwd(), "..", "db", "data", "app.db");

function openDb(): DbLike | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- native module, must not be bundled
    const Database = require("better-sqlite3") as unknown as new (
      dbPath: string,
      opts?: { readonly?: boolean; fileMustExist?: boolean }
    ) => DbLike;
    return new Database(DB_PATH, { readonly: true, fileMustExist: true });
  } catch (e: unknown) {
    console.error("[api/smart-money] sqlite open failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

interface FeedRow {
  id: string;
  kind: string;
  symbol: string;
  security_name: string | null;
  client: string | null;
  buy_sell: string | null;
  qty: number | null;
  price: number | null;
  value: number | null;
  trade_date: string;
  source: string;
  raw_json: string | null;
}

export async function GET(request: NextRequest) {
  if (!takeToken(`smart-money:${clientKeyFrom(request.headers)}`)) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(retryAfterSec()) } }
    );
  }

  const db = openDb();
  if (!db) {
    /* DB-less deployments degrade to an honest empty state */
    return NextResponse.json({
      groups: [],
      meta: { sources: [], asOf: null, stale: false, blocked: false, healthyEmpty: true },
    });
  }
  try {
    const rows = db
      .prepare(
        `SELECT id, kind, symbol, security_name, client, buy_sell, qty, price, value,
                trade_date, source, raw_json
         FROM smart_money_feed
         WHERE trade_date >= date('now', '-14 days')
         ORDER BY trade_date DESC, symbol`
      )
      .all() as FeedRow[];

    const items = rows
      .map((r) => {
        let desc: string | null = null;
        try {
          desc = (JSON.parse(r.raw_json as string) as { desc?: string }).desc ?? null;
        } catch {
          /* raw_json is best-effort; null desc is fine */
        }
        return shapeItem({ ...r, desc });
      })
      .filter((i): i is SmartMoneyItem => i !== null);

    const ingested = db
      .prepare(`SELECT COALESCE(MAX(ingested_at), 0) AS as_of FROM smart_money_feed`)
      .get() as { as_of: number };

    const statusRows = db
      .prepare(
        `SELECT source, ok, error, fetched_at, detail_json
         FROM smart_money_status
         ORDER BY fetched_at DESC LIMIT 20`
      )
      .all() as {
      source: string;
      ok: number;
      error: string | null;
      fetched_at: number;
      detail_json: string | null;
    }[];

    const sources = [...new Set(statusRows.map((s) => s.source))];
    const blocked = statusRows.some((s) => {
      if (s.ok === 1) return false;
      try {
        return (JSON.parse(s.detail_json ?? "") as { blocked?: boolean }).blocked === true;
      } catch {
        return false;
      }
    });
    const healthyEmpty = items.length === 0 && !blocked;
    const asOf = ingested.as_of > 0 ? ingested.as_of * 1000 : null;
    const stale = asOf != null && Date.now() - asOf > STALE_AFTER_MS;
    const meta: SmartMoneyMeta = { sources, asOf, stale, blocked, healthyEmpty };

    return NextResponse.json(
      { groups: groupBySymbol(items), meta },
      {
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
        },
      }
    );
  } finally {
    db.close();
  }
}