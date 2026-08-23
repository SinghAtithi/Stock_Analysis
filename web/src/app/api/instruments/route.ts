import { NextRequest, NextResponse } from "next/server";
import { findInstrument, isIndexSymbol } from "@/lib/instruments";

/**
 * Single-instrument resolution for client deep-links. Replaces static
 * imports of the 671KB instruments index in client bundles (TASK-51):
 * clients ask the server instead of shipping the whole index.
 * GET /api/instruments?s=RELIANCE → { instrument } | { instrument: null }
 */
export async function GET(request: NextRequest) {
  /* TASK-1451: cap lookup key length before map scan */
  const s = (request.nextUrl.searchParams.get("s") ?? "").trim().slice(0, 64);
  if (!s) return NextResponse.json({ instrument: null });

  const hit = findInstrument(s);
  if (!hit) return NextResponse.json({ instrument: null });

  return NextResponse.json({
    instrument: {
      symbol: hit.s,
      name: hit.n,
      shortName: hit.s,
      exchange: hit.e,
      type: isIndexSymbol(hit.s, hit.n) ? "Index" : "Equity",
      sector: hit.sec ?? "",
      ...(hit.idx?.length ? { indices: hit.idx } : {}),
    },
  });
}
