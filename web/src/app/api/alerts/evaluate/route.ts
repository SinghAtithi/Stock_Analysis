import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import path from "node:path";
import { getTicker } from "@/lib/marketData";
import { evaluatePass, membershipDiff, membershipEvents, isMembershipType } from "@/lib/alerts";

/* /api/alerts/evaluate — one evaluation pass (ROADMAP T25/T59).
 * Price alerts price off the cached NIFTY50 tape (SWR in-process → no
 * upstream stampede). Membership alerts diff the two latest signal_snapshot
 * runs per strategy and fire on top-N enter/exit. Fired rows deactivate.
 * Delivery: logged digest here; Resend-shaped email adapter fires only when
 * RESEND_API_KEY is set (see deliverDigest). */

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

/** Latest two distinct snapshot runs per strategy → top-N enter/exit diffs. */
function membershipDiffs(
  db: DbLike,
  wantedStrategies: Set<string>
): Map<string, { entered: string[]; exited: string[] }> {
  const out = new Map<string, { entered: string[]; exited: string[] }>();
  if (wantedStrategies.size === 0) return out;
  for (const strategyId of wantedStrategies) {
    const asOfs = db
      .prepare(
        `SELECT DISTINCT as_of FROM signal_snapshots WHERE strategy_id = ? ORDER BY as_of DESC LIMIT 2`
      )
      .all(strategyId) as { as_of: number }[];
    if (asOfs.length < 2) continue; // need a previous + current run to diff
    const top = (asOf: number): string[] =>
      (
        db
          .prepare(
            `SELECT symbol FROM signal_snapshots
             WHERE strategy_id = ? AND as_of = ? ORDER BY rank ASC LIMIT ?`
          )
          .all(strategyId, asOf, 50) as { symbol: string }[]
      ).map((r) => r.symbol);
    const prevTop = top(asOfs[1].as_of);
    const currTop = top(asOfs[0].as_of);
    out.set(strategyId, membershipDiff(prevTop, currTop));
  }
  return out;
}

/** Resend-shaped adapter: logs the digest always; sends when key present. */
function deliverDigest(fired: { deviceId: string; detail?: string; symbol?: string; type: string }[]): void {
  if (fired.length === 0) return;
  const lines = fired.map(
    (f) => `- ${f.type} ${f.symbol ?? ""} ${f.detail ?? ""}`.trim()
  );
  console.log(`[alerts digest] ${fired.length} fired:\n${lines.join("\n")}`);
  if (!process.env.RESEND_API_KEY) return; // email delivery opt-in via env
  // Resend-shaped payload; transport intentionally un-wired pre-launch.
  console.log(
    `[alerts digest] RESEND_API_KEY present — would POST https://api.resend.com/emails ` +
      `{from:"alerts@nifty.term", subject:"${fired.length} alert(s) fired"}`
  );
}

/* TASK-1429: cron-style endpoint — unauthenticated callers must not be able
 * to run write-mode evaluation passes (or fire email digests). Fail closed:
 * if CRON_SECRET is unset the route is disabled entirely. */

function authorizedBearer(header: string | null): boolean {
  const expected = process.env.CRON_SECRET ?? "";
  if (!expected) return false;
  const provided = header?.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

let evalBusy = false;

export async function GET(request: NextRequest) {
  /* overlap lock first: even authorized double-fires must queue out */
  if (evalBusy) {
    return NextResponse.json(
      { error: "eval_in_progress" },
      { status: 429, headers: { "Retry-After": "30" } }
    );
  }
  if (!authorizedBearer(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  evalBusy = true;
  try {
    return await evaluateAll();
  } finally {
    evalBusy = false;
  }
}

async function evaluateAll() {
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

  const now = Math.floor(Date.now() / 1000);

  /* price alerts → tape */
  const priceRows = rows.filter((r) => !isMembershipType(r.type));
  const tape = await getTicker();
  const priceBySymbol = new Map(
    tape.flatMap((t) => (t.price == null ? [] : [[t.symbol.toUpperCase(), t.price] as const]))
  );
  const fired = evaluatePass(priceRows, priceBySymbol, now);

  /* membership alerts → last-two-runs diff */
  const memberRows = rows.filter((r) => isMembershipType(r.type));
  if (memberRows.length > 0) {
    const mdb = openDb(false);
    if (mdb) {
      try {
        const wanted = new Set(
          memberRows
            .map((r) => {
              try {
                return (JSON.parse(r.payload_json) as { strategyId?: string }).strategyId ?? "";
              } catch {
                return "";
              }
            })
            .filter(Boolean)
        );
        const membership = membershipDiffs(mdb, wanted);
        fired.push(...membershipEvents(memberRows, membership, now));
      } finally {
        mdb.close();
      }
    }
  }

  const wdb = openDb(true);
  if (!wdb) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });
  try {
    for (const f of fired) {
      wdb.prepare(`UPDATE alerts SET active = 0, fired_at = ? WHERE id = ? AND active = 1`).run(f.firedAt, f.id);
    }
  } finally {
    wdb.close();
  }

  deliverDigest(fired);
  return NextResponse.json({ evaluated: rows.length, fired });
}
