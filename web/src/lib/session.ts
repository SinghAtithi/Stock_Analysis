/* Shared IST market-session helpers — safe for client and server.
   Single source of truth so UI polling, CDN headers and upstream TTLs all
   agree on "is the exchange open" (TASK-53).

   NSE/BSE equity session: 09:15–15:30 IST, Mon–Fri. Holidays are NOT modeled
   (no calendar feed); outside-session widening merely becomes conservative
   on those days, never wrong about freshness during real sessions. */

export const SESSION_OPEN_MIN = 9 * 60 + 15;
export const SESSION_CLOSE_MIN = 15 * 60 + 30;

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

export function istMinutes(p: IstParts): number {
  return p.h * 60 + p.m;
}

/** True during the regular IST equity session (Mon–Fri 09:15–15:30). */
export function istSessionOpen(date: Date = new Date()): boolean {
  const p = istNow(date);
  const dow = istWeekday(p);
  if (dow < 1 || dow > 5) return false;
  const mins = istMinutes(p);
  return mins >= SESSION_OPEN_MIN && mins < SESSION_CLOSE_MIN;
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
