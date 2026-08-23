import { NextRequest, NextResponse } from "next/server";
import { getChart } from "@/lib/marketData";
import { istSessionOpen } from "@/lib/session";
import { validExchange, validSymbol } from "@/lib/symbolGuard";
import { cacheGet, cacheSet, retryAfterSec, takeToken } from "@/lib/upstreamGuards";

const VALID = new Set([
  "1d/1m",
  "1d/5m",
  "5d/5m",
  "5d/15m",
  "1mo/15m",
  "1mo/1h",
  "3mo/1h",
  "3mo/1d",
  "6mo/1h",
  "6mo/1d",
  "1y/1d",
  "2y/1wk",
  "5y/1wk",
  "max/1mo",
]);

export async function GET(request: NextRequest) {
  /* upstream guard (TASK-1403): shed per-IP floods before any work —
     every miss here costs a marketData chain with real circuit budget */
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "local";
  if (!takeToken(`chart:${ip}`)) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(retryAfterSec()) } }
    );
  }

  const symbol = (request.nextUrl.searchParams.get("symbol") ?? "")
    .trim()
    .toUpperCase();
  const exchange = (request.nextUrl.searchParams.get("exchange") ?? "NSE")
    .trim()
    .toUpperCase();
  const isIndex =
    (request.nextUrl.searchParams.get("type") ?? "").toLowerCase() === "index";
  const range = (request.nextUrl.searchParams.get("range") ?? "1y").trim();
  const interval = (request.nextUrl.searchParams.get("interval") ?? "1d").trim();
  const key = `${range}/${interval}`;

  if (!symbol || !validSymbol(symbol)) {
    return NextResponse.json({ error: "invalid_symbol" }, { status: 400 });
  }
  if (!validExchange(exchange)) {
    return NextResponse.json({ error: "invalid_exchange" }, { status: 400 });
  }
  if (!VALID.has(key)) {
    return NextResponse.json({ error: "invalid_range" }, { status: 400 });
  }

  /* 60s micro-cache (TASK-1403): identical symbol+range re-reads never
     touch the upstream chain; success payloads only, errors stay live */
  const cacheKey = `${symbol}|${exchange}|${isIndex ? 1 : 0}|${key}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    return NextResponse.json(cached, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
    });
  }

  const payload = await getChart(symbol, exchange, isIndex, range, interval);
  if (!payload) {
    return NextResponse.json(
      {
        error: isIndex
          ? "index_unavailable"
          : interval.endsWith("m") || interval.endsWith("h")
            ? "intraday data temporarily unavailable — try a longer range"
            : "not_found",
      },
      { status: 404 }
    );
  }

  // CDN-cacheable success payloads; errors stay uncacheable (TASK-04).
  // Outside the IST session payloads are frozen — widen CDN TTLs (TASK-53).
  cacheSet(cacheKey, payload);
  const open = istSessionOpen();
  const sMaxage = open ? 60 : 600;
  const swr = open ? 300 : 3600;
  return NextResponse.json(payload, {
    headers: { "Cache-Control": `public, s-maxage=${sMaxage}, stale-while-revalidate=${swr}` },
  });
}
