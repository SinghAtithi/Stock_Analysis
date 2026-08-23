import { NextResponse } from "next/server";
import path from "node:path";
import { getTicker } from "@/lib/marketData";
import { evaluatePass } from "@/lib/alerts";

/* /api/alerts/evaluate — one evaluation pass (ROADMAP T25).
 * Loads active alerts, prices them from the cached NIFTY50 tape
 * (getTicker is SWR-cached in-process → zero upstream stampede), and marks
 * crosses as fired. Alerts for symbols outside the tape stay pending —
 * documented v1 limitation; custom-symbol evaluation needs the budgeted
 * fallback path and lands with the notifier UI. */

export const dynamic = "force-dynamic";

interface DbLike {
  prepare(sql: string): {
    get(...args: unknown[]): unknown;
    all(...args: unknown[]): unknown[];
    run(...args: unknown[]): unknown;
  };
  close(): void;
}

/* cwd-anchored: chunk depth differs between dev/build (see alerts route) */
const DB_PATH = path.join(process.cwd(), "..", "db", "data", "app.db");

function openDb(write: boolean): DbLike | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- native module, must not be bundled
    const Database = require("better-sqlite3") as unknown as new (
      dbPath: string,
      opts?: { readonly?: boolean; fileMustExist?: boolean }
    ) => DbLike;
    return new Database(DB_PATH, write ? {} : { readonly: true });
  } catch (e: unknown) {
    console.error("[api/alerts] sqlite open failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

interface AlertRow {
  id: string;
  device_id: string;
  type: string;
  payload_json: string;
}

export async function GET() {
  const db = openDb(false);
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });
  let rows: AlertRow[];
  try {
    rows = db
      .prepare(`SELECT id, device_id, type, payload_json FROM alerts WHERE active = 1 LIMIT 500`)
      .all() as AlertRow[];
  } finally {
    db.close();
  }
  if (rows.length === 0) {
    return NextResponse.json({ evaluated: 0, fired: [] });
  }

  const tape = await getTicker();
  const priceBySymbol = new Map(
    tape.flatMap((t) => (t.price == null ? [] : [[t.symbol.toUpperCase(), t.price] as const]))
  );

  const fired = evaluatePass(rows, priceBySymbol, Math.floor(Date.now() / 1000));

  const wdb = openDb(true);
  if (!wdb) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });
  try {
    for (const f of fired) {
      wdb.prepare(`UPDATE alerts SET active = 0, fired_at = ? WHERE id = ? AND active = 1`).run(f.firedAt, f.id);
    }
  } finally {
    wdb.close();
  }

  return NextResponse.json({ evaluated: rows.length, fired });
}
