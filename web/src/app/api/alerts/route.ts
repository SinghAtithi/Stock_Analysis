import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { isMembershipType, validateAlertInput } from "@/lib/alerts";

/* /api/alerts — anonymous device-scoped price alerts (ROADMAP T25 v1).
 * GET    ?deviceId=...           → alerts for the device (newest first)
 * POST   {deviceId,symbol,type,price[,exchange]} → create
 * DELETE ?deviceId=...&id=...    → deactivate an owned alert
 * Auth (T27) will claim these rows by device id later. */

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
    console.error("[api/alerts] sqlite open failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

const DEVICE_RE = /^[a-zA-Z0-9_-]{8,64}$/;

export async function GET(request: NextRequest) {
  const deviceId = request.nextUrl.searchParams.get("deviceId") ?? "";
  if (!DEVICE_RE.test(deviceId)) {
    return NextResponse.json({ error: "invalid_device_id" }, { status: 400 });
  }
  const db = openDb(false);
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });
  try {
    /* symbol/exchange/price live in payload_json (schema v1 keeps alerts
       type-generic); unpack for a friendly client shape */
    const rows = db
      .prepare(
        `SELECT id, type, payload_json, active, created_at, fired_at
         FROM alerts WHERE device_id = ? ORDER BY created_at DESC LIMIT 100`
      )
      .all(deviceId) as Record<string, unknown>[];
    return NextResponse.json({
      alerts: rows.map((r) => {
        const payload = safeParse(r.payload_json as string) ?? {};
        return {
          id: r.id,
          symbol: payload.symbol ?? null,
          strategyId: payload.strategyId ?? null,
          topN: payload.topN ?? null,
          exchange: payload.exchange ?? "NSE",
          type: r.type,
          price: payload.price ?? null,
          active: Boolean(r.active),
          createdAt: r.created_at,
          firedAt: r.fired_at,
        };
      }),
    });
  } finally {
    db.close();
  }
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = validateAlertInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { deviceId, exchange, type } = parsed.value;
  const isMembership = isMembershipType(type);

  const db = openDb(true);
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });
  try {
    const id = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const payload = isMembership
      ? { strategyId: parsed.value.strategyId, topN: parsed.value.topN }
      : { symbol: parsed.value.symbol, exchange, price: parsed.value.price };
    db.prepare(
      `INSERT INTO alerts (id, device_id, type, payload_json, active, created_at)
       VALUES (?, ?, ?, ?, 1, ?)`
    ).run(id, deviceId, type, JSON.stringify(payload), now);
    return NextResponse.json({
      id,
      deviceId,
      type,
      ...payload,
      active: true,
      createdAt: now,
    });
  } finally {
    db.close();
  }
}

export async function DELETE(request: NextRequest) {
  const deviceId = request.nextUrl.searchParams.get("deviceId") ?? "";
  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (!DEVICE_RE.test(deviceId)) {
    return NextResponse.json({ error: "invalid_device_id" }, { status: 400 });
  }
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  const db = openDb(true);
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });
  try {
    const res = db
      .prepare(`DELETE FROM alerts WHERE id = ? AND device_id = ?`)
      .run(id, deviceId) as unknown as { changes?: number };
    if (!res.changes) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } finally {
    db.close();
  }
}

function safeParse(
  json: string | null
): { symbol?: string; exchange?: string; price?: number; strategyId?: string; topN?: number } | null {
  try {
    return JSON.parse(json ?? "") as { symbol?: string; exchange?: string; price?: number };
  } catch {
    return null;
  }
}

/** Toggle an owned alert without deleting it (AlertCenter switch). */
export async function PATCH(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const deviceId = typeof b.deviceId === "string" ? b.deviceId : "";
  const id = typeof b.id === "string" ? b.id : "";
  if (!DEVICE_RE.test(deviceId)) return NextResponse.json({ error: "invalid_device_id" }, { status: 400 });
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  if (typeof b.active !== "boolean") return NextResponse.json({ error: "invalid_active" }, { status: 400 });

  const db = openDb(true);
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });
  try {
    const res = db
      .prepare(`UPDATE alerts SET active = ? WHERE id = ? AND device_id = ?`)
      .run(b.active ? 1 : 0, id, deviceId) as unknown as { changes?: number };
    if (!res.changes) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ ok: true, active: b.active });
  } finally {
    db.close();
  }
}
