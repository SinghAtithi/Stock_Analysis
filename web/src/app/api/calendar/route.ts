import { NextRequest, NextResponse } from "next/server";
import {
  CALENDAR_AS_OF,
  CALENDAR_SOURCE_LABEL,
  calendarStaleness,
  getScheduledResults,
  STALE_AFTER_DAYS,
} from "@/lib/earningsCalendar";
import { istIsoDate, istNow } from "@/lib/session";
import { retryAfterSec, takeToken } from "@/lib/upstreamGuards";
import { clientKeyFrom } from "@/lib/clientKey";

/* /api/calendar — upcoming earnings dates (TASK-1383).
 * GET → { events, meta } where events are grouped-ready rows sorted by date
 * (only future IST dates) and meta carries the honest source/staleness
 * contract the UI must surface. Data is the curated static table in
 * lib/earningsCalendar.ts — no upstream fetch happens here. */

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!takeToken(`calendar:${clientKeyFrom(request.headers)}`)) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(retryAfterSec()) } },
    );
  }

  const today = istIsoDate(istNow(new Date()));
  const staleDays = calendarStaleness(today);
  const events = getScheduledResults(today);

  return NextResponse.json(
    {
      events,
      meta: {
        source: CALENDAR_SOURCE_LABEL,
        asOf: CALENDAR_AS_OF,
        stale: staleDays > STALE_AFTER_DAYS,
        staleDays,
        updatedAt: Date.now(),
      },
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    },
  );
}