import { NextRequest, NextResponse } from "next/server";
import { getChart, getTicker } from "@/lib/marketData";
import { INDEX_MAP, findInstrument } from "@/lib/instruments";
import { clientKeyFrom } from "@/lib/clientKey";
import type { TickerItem } from "@/lib/types";

/* /api/tracker — watchlist-style quote tracker.
 * GET /api/tracker                     → full NIFTY50 tape
 * GET /api/tracker?symbols=RELIANCE,TCS,NIFTY 50
 *   Tape symbols are answered from the cached tape; anything else falls back
 *   to a per-symbol 1-day chart fetch.
 *
 * Abuse hardening (TASK-13):
 *  - responses cached 60s in-process + Cache-Control for the CDN layer;
 *  - upstream fallback fetches draw from a SHARED process-wide token bucket
 *    (not per-request), so N parallel requests can't amplify into N×8
 *    upstream chains;
 *  - per-IP sliding-window rate limit (best-effort on serverless:
 *    per-instance only — real enforcement belongs at the edge/CDN);
 *  - symbol strings validated before they reach findInstrument/getChart. */

export const dynamic = "force-dynamic";

const MAX_CUSTOM = 10;
const MAX_RAW_LEN = 512;
const SYMBOL_RE = /^[A-Z0-9 .^=&_-]{1,32}$/;

/* response cache */
const RESP_TTL_MS = 60_000;
const respCache = new Map<string, { data: unknown; expires: number }>();

/* shared upstream budget: 12 fetches, refill 1 per 5s */
const BUCKET_CAP = 12;
const REFILL_MS = 5_000;
let bucket = BUCKET_CAP;
let lastRefill = Date.now();

function takeToken(): boolean {
  const now = Date.now();
  const gained = Math.floor((now - lastRefill) / REFILL_MS);
  if (gained > 0) {
    bucket = Math.min(BUCKET_CAP, bucket + gained);
    lastRefill = now;
  }
  if (bucket <= 0) return false;
  bucket--;
  return true;
}

/* per-IP sliding window: 30 req/min */
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (list.length >= RATE_LIMIT) {
    hits.set(ip, list);
    return true;
  }
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return false;
}

function respGet(key: string): unknown | null {
  const hit = respCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.data;
  respCache.delete(key);
  return null;
}

function respSet(key: string, data: unknown) {
  if (respCache.size > 200) {
    const oldest = respCache.keys().next().value;
    if (oldest) respCache.delete(oldest);
  }
  respCache.set(key, { data, expires: Date.now() + RESP_TTL_MS });
}

export async function GET(request: NextRequest) {
  const ip = clientKeyFrom(request.headers);
  if (rateLimited(ip)) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  const raw = (request.nextUrl.searchParams.get("symbols") ?? "").slice(
    0,
    MAX_RAW_LEN
  );

  const wanted = [
    ...new Set(
      raw
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
    ),
  ].slice(0, MAX_CUSTOM);

  if (!wanted.every((s) => SYMBOL_RE.test(s))) {
    return NextResponse.json({ error: "invalid_symbol" }, { status: 400 });
  }

  const key = wanted.join(",");
  const cached = respGet(key);
  if (cached) {
    return NextResponse.json(cached, {
      headers: {
        "Cache-Control": `public, s-maxage=60, stale-while-revalidate=120`,
      },
    });
  }

  const tape = await getTicker();

  if (wanted.length === 0) {
    const body = { count: tape.length, items: tape };
    respSet(key, body);
    return NextResponse.json(body, {
      headers: { "Cache-Control": `public, s-maxage=60` },
    });
  }

  const bySymbol = new Map(tape.map((t) => [t.symbol.toUpperCase(), t]));
  const items: TickerItem[] = [];

  for (const sym of wanted) {
    const taped = bySymbol.get(sym);
    if (taped) {
      items.push(taped);
      continue;
    }
    const inst = findInstrument(sym);
    const isIndex = sym in INDEX_MAP;
    const chart =
      takeToken() &&
      (await getChart(sym, inst?.e ?? "NSE", isIndex, "1d", "5m"));
    if (chart) {
      items.push({
        symbol: chart.symbol,
        name: chart.name,
        price: chart.regularMarketPrice,
        changePct: chart.changePct,
        exchange: inst?.e ?? "NSE",
        type: isIndex ? "Index" : "Equity",
      });
    } else {
      items.push({
        symbol: sym,
        name: inst?.n ?? sym,
        price: null,
        changePct: null,
        exchange: inst?.e ?? "NSE",
        type: isIndex ? "Index" : "Equity",
      });
    }
  }

  const body = { count: items.length, requested: wanted.length, items };
  respSet(key, body);
  return NextResponse.json(body, {
    headers: {
      "Cache-Control": `public, s-maxage=60, stale-while-revalidate=120`,
    },
  });
}
