import { NextRequest, NextResponse } from "next/server";
import { searchInstruments } from "@/lib/instruments";

export async function GET(request: NextRequest) {
  /* TASK-1451: cap query length before in-memory matching — a huge q makes
     every substring scan O(len) for zero user value */
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 64);
  if (q.length < 1) return NextResponse.json({ results: [] });
  const results = searchInstruments(q);
  return NextResponse.json({
    results: results.map((r) => ({
      symbol: r.symbol,
      name: r.name,
      shortName: r.symbol,
      exchange: r.exchange,
      type: r.isIndex ? "Index" : "Equity",
      sector: r.sector ?? "",
      ...(r.indices?.length ? { indices: r.indices } : {}),
    })),
  });
}
