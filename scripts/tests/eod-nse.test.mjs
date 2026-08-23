/**
 * TASK-30 — single-symbol EOD ingest via the NSE NextApi proxy.
 * Guards the pure pieces in scripts/ingest-eod.mjs: URL builder, row parser,
 * window math, history dedupe, and symbol resolution. Network is faked.
 *
 * Run: node --test scripts/tests/eod-nse.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  NSE_FLOOR,
  fmtDmy,
  nseTradeUrl,
  nseYearsUrl,
  parseNseFirstYear,
  parseNseTradeRows,
  nseWindows,
  fetchNseHistory,
  resolveSymbolItem,
  epochSecForDate,
} from "../ingest-eod.mjs";

/* realistic rows shaped like getHistoricalTradeData output (RELIANCE, Dec-1996) */
const nseRow = (over = {}) => ({
  chSymbol: "RELIANCE",
  chSeries: "EQ",
  mtimestamp: "05-Dec-1996",
  chOpeningPrice: 181,
  chTradeHighPrice: 184.9,
  chTradeLowPrice: 176.75,
  chClosingPrice: 182.85,
  chPreviousClsPrice: 179.75,
  chTotTradedQty: 6_752_800,
  chTotTradedVal: 1_229_351_662.5,
  vwap: 182.05,
  ...over,
});

test("NSE_FLOOR is the exchange archive floor", () => {
  assert.equal(NSE_FLOOR, "1996-01-01");
});

test("fmtDmy renders DD-MM-YYYY in UTC", () => {
  assert.equal(fmtDmy(Date.UTC(1996, 0, 1)), "01-01-1996");
  assert.equal(fmtDmy(Date.UTC(2026, 7, 23)), "23-08-2026");
});

test("nseTradeUrl encodes symbol and date range", () => {
  const url = nseTradeUrl("M&M", "01-01-1996", "31-03-1996");
  assert.ok(url.startsWith("https://www.nseindia.com/api/NextApi/apiClient/GetQuoteApi"));
  assert.ok(url.includes("functionName=getHistoricalTradeData"));
  assert.ok(url.includes("symbol=M%26M"));
  assert.ok(url.includes("series=EQ"));
  assert.ok(url.includes("fromDate=01-01-1996&toDate=31-03-1996"));
});

test("parseNseTradeRows maps NSE fields onto candle rows (00:00 IST ts)", () => {
  const parsed = parseNseTradeRows([nseRow()], "RELIANCE");
  assert.ok(parsed);
  const [c] = parsed.candles;
  /* 05-Dec-1996 session at 00:00 IST == 1996-12-04T18:30Z */
  assert.equal(c.ts, epochSecForDate("1996-12-05"));
  assert.equal(c.o, 181);
  assert.equal(c.h, 184.9);
  assert.equal(c.l, 176.75);
  assert.equal(c.c, 182.85);
  assert.equal(c.v, 6_752_800);
});

test("parseNseTradeRows skips malformed rows but keeps good ones", () => {
  const data = [
    null,
    { mtimestamp: "garbage" },
    nseRow({ chClosingPrice: undefined }),
    nseRow({ mtimestamp: "32-Xyz-1996" }),
    nseRow(),
    nseRow({ mtimestamp: "08-Dec-1996" }),
  ];
  const parsed = parseNseTradeRows(data, "RELIANCE");
  assert.ok(parsed);
  assert.equal(parsed.candles.length, 2);
  assert.deepEqual(parsed.candles.map((c) => c.ts).sort((a, b) => a - b),
    [epochSecForDate("1996-12-05"), epochSecForDate("1996-12-08")]);
});

test("parseNseTradeRows returns null for empty/non-array payloads", () => {
  assert.equal(parseNseTradeRows(null, "X"), null);
  assert.equal(parseNseTradeRows({}, "X"), null);
  assert.equal(parseNseTradeRows([], "X"), null);
  assert.equal(parseNseTradeRows({ error: "Unexpected end of JSON input" }, "X"), null);
});

