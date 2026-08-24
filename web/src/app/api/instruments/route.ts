import { NextRequest, NextResponse } from "next/server";
import { findInstrument, isIndexSymbol } from "@/lib/instruments";

/**
 * Single-instrument resolution for client deep-links. Replaces static
 * imports of the 671KB instruments index in client bundles (TASK-51):
 * clients ask the server instead of shipping the whole index.
 * GET /api/instruments?s=RELIANCE → { instrument } | { instrument: null }
 */
export async function GET(request: NextRequest) {
  /* TASK-866: normalize case — deep links like ?s=reliance must resolve
     identically to ?s=RELIANCE (the index is exact-uppercase-match).
     TASK-358: exchange-suffixed links (?s=RELIANCE.NS / .BO) resolve to the
     bare symbol the index stores. */
  const s = (request.nextUrl.searchParams.get("s") ?? "")
    .trim()
    .toUpperCase()
    .replace(/\.(NS|BO)$/, "")
    .slice(0, 64);
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
