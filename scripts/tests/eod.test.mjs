import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { openDb } from "../lib/db.mjs";
import { applyMigrations } from "../migrate.mjs";
import {
  resolveUniverse,
  NIFTY50_FALLBACK,
  latestTradingDayStart,
  isCurrent,
  parseYahooChart,
  parseMoneycontrolChart,
  parseGrowwChart,
  upsertCandles,
  mergeCorporateActions,
  recomputeAdjFactors,
  epochSecForDate,
  INSTRUMENTS_PATH,
  CORP_ACTIONS_PATH,
  loadCorpActionFeed,
} from "../ingest-eod.mjs";

function tempDb(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "niftyterm-eod-test-"));
  const db = openDb(path.join(dir, "test.db"));
  applyMigrations(db);
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  return { dir, db };
}

function candle(dayOffset, close) {
  return {
    ts: Math.floor(Date.now() / 1000) - dayOffset * 86_400,
    o: close, h: close + 1, l: close - 1, c: close, v: 1000,
  };
}

const TEST_ITEMS = [
  { s: "RELIANCE", n: "RELIANCE INDUSTRIES LTD", e: "NSE", idx: ["NIFTY 50", "NIFTY 500"] },
  { s: "RELIANCE", n: "RELIANCE INDUSTRIES LTD.", e: "BSE", idx: ["NIFTY 50", "NIFTY 500"] },
  { s: "TCS", n: "TATA CONSULTANCY SERVICES LTD", e: "NSE", idx: ["NIFTY 50", "NIFTY 500"] },
  { s: "SOMEMID", n: "SOME MIDCAP CO", e: "NSE", idx: ["NIFTY MIDCAP 150"] },
  { s: "ZZINDEX", n: "NIFTY 50 INDEX", e: "NSE", idx: [] },
];

/* ----- (1) universe resolution ----- */

test("resolveUniverse: nifty50 selects idx members, NSE-preferred, equities only", () => {
  const n50 = resolveUniverse(TEST_ITEMS, "nifty50");
  assert.deepEqual(n50.map((x) => x.symbol).sort(), ["RELIANCE", "TCS"]);
  assert.deepEqual(n50.map((x) => x.exchange), ["NSE", "NSE"], "NSE row preferred over BSE dup");
  assert.ok(n50.every((x) => x.name), "name carried through");
});

test("resolveUniverse: nifty500 superset, midcap excluded, index rows excluded", () => {
  const n500 = resolveUniverse(TEST_ITEMS, "nifty500");
  assert.deepEqual(n500.map((x) => x.symbol).sort(), ["RELIANCE", "TCS"]);
});

test("resolveUniverse: all includes equities without idx", () => {
  const all = resolveUniverse(TEST_ITEMS, "all");
  const syms = all.map((x) => x.symbol).sort();
  assert.deepEqual(syms, ["RELIANCE", "SOMEMID", "TCS"]);
});

test("resolveUniverse: fallback to hardcoded NIFTY 50 when idx flags missing", () => {
  const bare = NIFTY50_FALLBACK.map((s) => ({ s, n: `${s} CO`, e: "NSE" }));
  const n50 = resolveUniverse(bare, "nifty50");
  assert.equal(n50.length, NIFTY50_FALLBACK.length, "full 50 fallback list");
  assert.deepEqual(n50.map((x) => x.symbol).sort(), [...NIFTY50_FALLBACK].sort());
});

/* ----- (2) parsers ----- */

test("parseYahooChart: candles + split/dividend events", () => {
  const t0 = 1_700_000_000;
  const payload = {
    chart: { result: [{
      timestamp: [t0, t0 + 86_400],
      indicators: { quote: [{ open: [100, 110], high: [101, 111], low: [99, 109], close: [100.5, 110.5], volume: [10, 20] }] },
      events: {
        splits: { [t0 + 86_400]: { numerator: 2, denominator: 1 } },
        dividends: { [t0]: { amount: 8 } },
      },
    }] },
  };
  const { candles, actions } = parseYahooChart(payload, "RELIANCE.NS");
  assert.equal(candles.length, 2);
  assert.equal(candles[1].c, 110.5);
  assert.equal(actions.length, 2);
  const split = actions.find((a) => a.type === "split");
  assert.equal(split.ratio, 2);
  assert.equal(split.symbol, "RELIANCE.NS");
});

