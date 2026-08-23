import { NextRequest, NextResponse } from "next/server";
import { getChart, getTicker } from "@/lib/marketData";
import { INDEX_MAP, findInstrument } from "@/lib/instruments";
import type { TickerItem } from "@/lib/types";

/* /api/tracker — watchlist-style quote tracker (example API).
 * GET /api/tracker                     → full NIFTY50 tape
 * GET /api/tracker?symbols=RELIANCE,TCS,NIFTY 50
 *   Tape symbols are answered from the cached tape; anything else falls back
 *   to a per-symbol 1-day chart fetch (capped). Order follows the request. */

export const dynamic = "force-dynamic";

const MAX_CUSTOM = 10;
const MAX_FALLBACK_FETCHES = 8;

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("symbols") ?? "";
  const tape = await getTicker();

  const wanted = [
    ...new Set(
      raw
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
    ),
  ].slice(0, MAX_CUSTOM);

  if (wanted.length === 0) {
    return NextResponse.json({ count: tape.length, items: tape });
  }

  const bySymbol = new Map(tape.map((t) => [t.symbol.toUpperCase(), t]));
  const items: TickerItem[] = [];
  let fallbackBudget = MAX_FALLBACK_FETCHES;

  for (const sym of wanted) {
    const taped = bySymbol.get(sym);
    if (taped) {
      items.push(taped);
      continue;
    }
    if (fallbackBudget <= 0) {
      items.push({
        symbol: sym,
        name: findInstrument(sym)?.n ?? sym,
        price: null,
        changePct: null,
        exchange: findInstrument(sym)?.e ?? "NSE",
        type: "Equity",
      });
      continue;
    }
    fallbackBudget--;
    const inst = findInstrument(sym);
    const isIndex = sym in INDEX_MAP;
    const chart = await getChart(sym, inst?.e ?? "NSE", isIndex, "1d", "5m");
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

  return NextResponse.json({
    count: items.length,
    requested: wanted.length,
    items,
  });
}
