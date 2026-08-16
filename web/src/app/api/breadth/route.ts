import { NextResponse } from "next/server";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

/* /api/breadth — T13. Joined view over breadth_series: vix (or vix_spot), fiidii,
 * breadth (or breadth_spot), one record per day, newest first.
 *   name 'vix'/'vix_spot'  payload {ts, close}        -> vix
 *   name 'fiidii'          payload {date, fii_equity, fii_debt, di_equity, di_debt,
 *                                 fii_total, di_total} -> fii_* / di_*
 *   name 'breadth'/'breadth_spot' payload {date, adv, dec, unc, hi, lo} -> adv/dec/unc/hi/lo
 * Primary names ('vix', 'breadth') win over spot fallbacks on the same day.
 * 300s in-process cache. Empty days + null sources when the DB has no data.
 */

export const dynamic = "force-dynamic";

const require = createRequire(import.meta.url);

interface SqlRow {
  name: string;
  ts: number;
  payload_json: string;
}

const DB_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../db/data/app.db"
);

const CACHE_TTL_MS = 300_000;
let cacheAt = 0;
let cacheBody: unknown = null;

interface DayRec {
  date: string;
  vix: number | null;
  fii_equity: number | null;
  fii_debt: number | null;
  di_equity: number | null;
  di_debt: number | null;
  fii_total: number | null;
  di_total: number | null;
  adv: number | null;
  dec: number | null;
  unc: number | null;
  hi: number | null;
  lo: number | null;
}

const emptyPayload = (): {
  days: DayRec[];
  meta: { as_of: string | null; sources: { vix: string | null; fii: string | null; ad: string | null } };
} => ({
  days: [],
  meta: { as_of: null, sources: { vix: null, fii: null, ad: null } },
});

function dayDate(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

function buildPayload(rows: SqlRow[]) {
  const vixByDay = new Map<number, number>();
  const fiiByDay = new Map<number, Record<string, number | null>>();
  const adByDay = new Map<number, Record<string, number>>();

  for (const row of rows) {
    if (!Number.isFinite(row.ts)) continue;
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(row.payload_json);
    } catch {
      continue;
    }
    if (row.name === "vix" && !vixByDay.has(row.ts)) {
      const close = Number(payload.close);
      if (Number.isFinite(close)) vixByDay.set(row.ts, close);
    } else if (row.name === "vix_spot" && !vixByDay.has(row.ts)) {
      const close = Number(payload.close);
      if (Number.isFinite(close)) vixByDay.set(row.ts, close);
    } else if (row.name === "fiidii" && !fiiByDay.has(row.ts)) {
      fiiByDay.set(row.ts, {
        fii_equity: numOrNull(payload.fii_equity),
        fii_debt: numOrNull(payload.fii_debt),
        di_equity: numOrNull(payload.di_equity),
        di_debt: numOrNull(payload.di_debt),
        fii_total: numOrNull(payload.fii_total),
        di_total: numOrNull(payload.di_total),
      });
    } else if (row.name === "breadth" && !adByDay.has(row.ts)) {
      adByDay.set(row.ts, {
        adv: Number(payload.adv) || 0,
        dec: Number(payload.dec) || 0,
        unc: Number(payload.unc) || 0,
        hi: Number(payload.hi) || 0,
        lo: Number(payload.lo) || 0,
      });
    } else if (row.name === "breadth_spot" && !adByDay.has(row.ts)) {
      adByDay.set(row.ts, {
        adv: Number(payload.adv) || 0,
        dec: Number(payload.dec) || 0,
        unc: Number(payload.unc) || 0,
        hi: Number(payload.hi) || 0,
        lo: Number(payload.lo) || 0,
      });
    }
  }

  const days = new Set<number>([...vixByDay.keys(), ...fiiByDay.keys(), ...adByDay.keys()]);
  const out: DayRec[] = [...days]
    .sort((a, b) => b - a)
    .map((ts) => {
      const ad = adByDay.get(ts);
      const fii = fiiByDay.get(ts);
      return {
        date: dayDate(ts),
        vix: vixByDay.get(ts) ?? null,
        fii_equity: fii?.fii_equity ?? null,
        fii_debt: fii?.fii_debt ?? null,
        di_equity: fii?.di_equity ?? null,
        di_debt: fii?.di_debt ?? null,
        fii_total: fii?.fii_total ?? null,
        di_total: fii?.di_total ?? null,
        adv: ad?.adv ?? null,
        dec: ad?.dec ?? null,
        unc: ad?.unc ?? null,
        hi: ad?.hi ?? null,
        lo: ad?.lo ?? null,
      };
    });

  const newest = days.size ? Math.max(...days) : null;
  const has = (name: string) => rows.some((r) => r.name === name);
  const sources = {
    vix: vixByDay.size ? (has("vix") ? "vix" : "vix_spot") : null,
    fii: fiiByDay.size ? "fiidii" : null,
    ad: adByDay.size ? (has("breadth") ? "breadth" : "breadth_spot") : null,
  };
  return {
    days: out,
    meta: { as_of: newest ? dayDate(newest) : null, sources },
  };
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function readBreadth() {
  try {
    const Database = require("better-sqlite3") as unknown as {
      new (path: string, opts: { readonly: true }): {
        prepare(sql: string): { all(): SqlRow[] };
        close(): void;
      };
    };
    const db = new Database(DB_PATH, { readonly: true });
    try {
      const rows = db
        .prepare(
          "SELECT name, ts, payload_json FROM breadth_series WHERE name IN ('vix','vix_spot','fiidii','breadth','breadth_spot')"
        )
        .all();
      return buildPayload(rows);
    } finally {
      db.close();
    }
  } catch {
    return emptyPayload();
  }
}

export function GET() {
  const now = Date.now();
  if (!cacheBody || now - cacheAt > CACHE_TTL_MS) {
    cacheBody = readBreadth();
    cacheAt = now;
  }
  return NextResponse.json(cacheBody, {
    headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
  });
}
