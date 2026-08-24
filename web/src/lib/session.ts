/* Shared IST market-session helpers — safe for client and server.
   Single source of truth so UI polling, CDN headers and upstream TTLs all
   agree on "is the exchange open" (TASK-53).

   NSE/BSE equity session: 09:15–15:30 IST, Mon–Fri, excluding published
   trading holidays (TASK-462): the calendar below is a curated STATIC list
   from the exchanges' year-ahead circulars — lunar festival dates drift by
   a day with moon sighting, so REVIEW EACH DECEMBER for the coming year.
   The Diwali Muhurat *evening* session is not modeled. Outside-session
   widening merely becomes conservative on unknown holidays, never wrong
   about freshness during real sessions. */

export const SESSION_OPEN_MIN = 9 * 60 + 15;
export const SESSION_CLOSE_MIN = 15 * 60 + 30;

/** NSE/BSE equity trading holidays (IST dates). Weekday-only entries are
 *  strictly necessary (Sat/Sun are closed regardless) but full-year lists
 *  are kept for readability. Extend annually. */
export const TRADING_HOLIDAYS: ReadonlySet<string> = new Set([
  // 2025
  "2025-02-26", // Mahashivratri
  "2025-03-14", // Holi
  "2025-03-31", // Id-Ul-Fitr
  "2025-04-10", // Good Friday
  "2025-04-14", // Dr. Ambedkar Jayanti
  "2025-05-01", // Maharashtra Day
  "2025-08-15", // Independence Day
  "2025-08-27", // Ganesh Chaturthi
  "2025-10-02", // Gandhi Jayanti
  "2025-10-21", // Dussehra
  "2025-10-22", // Diwali Laxmi Pujan (Muhurat evening not modeled)
  "2025-11-05", // Gurunanak Jayanti
  "2025-12-25", // Christmas
  // 2026
  "2026-01-26", // Republic Day
  "2026-03-04", // Holi
  "2026-03-20", // Id-Ul-Fitr (approximate — confirm against NSE circular)
  "2026-04-03", // Good Friday
  "2026-04-14", // Dr. Ambedkar Jayanti
  "2026-05-01", // Maharashtra Day
  "2026-09-14", // Ganesh Chaturthi (approximate — confirm)
  "2026-10-02", // Gandhi Jayanti
  "2026-10-20", // Dussehra (approximate — confirm)
  "2026-11-09", // Diwali Laxmi Pujan (approximate — confirm)
  "2026-11-24", // Gurunanak Jayanti (approximate — confirm)
  "2026-12-25", // Christmas
]);

export interface IstParts {
  y: number;
  mo: number;
  da: number;
  h: number;
  m: number;
  s: number;
}

export function istNow(date: Date = new Date()): IstParts {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return {
    y: get("year"),
    mo: get("month"),
    da: get("day"),
    h: get("hour"),
    m: get("minute"),
    s: get("second"),
  };
}

/** 0=Sun .. 6=Sat, computed on the IST calendar date. */
export function istWeekday(p: IstParts): number {
  return new Date(p.y, p.mo - 1, p.da).getDay();
}

/** IST calendar date as "YYYY-MM-DD" (holiday-calendar key). */
export function istIsoDate(p: IstParts): string {
  return `${p.y}-${String(p.mo).padStart(2, "0")}-${String(p.da).padStart(2, "0")}`;
}

/** A trading day: Mon–Fri AND not in the holiday calendar. */
export function istTradingDay(p: IstParts): boolean {
  return (
    istWeekday(p) >= 1 &&
    istWeekday(p) <= 5 &&
    !TRADING_HOLIDAYS.has(istIsoDate(p))
  );
}

export function istMinutes(p: IstParts): number {
  return p.h * 60 + p.m;
}

/** True during the regular IST equity session for these IST parts. */
export function sessionOpenFor(p: IstParts): boolean {
  if (!istTradingDay(p)) return false;
  const mins = istMinutes(p);
  return mins >= SESSION_OPEN_MIN && mins < SESSION_CLOSE_MIN;
}

/** Minutes until the next session open across holidays/weekends, or null
 *  when none can be found within a fortnight (calendar gap). */
export function minutesUntilOpen(date: Date = new Date(), nowP = istNow(date)): number | null {
  const nowMin = istMinutes(nowP);
  if (istTradingDay(nowP) && nowMin < SESSION_OPEN_MIN)
    return SESSION_OPEN_MIN - nowMin;
  const DAY_MS = 86_400_000;
  for (let i = 1; i < 15; i++) {
    if (istTradingDay(istNow(new Date(date.getTime() + i * DAY_MS))))
      return i * 1440 - nowMin + SESSION_OPEN_MIN;
  }
  return null;
}

/** True during the regular IST equity session (trading day, 09:15–15:30). */
export function istSessionOpen(date: Date = new Date()): boolean {
  return sessionOpenFor(istNow(date));
}

/** Upstream/CDN cache TTL for a chart payload (TASK-53). While the IST
 *  session is open, intraday payloads stay hot (60s) and dailies 10min;
 *  outside the session prices cannot change, so TTLs widen to stop
 *  burning upstream quota overnight/holidays. */
export function chartCacheTtlMs(interval: string, open: boolean): number {
  const intraday = interval.endsWith("m") || interval.endsWith("h");
  if (open) return intraday ? 60_000 : 10 * 60_000;
  return intraday ? 10 * 60_000 : 30 * 60_000;
}
