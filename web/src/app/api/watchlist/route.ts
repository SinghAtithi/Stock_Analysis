import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { findInstrumentListing } from "@/lib/instruments";

/* /api/watchlist — OPTIONAL cloud mirror of the localStorage watchlist
   (TASK-62). localStorage stays the source of truth; this only mirrors.
 * GET  ?deviceId=...           → { entries, updatedAt } for the device
 * PUT  {deviceId, symbols:[…]} → replace-set (index-validated, capped 100)
 * Rows live in the `watchlists` table as id="device:<id>", scope="device".
 * Auth (TASK-63) will claim these rows by device id and migrate scope to a
 * user account with the same union rule. */

export const dynamic = "force-dynamic";

interface DbLike {
  prepare(sql: string): {
    get(...args: unknown[]): unknown;
    all(...args: unknown[]): unknown[];
    run(...args: unknown[]): unknown;
  };
  close(): void;
}

/* `next start` runs from web/ — cwd-anchored paths survive per-route chunk
   layouts (import.meta.url depth differs between dev/build/chunking). */
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
    console.error("[api/watchlist] sqlite open failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

const DEVICE_RE = /^[a-zA-Z0-9_-]{8,64}$/;
const MAX_SYMBOLS = 100;
const IS_INDEX_RE = /(NIFTY|SENSEX|INDIA VIX|BANKNIFTY|FINNIFTY|MIDCAP|SME|INDIA 10)/;

interface MirrorEntry {
  symbol: string;
  exchange: string;
  name: string;
  shortName: string;
  type: string;
  sector: string;
}

const rowKey = (e: MirrorEntry): string => `${e.exchange}|${e.symbol}`;

/* Validate client entries against the instruments index. Unknown symbols are
   dropped; dual-listed symbols are pinned to their exact exchange listing.
   Returns null when `input` itself is malformed (caller → 400). */
function sanitizeEntries(input: unknown): MirrorEntry[] | null {
  if (!Array.isArray(input)) return null;
  if (input.length > MAX_SYMBOLS) return null;
  const out: MirrorEntry[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    const e = (raw ?? {}) as Record<string, unknown>;
    const symbol = typeof e.symbol === "string" ? e.symbol.trim() : "";
    const exchange = typeof e.exchange === "string" ? e.exchange.trim().toUpperCase() : "";
    if (!symbol || symbol.length > 32 || !exchange || exchange.length > 8) continue;
    const inst = findInstrumentListing(symbol, exchange);
    if (!inst) continue;
    const entry: MirrorEntry = {
      symbol,
      exchange: inst.e,
      name: inst.n,
      shortName: typeof e.shortName === "string" && e.shortName ? e.shortName : inst.s,
      type: IS_INDEX_RE.test(symbol) ? "Index" : "Equity",
      sector: inst.sec ?? "",
    };
    const k = rowKey(entry);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(entry);
    }
    if (out.length >= MAX_SYMBOLS) break;
  }
  return out;
}

function safeParseEntries(json: string | null): MirrorEntry[] {
  try {
    const parsed: unknown = JSON.parse(json ?? "");
    return Array.isArray(parsed) ? (parsed as MirrorEntry[]) : [];
  } catch {
    return [];
  }
}

export async function GET(request: NextRequest) {
  const deviceId = request.nextUrl.searchParams.get("deviceId") ?? "";
  if (!DEVICE_RE.test(deviceId)) {
    return NextResponse.json({ error: "invalid_device_id" }, { status: 400 });
  }
  const db = openDb(false);
  /* DB-less environments (fresh CI checkout, cold deploy) degrade to an empty
   * watchlist — a read of "no data yet", not an error page (TASK-56 follow-up) */
  if (!db) {
    return NextResponse.json({ entries: [], updatedAt: null });
  }
  try {
    const row = db
      .prepare(`SELECT data_json, updated_at FROM watchlists WHERE id = ? AND scope = 'device'`)
      .get(`device:${deviceId}`) as
      | { data_json: string | null; updated_at: number | null }
      | undefined;
    return NextResponse.json({
      entries: safeParseEntries(row?.data_json ?? null),
      updatedAt: row?.updated_at ?? null,
    });
  } finally {
    db.close();
  }
}

export async function PUT(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const deviceId = typeof b.deviceId === "string" ? b.deviceId : "";
  if (!DEVICE_RE.test(deviceId)) {
    return NextResponse.json({ error: "invalid_device_id" }, { status: 400 });
  }
  const entries = sanitizeEntries(b.symbols);
  if (entries === null) {
    return NextResponse.json({ error: "invalid_symbols" }, { status: 400 });
  }

  const db = openDb(true);
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });
  try {
    const now = Math.floor(Date.now() / 1000);
    db.prepare(
      `INSERT OR REPLACE INTO watchlists (id, scope, data_json, updated_at)
       VALUES (?, 'device', ?, ?)`
    ).run(`device:${deviceId}`, JSON.stringify(entries), now);
    return NextResponse.json({ ok: true, count: entries.length });
  } finally {
    db.close();
  }
}
