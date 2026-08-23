import { NextRequest, NextResponse } from "next/server";
import { getChart } from "@/lib/marketData";

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

  if (!symbol || !/^[A-Z0-9 .^=&_-]{1,32}$/.test(symbol)) {
    return NextResponse.json({ error: "invalid_symbol" }, { status: 400 });
  }
  if (!VALID.has(key)) {
    return NextResponse.json({ error: "invalid_range" }, { status: 400 });
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

  // CDN-cacheable success payloads; errors stay uncacheable (TASK-04)
  return NextResponse.json(payload, {
    headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
  });
}
