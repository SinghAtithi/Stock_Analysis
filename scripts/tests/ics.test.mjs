import test from "node:test";
import assert from "node:assert/strict";

/* TASK-1549 — ics.ts buildIcs: dependency-free RFC 5545 payload builder with
   no suite. downloadIcs (Blob + anchor click) is excluded — DOM-only. */

const ics = await import("../../web/src/lib/ics.ts");

const ev = (over = {}) => ({
  uid: "niftyterm-RELIANCE-20261013@niftyterm.in",
  summary: "RELIANCE results",
  dtStart: "2026-10-13",
  ...over,
});

test("envelope: calendar headers, one VEVENT, trailing CRLF", () => {
  const out = ics.buildIcs([ev()]);
  assert.ok(out.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"));
  assert.ok(out.includes("PRODID:-//NIFTYTERM//Earnings calendar//EN\r\n"));
  assert.ok(out.endsWith("END:VEVENT\r\nEND:VCALENDAR\r\n"));
  // every line ends CRLF: no bare-LF lines.
  assert.equal(out.match(/(?<!\r)\n/g), null);
});

test("dates: all-day keys are 8 digits, dtEnd defaults to next day", () => {
  const out = ics.buildIcs([ev()]);
  assert.ok(out.includes("DTSTART;VALUE=DATE:20261013\r\n"));
  assert.ok(out.includes("DTEND;VALUE=DATE:20261014\r\n"));
  const explicit = ics.buildIcs([ev({ dtEnd: "2026-10-20" })]);
  assert.ok(explicit.includes("DTEND;VALUE=DATE:20261020\r\n"));
});

test("next-day rolls month and year boundaries", () => {
  const jan = ics.buildIcs([ev({ dtStart: "2026-01-31" })]);
  assert.ok(jan.includes("DTEND;VALUE=DATE:20260201\r\n"));
  const nye = ics.buildIcs([ev({ dtStart: "2026-12-31" })]);
  assert.ok(nye.includes("DTEND;VALUE=DATE:20270101\r\n"));
});

test("RFC 5545 escaping: semicolon, comma, backslash, newline", () => {
  const out = ics.buildIcs([
    ev({ summary: "A;B,C\\D\nE", description: "line1\nline2;done" }),
  ]);
  assert.ok(out.includes("SUMMARY:A\\;B\\,C\\\\D\\nE\r\n"));
  assert.ok(out.includes("DESCRIPTION:line1\\nline2\\;done\r\n"));
});

test("DESCRIPTION omitted when absent, DTSTAMP stamped", () => {
  const out = ics.buildIcs([ev()]);
  assert.ok(!out.includes("DESCRIPTION"));
  assert.match(out, /DTSTAMP:\d{8}T\d{6}Z\r\n/);
});

test("empty list yields a valid dateless calendar", () => {
  const out = ics.buildIcs([]);
  assert.ok(out.startsWith("BEGIN:VCALENDAR\r\n"));
  assert.ok(out.endsWith("END:VCALENDAR\r\n"));
  assert.ok(!out.includes("VEVENT"));
});