test("nseWindows covers the range backward with no gaps or overlaps", () => {
  const DAY = 86_400_000;
  const fromMs = Date.UTC(1996, 0, 1);
  const toMs = Date.UTC(2026, 7, 22);
  const wins = nseWindows(fromMs, toMs);
  assert.ok(wins.length > 100, `expected many windows, got ${wins.length}`);
  /* each window parses and spans <= stepDays */
  for (const w of wins) {
    const [d1, m1, y1] = w.from.split("-").map(Number);
    const [d2, m2, y2] = w.to.split("-").map(Number);
    const a = Date.UTC(y1, m1 - 1, d1);
    const b = Date.UTC(y2, m2 - 1, d2);
    assert.ok(b >= a, "window ordered");
    assert.ok(b - a <= 80 * DAY, "window within cap-safe span");
  }
  /* contiguity: window i's `to` is exactly one day before window i+1's `from` */
  const ms = (s) => {
    const [d, m, y] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  for (let i = 0; i < wins.length - 1; i++) {
    assert.equal(ms(wins[i].from) - ms(wins[i + 1].to), DAY, `gap/overlap at window ${i}`);
  }
  /* boundaries */
  assert.equal(ms(wins[0].to), toMs);
  assert.equal(ms(wins[wins.length - 1].from), fromMs);
});

test("nseWindows handles short and degenerate ranges", () => {
  const fromMs = Date.UTC(2026, 0, 1);
  const toMs = Date.UTC(2026, 1, 15);
  assert.deepEqual(nseWindows(fromMs, toMs).length, 1);
  assert.deepEqual(nseWindows(fromMs, fromMs)[0], { from: "01-01-2026", to: "01-01-2026" });
});

test("fetchNseHistory dedupes overlapping windows and sorts ascending", async () => {
  const calls = [];
  const fakeGetJson = async (url) => {
    calls.push(url);
    if (calls.length === 1) {
      return [nseRow({ mtimestamp: "10-Jan-1996" }), nseRow({ mtimestamp: "09-Jan-1996" })];
    }
    return [nseRow({ mtimestamp: "09-Jan-1996" }), nseRow({ mtimestamp: "02-Jan-1996" })];
  };
  const out = await fetchNseHistory("RELIANCE", {
    fromMs: Date.UTC(1996, 0, 1),
    toMs: Date.UTC(1996, 2, 31),
    getJson: fakeGetJson,
    delayMs: 0,
  });
  assert.equal(out.length, 3, "overlap collapsed by ts");
  assert.deepEqual(out.map((c) => c.ts),
    [epochSecForDate("1996-01-02"), epochSecForDate("1996-01-09"), epochSecForDate("1996-01-10")]);
  assert.ok(calls.length >= 2);
  assert.ok(calls[0].includes("toDate=31-03-1996"), "first window ends at requested end");
});

test("fetchNseHistory survives per-window failures", async () => {
  let n = 0;
  const out = await fetchNseHistory("RELIANCE", {
    fromMs: Date.UTC(1996, 0, 1),
    toMs: Date.UTC(1996, 5, 30),
    getJson: async () => {
      n += 1;
      if (n === 1) throw new Error("boom");
      return [nseRow({ mtimestamp: "02-Jan-1996" })];
    },
    delayMs: 0,
  });
  assert.equal(out.length, 1);
});

test("resolveSymbolItem prefers NSE, strips suffixes, tolerates unknowns", () => {
  const instruments = [
    { s: "RELIANCE", e: "BSE", n: "Reliance Industries Ltd" },
    { s: "RELIANCE", e: "NSE", n: "Reliance Industries Limited" },
  ];
  assert.deepEqual(resolveSymbolItem(instruments, "RELIANCE"),
    { symbol: "RELIANCE", exchange: "NSE", name: "Reliance Industries Limited" });
  assert.deepEqual(resolveSymbolItem(instruments, "reliance.ns"),
    { symbol: "RELIANCE", exchange: "NSE", name: "Reliance Industries Limited" });
  assert.deepEqual(resolveSymbolItem([instruments[0]], "RELIANCE.BO"),
    { symbol: "RELIANCE", exchange: "BSE", name: "Reliance Industries Ltd" });
  assert.deepEqual(resolveSymbolItem([], "NOVA.EQ"),
    { symbol: "NOVA", exchange: "NSE", name: "NOVA" });
});

test("nseYearsUrl encodes the year-index request", () => {
  const url = nseYearsUrl("M&M");
  assert.ok(url.includes("functionName=getHistoricalPeriodicDataYears"));
  assert.ok(url.includes("symbol=M%26M"));
});

test("parseNseFirstYear returns the earliest valid year", () => {
  assert.equal(parseNseFirstYear(["2026", "2025", "2024", "2023"]), 2023);
  assert.equal(parseNseFirstYear(["1996"]), 1996);
});

test("parseNseFirstYear filters junk and clamps to the archive floor", () => {
  /* a stray pre-floor year must not drag discovery below 1996 */
  assert.equal(parseNseFirstYear(["2019", "1980"]), 2019);
  assert.equal(parseNseFirstYear(["19xx", null, {}]), null);
  assert.equal(parseNseFirstYear([]), null);
  assert.equal(parseNseFirstYear(null), null);
  assert.equal(parseNseFirstYear({ error: "boom" }), null);
});

test("REAL WIRE: captured Dec-1996 payload parses end-to-end (format-drift canary)", () => {
  const raw = JSON.parse(
    readFileSync(new URL("./fixtures/nse-trade-reliance-1996-12.json", import.meta.url), "utf8")
  );
  const parsed = parseNseTradeRows(raw, "RELIANCE");
  assert.ok(parsed, "real payload must parse");
  assert.equal(parsed.candles.length, raw.length, "every real row survives");
  /* wire arrives NEWEST-FIRST and the parser preserves order — fetchNseHistory owns sorting */
  const oldest = parsed.candles.at(-1), newest = parsed.candles[0];
  assert.equal(oldest.ts, epochSecForDate("1996-12-02"));
  assert.equal(newest.ts, epochSecForDate("1996-12-31"));
  /* spot-check against values verified live on 2026-08-23 */
  assert.equal(oldest.o, 180.25);
  assert.equal(oldest.c, 180.85);
  assert.equal(newest.c, 206.65);
});