test("parseYahooChart: null on missing candles, drops NaN/null rows", () => {
  assert.equal(parseYahooChart({ chart: { result: [] } }, "X.NS"), null);
  assert.equal(parseYahooChart({}, "X.NS"), null);
  const payload = {
    chart: { result: [{
      timestamp: [1_700_000_000],
      indicators: { quote: [{ open: [null], high: [1], low: [1], close: [1] }] },
    }] },
  };
  assert.equal(parseYahooChart(payload, "X.NS"), null, "null OHLC row dropped");
});

test("parseMoneycontrolChart: t/o/h/l/c/v arrays", () => {
  const payload = {
    s: "ok", t: [1_700_000_000], o: [100], h: [101], l: [99], c: [100.5], v: [5],
  };
  const { candles } = parseMoneycontrolChart(payload, "RELIANCE");
  assert.equal(candles.length, 1);
  assert.equal(candles[0].c, 100.5);
  assert.equal(parseMoneycontrolChart({ s: "no_data" }, "RELIANCE"), null);
});

test("parseGrowwChart: ms timestamps converted to seconds", () => {
  const payload = { candles: [[1_700_000_000_000, 100, 101, 99, 100.5, 5]] };
  const { candles } = parseGrowwChart(payload, "RELIANCE");
  assert.equal(candles[0].ts, 1_700_000_000);
  assert.equal(candles[0].c, 100.5);
  assert.equal(parseGrowwChart({ candles: "nope" }, "RELIANCE"), null);
});

/* ----- (3) upsert idempotency ----- */

test("upsertCandles: insert twice, count unchanged, values updated", (t) => {
  const { db } = tempDb(t);
  const rows = [candle(1, 100), candle(2, 105), candle(3, 110)];
  assert.equal(upsertCandles(db, "RELIANCE.NS", rows), 3);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM eod_candles").get().n, 3);

  const rows2 = [candle(1, 99), candle(2, 104), candle(3, 109), candle(4, 115)];
  assert.equal(upsertCandles(db, "RELIANCE.NS", rows2), 4);
  const n = db.prepare("SELECT COUNT(*) AS n FROM eod_candles").get().n;
  assert.equal(n, 4, "no duplicate rows after re-ingest");
  const overwritten = db.prepare("SELECT c FROM eod_candles WHERE symbol = ? AND ts = ?").get("RELIANCE.NS", rows2[0].ts);
  assert.equal(overwritten.c, 99, "overlapping candle updated (was 100)");
  const oldest = db.prepare("SELECT c FROM eod_candles WHERE symbol = ? ORDER BY ts ASC LIMIT 1").get("RELIANCE.NS");
  assert.equal(oldest.c, 115, "non-overlapping candle 4 inserted");
});

/* ----- (4) resume logic ----- */

test("isCurrent: skips when last candle is on the latest trading day, else refetches", (t) => {
  const { db } = tempDb(t);
  const nowMs = Date.now();
  const fresh = latestTradingDayStart(nowMs) + 3600;
  upsertCandles(db, "TCS.NS", [{ ts: fresh, o: 1, h: 1, l: 1, c: 1, v: 1 }]);
  assert.equal(isCurrent(db, "TCS.NS", nowMs), true, "fresh candle -> skip");

  const staleTs = latestTradingDayStart(nowMs) - 30 * 86_400;
  upsertCandles(db, "INFY.NS", [{ ts: staleTs, o: 1, h: 1, l: 1, c: 1, v: 1 }]);
  assert.equal(isCurrent(db, "INFY.NS", nowMs), false, "stale candle -> refetch");
  assert.equal(isCurrent(db, "MISSING.NS", nowMs), false, "no data -> refetch");
});

test("latestTradingDayStart: lands on a weekday", () => {
  const d = new Date((latestTradingDayStart(Date.now()) + 5.5 * 3600) * 1000);
  const day = d.getUTCDay();
  assert.ok(day >= 1 && day <= 5, `expected Mon-Fri, got ${day}`);
});

/* ----- (5) split adjustment ----- */

