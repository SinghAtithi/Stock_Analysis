import { NextResponse } from "next/server";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

/* /api/corporate-actions?symbol=RELIANCE.NS — T58. Corporate-action history
 * for one symbol from the corporate_actions table (written by
 * scripts/fetch-corporate-actions.mjs; symbols stored exchange-suffixed).
 *
 * Response: { items: [{ ts, type, ratio, subject }] } newest-first.
 * ratio is rupees/share for dividends, a factor for splits/bonuses.
 * Empty table / unknown symbol → items:[] with 200 (UI renders empty state).
 */

export const dynamic = "force-dynamic";

const require = createRequire(import.meta.url);

const DB_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../db/data/app.db"
);

interface ActionRow {
  ts: number;
  type: string;
  payload_json: string | null;
}

// one readonly handle per process (TASK-56)
let cachedDb: {
  prepare(sql: string): { all(...args: string[]): unknown[] };
} | null = null;

function readActions(symbol: string): ActionRow[] {
  try {
    if (!cachedDb) {
      const Database = require("better-sqlite3") as unknown as {
        new (path: string, opts: { readonly: true }): {
          prepare(sql: string): { all(...args: unknown[]): unknown[] };
        };
      };
      cachedDb = new Database(DB_PATH, { readonly: true });
    }
    const db = cachedDb;
    return db
      .prepare(
        `SELECT ts, type, payload_json FROM corporate_actions
         WHERE symbol = ? OR symbol = ?
         ORDER BY ts DESC LIMIT 100`
      )
      .all(symbol.toUpperCase(), `${symbol.toUpperCase()}.NS`) as ActionRow[];
  } catch {
    return [];
  }
}

export function GET(request: Request) {
  const url = new URL(request.url);
  const symbol = (url.searchParams.get("symbol") ?? "").trim().toUpperCase();

  if (!symbol) {
    return NextResponse.json(
      { items: [] },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } }
    );
  }

  const items = readActions(symbol).map((row) => {
    let subject: string | null = null;
    let ratio: number | null = null;
    try {
      const raw = row.payload_json ? JSON.parse(row.payload_json) : null;
      ratio = Number.isFinite(Number(raw?.ratio)) ? Number(raw.ratio) : null;
      subject = typeof raw?.raw?.subject === "string" ? raw.raw.subject : null;
    } catch {
      // payload_json is best-effort decoration
    }
    return { ts: row.ts, type: row.type, ratio, subject };
  });

  return NextResponse.json(
    { items },
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } }
  );
}
