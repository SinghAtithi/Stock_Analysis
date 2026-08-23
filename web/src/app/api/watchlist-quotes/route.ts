import { NextRequest, NextResponse } from "next/server";
import { getChart, getTicker } from "@/lib/marketData";
import type { Candle } from "@/lib/types";

/* /api/watchlist-quotes — batched price/change/day-spark for watchlist rows
 * (TASK-105). Symbols answered from the cached tape are free; anything else
 * falls back to one bounded 1d/5m chart chain per symbol through a SHARED
 * process-wide token bucket + 60s response cache (same hardening family as
 * /api/tracker, TASK-13). */

export const dynamic = "force-dynamic";

const MAX_SYMBOLS = 30;
const MAX_RAW_LEN = 512;
const SYMBOL_RE = /^[A-Z0-9 .^=&_-]{1,32}$/;

const RESP_TTL_MS = 60_000;
const respCache = new Map<string, { data: unknown; expires: number }>();

function respGet(key: string): unknown | null {
  const hit = respCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.data;
  respCache.delete(key);
  return null;
}

function respSet(key: string, data: unknown) {
  if (respCache.size > 100) {
    const oldest = respCache.keys().next().value;
    if (oldest !== undefined) respCache.delete(oldest);
  }
  respCache.set(key, { data, expires: Date.now() + RESP_TTL_MS });
}

/* shared upstream budget: 10 fetches, refill 1 per 5s */
const BUCKET_CAP = 10;
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

interface QuoteOut {
  symbol: string;
  exchange: string;
  price: number | null;
  changePct: number | null;
  spark: number[];
}

function sparkFrom(candles: Candle[]): number[] {
  const closes = candles.map((c) => c.close).filter((v) => Number.isFinite(v));
  return closes.slice(-20);
}

export async function GET(request: NextRequest) {
  const raw = (request.nextUrl.searchParams.get("symbols") ?? "").slice(0, MAX_RAW_LEN);

  const wanted = [
    ...new Set(
      raw
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
    ),
  ].slice(0, MAX_SYMBOLS);

  const key = wanted.join(",");
  const cached = respGet(key);
  if (cached) {
    return NextResponse.json(cached, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" },
    });
  }

  const out: QuoteOut[] = [];

  /* free pass: tape answers everything it knows */
  let tape: { symbol: string; exchange: string; price: number | null; changePct: number | null }[] = [];
  try {
    const t = await getTicker();
    tape = t.map((x) => ({ symbol: x.symbol, exchange: x.exchange, price: x.price, changePct: x.changePct }));
  } catch {
    tape = [];
  }

  const missing: string[] = [];
  for (const sym of wanted) {
    const hit = tape.find((t) => t.symbol.toUpperCase() === sym);
    if (hit && hit.price != null) {
      out.push({ ...hit, spark: [] });
    } else {
      missing.push(sym);
    }
  }

  /* bounded fallback: one 1d/5m chain per missing symbol, token-gated */
  for (const sym of missing) {
    let q: QuoteOut = { symbol: sym, exchange: "NSE", price: null, changePct: null, spark: [] };
    try {
      if (takeToken()) {
        const chart = await getChart(sym, "NSE", sym.startsWith("^"), "1d", "5m");
        if (chart) {
          q = {
            symbol: sym,
            exchange: chart.exchange ?? "NSE",
            price: chart.regularMarketPrice ?? sparkFrom(chart.candles).slice(-1)[0] ?? null,
            changePct: chart.changePct ?? null,
            spark: sparkFrom(chart.candles),
          };
        }
      }
    } catch {
      /* leave placeholder */
    }
    out.push(q);
  }

  out.sort(
    (a, b) =>
      wanted.indexOf(a.symbol.toUpperCase()) -
      wanted.indexOf(b.symbol.toUpperCase()),
  );

  respSet(key, { quotes: out });
  return NextResponse.json(
    { quotes: out },
    { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } },
  );
}
