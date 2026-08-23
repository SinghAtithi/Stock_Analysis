import { NextRequest, NextResponse } from "next/server";
import { getTicker } from "@/lib/marketData";
import { cacheGet, cacheSet, retryAfterSec, takeToken } from "@/lib/upstreamGuards";
import { clientKeyFrom } from "@/lib/clientKey";

export const dynamic = "force-dynamic";

/* TASK-1403: the tape fans out to upstream quotes on every origin hit;
   per-key token bucket sheds floods, 60s micro-cache collapses repeats
   (the UI polls every 90s — one real fetch per minute serves everyone).
   Keying via clientKeyFrom (TASK-1465): forwarding headers are only
   trusted when TRUST_PROXY=1, else rotation can't mint fresh buckets. */

export async function GET(request: NextRequest) {
  const ip = clientKeyFrom(request.headers);
  if (!takeToken(`ticker:${ip}`)) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(retryAfterSec()) } }
    );
  }

  const cached = cacheGet("ticker-tape");
  if (cached) {
    return NextResponse.json(cached, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" },
    });
  }

  const items = await getTicker();
  const body = { items };
  cacheSet("ticker-tape", body);
  return NextResponse.json(body, {
    headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" }
  });
}
