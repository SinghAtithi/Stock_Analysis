/* Dependency-free iCalendar (RFC 5545) generator + download trigger.
 * TASK-1383 AC4: "ICS download per event reusing TASK-512 helper" — no such
 * helper existed in the repo, so this is the shared one. Keep it pure and
 * side-effect-free except for `downloadIcs` (client-only). */

export interface IcsEvent {
  /** Stable unique id, e.g. "niftyterm-RELIANCE-20261012@niftyterm.in" */
  uid: string;
  summary: string;
  description?: string;
  /** All-day start, "YYYY-MM-DD" (calendar date, no timezone). */
  dtStart: string;
  /** Exclusive end date, "YYYY-MM-DD"; defaults to dtStart + 1 day. */
  dtEnd?: string;
}

/* RFC 5545: TEXT fields escape backslash, semicolon, comma and newline. */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/* All-day events must be exactly 8 digits (YYYYMMDD). */
function dateKey(date: string): string {
  return date.replace(/-/g, "");
}

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function nowStamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
}

/** Build a complete .ics payload (CRLF line endings, one VEVENT per event).
 *  Always ends with a trailing CRLF as RFC 5545 requires. */
export function buildIcs(events: IcsEvent[]): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//NIFTYTERM//Earnings calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  for (const ev of events) {
    const end = ev.dtEnd ?? nextDay(ev.dtStart);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${ev.uid}`,
      `DTSTAMP:${nowStamp()}`,
      `DTSTART;VALUE=DATE:${dateKey(ev.dtStart)}`,
      `DTEND;VALUE=DATE:${dateKey(end)}`,
      `SUMMARY:${escapeText(ev.summary)}`,
    );
    if (ev.description) {
      lines.push(`DESCRIPTION:${escapeText(ev.description)}`);
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

/** Trigger a browser download of an .ics payload (Blob + anchor click). */
export function downloadIcs(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}