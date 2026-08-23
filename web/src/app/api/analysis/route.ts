import { NextRequest, NextResponse } from "next/server";
import { getChart } from "@/lib/marketData";
import { analyzeChart } from "@/lib/analysis";

/* /api/analysis — single-stock analysis (example API).
 * GET /api/analysis?symbol=RELIANCE&range=1y&interval=1d
 * Pulls the chart through the standard fallback chain, then computes
 * SMA20/50/200, ROC20, RSI14, annualized volatility, window high/low,
 * a trend verdict and human-readable signals. */

export const dynamic = "force-dynamic";

const VALID = new Set([
  "3mo/1d",
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
  const range = request.nextUrl.searchParams.get("range") ?? "1y";
  const interval = request.nextUrl.searchParams.get("interval") ?? "1d";
  const key = `${range}/${interval}`;

  if (!symbol || !/^[A-Z0-9 .^=&_-]{1,32}$/.test(symbol)) {
    return NextResponse.json({ error: "invalid_symbol" }, { status: 400 });
  }
  if (!VALID.has(key)) {
    return NextResponse.json({ error: "invalid_range" }, { status: 400 });
  }

  const chart = await getChart(symbol, exchange, isIndex, range, interval);
  if (!chart) {
    return NextResponse.json(
      { error: isIndex ? "index_unavailable" : "not_found" },
      { status: 404 }
    );
  }

  const analysis = analyzeChart({ ...chart, exchangeName: chart.exchange });
  if (!analysis) {
    return NextResponse.json({ error: "no_candles" }, { status: 502 });
  }

  return NextResponse.json(analysis, {
    headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
  });
}