test("recomputeAdjFactors: 2:1 split applies factor on/after ex-date", (t) => {
  const { db } = tempDb(t);
  const splitDay = epochSecForDate("2024-06-21");
  const candles = [
    { ts: splitDay - 2 * 86_400, o: 100, h: 101, l: 99, c: 100, v: 1 },
    { ts: splitDay - 86_400, o: 100, h: 101, l: 99, c: 100, v: 1 },
    { ts: splitDay, o: 50, h: 51, l: 49, c: 50, v: 1 },
    { ts: splitDay + 86_400, o: 50, h: 51, l: 49, c: 50, v: 1 },
  ];
  upsertCandles(db, "RELIANCE.NS", candles);
  mergeCorporateActions(db, [{
    symbol: "RELIANCE.NS", type: "split", date: "2024-06-21", ratio: 2,
    raw: { source: "test" },
  }]);
  recomputeAdjFactors(db, "RELIANCE.NS");

  const rows = db.prepare("SELECT ts, c, adj_factor FROM eod_candles WHERE symbol = ? ORDER BY ts").all("RELIANCE.NS");
  assert.equal(rows[0].adj_factor, 1, "pre-ex-date factor stays 1");
  assert.equal(rows[1].adj_factor, 1);
  assert.equal(rows[2].adj_factor, 2, "on ex-date factor doubles");
  assert.equal(rows[3].adj_factor, 2, "post-ex-date factor doubled");
  assert.ok(Math.abs(rows[0].c * rows[0].adj_factor - rows[2].c * rows[2].adj_factor) < 1e-9,
    "adjusted series continuous across the split (100*1 == 50*2)");
});

test("recomputeAdjFactors: chained splits compose (2:1 then 5:1 -> 10)", (t) => {
  const { db } = tempDb(t);
  const d1 = epochSecForDate("2020-01-01");
  const d2 = epochSecForDate("2024-06-21");
  upsertCandles(db, "TCS.NS", [
    { ts: d1 - 86_400, o: 1, h: 1, l: 1, c: 1, v: 1 },
    { ts: d1, o: 1, h: 1, l: 1, c: 1, v: 1 },
    { ts: d2, o: 1, h: 1, l: 1, c: 1, v: 1 },
    { ts: d2 + 86_400, o: 1, h: 1, l: 1, c: 1, v: 1 },
  ]);
  mergeCorporateActions(db, [
    { symbol: "TCS.NS", type: "split", date: "2020-01-01", ratio: 2, raw: { source: "test" } },
    { symbol: "TCS.NS", type: "split", date: "2024-06-21", ratio: 5, raw: { source: "test" } },
  ]);
  recomputeAdjFactors(db, "TCS.NS");
  const rows = db.prepare("SELECT ts, adj_factor FROM eod_candles WHERE symbol = ? ORDER BY ts").all("TCS.NS");
  assert.equal(rows[0].adj_factor, 1);
  assert.equal(rows[1].adj_factor, 2);
  assert.equal(rows[2].adj_factor, 10, "2*5 composes");
  assert.equal(rows[3].adj_factor, 10);
});

test("recomputeAdjFactors: idempotent re-run (late-arriving events spec)", (t) => {
  const { db } = tempDb(t);
  const d = epochSecForDate("2024-06-21");
  upsertCandles(db, "HDFCBANK.NS", [
    { ts: d - 86_400, o: 1, h: 1, l: 1, c: 1, v: 1 },
    { ts: d, o: 1, h: 1, l: 1, c: 1, v: 1 },
  ]);
  mergeCorporateActions(db, [{ symbol: "HDFCBANK.NS", type: "split", date: "2024-06-21", ratio: 2, raw: {} }]);
  recomputeAdjFactors(db, "HDFCBANK.NS");
  recomputeAdjFactors(db, "HDFCBANK.NS");
  const rows = db.prepare("SELECT adj_factor FROM eod_candles WHERE symbol = ? ORDER BY ts").all("HDFCBANK.NS");
  assert.deepEqual(rows.map((r) => r.adj_factor), [1, 2], "re-run does not compound");
});

/* ----- (6) feed + date helpers ----- */

test("loadCorpActionFeed: parses T11 feed JSON", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "niftyterm-eod-feed-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "corporate_actions.json");
  writeFileSync(file, JSON.stringify([{ symbol: "RELIANCE.NS", type: "split", date: "2024-06-21", ratio: 2 }]));
  const orig = CORP_ACTIONS_PATH;
  const feed = loadCorpActionFeed();
  assert.ok(Array.isArray(feed));
});

test("epochSecForDate: ISO date -> 00:00 IST epoch seconds", () => {
  const ts = epochSecForDate("2024-06-21");
  const d = new Date((ts + 5.5 * 3600) * 1000);
  assert.equal(d.getUTCFullYear(), 2024);
  assert.equal(d.getUTCMonth(), 5);
  assert.equal(d.getUTCDate(), 21);
  assert.equal(new Date(ts * 1000).getUTCHours(), 18, "18:30 UTC == 00:00 IST");
});
