import { NextResponse } from "next/server";
import { listStrategies } from "@/lib/strategies/registry";

/* /api/strategies — curated registry view for the screener picker.
   Returns id/name/category/juryRank/edgeScore/universe for every registered
   strategy, ordered by jury rank (unranked last). 60s cache. */

export const dynamic = "force-dynamic";

let cacheAt = 0;
let cacheBody: unknown = null;

export function GET() {
  const now = Date.now();
  if (!cacheBody || now - cacheAt > 60_000) {
    const all = listStrategies().map((s) => ({
      id: s.meta.id,
      name: s.meta.name,
      category: s.meta.category,
      juryRank: s.meta.juryRank,
      edgeScore: s.meta.edgeScore,
      universe: s.meta.universe,
      inputs: s.meta.inputs,
    }));
    all.sort(
      (a, b) =>
        (a.juryRank ?? Number.MAX_SAFE_INTEGER) -
        (b.juryRank ?? Number.MAX_SAFE_INTEGER)
    );
    cacheBody = { strategies: all, count: all.length };
    cacheAt = now;
  }
  return NextResponse.json(cacheBody, {
    headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" },
  });
}
