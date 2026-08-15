import { NextRequest, NextResponse } from "next/server";
import { searchInstruments } from "@/lib/instruments";

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ results: [] });
  const results = searchInstruments(q);
  return NextResponse.json({
    results: results.map((r) => ({
      symbol: r.symbol,
      name: r.name,
      shortName: r.symbol,
      exchange: r.exchange,
      type: r.isIndex ? "Index" : "Equity",
      sector: "",
    })),
  });
}
