import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  yahooToPayload,
  parseGoogleFinance,
  googleToPayload,
  mcHistoryCandles,
  previousCloseFromCandles,
  distinctTradingDays,
  dayChange,
} from "../../web/src/lib/marketData.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fx = (name) =>
  JSON.parse(readFileSync(path.join(HERE, "fixtures/marketdata", name), "utf8"));

/* ---------- yahooToPayload ---------- */

test("yahooToPayload maps a real captured v8 chart response end-to-end", () => {
  const raw = fx("yahoo-reliance-1d-5m.json");
  const result = raw.chart.result[0];
  const p = yahooToPayload(result, "1d", "5m");

  assert.ok(p, "payload built");
  assert.equal(p.source, "yahoo");
  assert.equal(p.symbol, result.meta.symbol);
  assert.equal(p.name, result.meta.shortName ?? result.meta.longName);
  assert.equal(p.exchange, result.meta.exchangeName);
  assert.equal(p.currency, String(result.meta.currency ?? "INR"));
  assert.equal(p.range, "1d");
  assert.equal(p.interval, "5m");

  /* every mapped candle has finite OHLC; timestamps come straight from the
     upstream array order */
  assert.ok(p.candles.length > 0);
  const q = result.indicators.quote[0];
  let expected = 0;
  for (let i = 0; i < result.timestamp.length; i++) {
    const ok =
      [q.open, q.high, q.low, q.close].every(
        (arr) => typeof arr[i] === "number" && Number.isFinite(arr[i])
      );
    if (ok) expected++;
  }
  assert.equal(p.candles.length, expected);
  p.candles.forEach((c, i) => {
    if (i > 0) assert.ok(c.time >= p.candles[i - 1].time, "time monotonic");
    [c.open, c.high, c.low, c.close].forEach((v) => assert.ok(Number.isFinite(v)));
    assert.ok(Number.isFinite(c.volume), "volume numeric");
  });

  /* header fields derive from meta */
  assert.equal(p.previousClose, result.meta.previousClose ?? null);
  assert.equal(
    p.regularMarketPrice,
    result.meta.regularMarketPrice ?? p.candles.at(-1).close
  );

  /* change math matches dayChange(price, prevClose) */
  const price = result.meta.regularMarketPrice;
  const prev = result.meta.previousClose;
  if (typeof price === "number" && typeof prev === "number" && prev !== 0) {
    assert.ok(Math.abs(p.change - (price - prev)) < 1e-9);
    assert.ok(Math.abs(p.changePct - ((price - prev) / prev) * 100) < 1e-9);
  }
});

test("yahooToPayload drops null-OHLC bars and defaults volume to 0", () => {
  const result = {
    meta: { symbol: "X.NS", regularMarketPrice: 12, previousClose: 10 },
    timestamp: [100, 200, 300],
    indicators: {
      quote: [
        {
          open: [1, null, 3],
          high: [2, null, 4],
          low: [0.5, null, 2],
          close: [1.5, null, 3.5],
          volume: [10],
        },
      ],
    },
  };
  const p = yahooToPayload(result, "1d", "5m");
  assert.equal(p.candles.length, 2, "only finite-OHLC rows survive");
  assert.deepEqual(p.candles.map((c) => c.time), [100, 300]);
  assert.equal(p.candles[0].volume, 10);
  assert.equal(p.candles[1].volume, 0, "missing volume entry -> 0");
});

test("yahooToPayload falls back to last close and candle time when meta is thin", () => {
  const result = {
    meta: {},
    timestamp: [100, 200],
    indicators: {
      quote: [{ open: [1, 1], high: [2, 2], low: [1, 1], close: [2, 3] }],
    },
  };
  const p = yahooToPayload(result, "5d", "1d");
  assert.equal(p.regularMarketPrice, 3);
  assert.equal(p.regularMarketTime, 200);
  assert.equal(p.previousClose, null);
  assert.equal(p.change, null);
  assert.equal(p.changePct, null);
  assert.equal(p.currency, "INR", "currency default");
});

test("yahooToPayload returns null when nothing survives filtering", () => {
  assert.equal(yahooToPayload({ meta: {}, timestamp: [], indicators: { quote: [{}] } }, "1d", "5m"), null);
  assert.equal(
    yahooToPayload(
      {
        meta: {},
        timestamp: [1],
        indicators: { quote: [{ open: [null], high: [null], low: [null], close: [null] }] },
      },
      "1d",
      "5m"
    ),
    null
  );
});

/* ---------- mcHistoryCandles ---------- */

test("mcHistoryCandles parses the real captured techCharts history payload", () => {
  const raw = fx("mc-reliance-5m.json");
  assert.equal(raw.s, "ok");
  const candles = mcHistoryCandles(raw);

  assert.equal(candles.length, raw.t.length);
  assert.equal(candles[0].time, raw.t[0]);
  assert.equal(candles[0].open, raw.o[0]);
  assert.equal(candles[0].high, raw.h[0]);
  assert.equal(candles[0].low, raw.l[0]);
  assert.equal(candles[0].close, raw.c[0]);
  assert.equal(candles[0].volume, raw.v[0]);
  const lastIdx = raw.t.length - 1;
  assert.equal(candles[lastIdx].close, raw.c[lastIdx]);
  candles.forEach((c) => {
    [c.open, c.high, c.low, c.close].forEach((v) => assert.ok(Number.isFinite(v)));
  });
});

test("mcHistoryCandles rejects error bodies and short arrays", () => {
  assert.equal(mcHistoryCandles({ s: "error", errmsg: "Invalid request.Wrong symbol" }), null);
  assert.equal(mcHistoryCandles({ s: "ok" }), null, "no arrays");
  assert.equal(mcHistoryCandles({ s: "ok", t: [], c: [] }), null, "empty arrays");
  assert.equal(mcHistoryCandles({ s: "ok", t: [1], o: [] }), null, "c missing");
});

test("mcHistoryCandles drops bars whose OHLC is non-finite (short companion arrays)", () => {
  const data = {
    s: "ok",
    t: [1, 2, 3],
    o: [1, 2],
    h: [2, 3],
    l: [0.5, 1.5],
    c: [1.5, 2.5],
    v: [10, 20],
  };
  const candles = mcHistoryCandles(data);
  assert.equal(candles.length, 2, "bar without OHLC entry is filtered");
  assert.deepEqual(candles.map((c) => c.time), [1, 2]);
  assert.equal(candles[1].volume, 20);
  assert.equal(mcHistoryCandles({ s: "ok", t: [1], o: [NaN], h: [1], l: [1], c: [1] }), null);
});

/* ---------- parseGoogleFinance / googleToPayload ---------- */

const GOOGLE_FIXTURE = "google-reliance-nse.json";

test("parseGoogleFinance extracts quote + series from the real captured page blocks", () => {
  const { html } = fx(GOOGLE_FIXTURE);
  const parsed = parseGoogleFinance(html, "RELIANCE", "NSE");

  assert.ok(parsed, "parsed");
  assert.equal(parsed.quote.name, "Reliance Industries Ltd");
  assert.equal(parsed.quote.prevClose, 1313.2);

  const byInterval = new Map(parsed.series.map((s) => [s.intervalSec, s]));
  const fiveMin = byInterval.get(300);
  const daily = byInterval.get(86400);
  assert.ok(fiveMin, "intraday series present");
  assert.ok(daily, "daily series present");
  assert.equal(fiveMin.candles.length, 74);
  assert.ok(daily.candles.length > 0);

  /* candle shape: ISO instant -> epoch seconds, OHLC finite, volume default */
  fiveMin.candles.forEach((c) => {
    [c.open, c.high, c.low, c.close].forEach((v) => assert.ok(Number.isFinite(v)));
    assert.ok(Number.isInteger(c.time));
  });
  assert.ok(fiveMin.candles.every((c, i) => i === 0 || c.time >= fiveMin.candles[i - 1].time));

  const first = fiveMin.candles[0];
  const roundTripped = new Date(first.time * 1000).toISOString().includes("T");
  assert.ok(roundTripped, "times are epoch seconds");
});

test("parseGoogleFinance ignores other tickers and malformed input", () => {
  const { html } = fx(GOOGLE_FIXTURE);
  assert.equal(parseGoogleFinance(html, "TCS", "NSE"), null, "unmatched ticker");
  assert.equal(parseGoogleFinance("", "RELIANCE", "NSE"), null, "empty html");
  assert.equal(parseGoogleFinance("<html>no data blocks</html>", "RELIANCE", "NSE"), null);
  /* broken JSON inside a block must be skipped, not thrown */
  assert.equal(
    parseGoogleFinance(
      "<script>AF_initDataCallback({key: 'ds:7', data:[[[broken]], sideChannel});</script>",
      "RELIANCE",
      "NSE"
    ),
    null
  );
});

test("googleToPayload prefers the 5m series for 1d and keeps quote prevClose", () => {
  const { html } = fx(GOOGLE_FIXTURE);
  const parsed = parseGoogleFinance(html, "RELIANCE", "NSE");
  const p = googleToPayload(parsed, "RELIANCE", "NSE", false, "1d", "1d");

  assert.ok(p);
  assert.equal(p.source, "google");
  assert.equal(p.interval, "5m", "five-minute series selected");
  assert.equal(p.range, "1d");
  assert.equal(p.degraded, undefined);
  assert.equal(p.previousClose, 1313.2, "quote-level prevClose wins");
  assert.equal(p.name, "Reliance Industries Ltd");
  assert.equal(p.fullExchangeName, "National Stock Exchange");
  assert.equal(p.currency, "INR");

  const fiveMin = parsed.series.find((s) => s.intervalSec === 300);
  assert.deepEqual(p.candles, fiveMin.candles);
  assert.equal(p.regularMarketTime, fiveMin.candles.at(-1).time);
  assert.equal(p.regularMarketPrice, fiveMin.candles.at(-1).close);
});

test("googleToPayload degrades to daily when no intraday series exists", () => {
  const { html } = fx(GOOGLE_FIXTURE);
  const parsed = parseGoogleFinance(html, "RELIANCE", "NSE");
  const dailyOnly = { quote: parsed.quote, series: parsed.series.filter((s) => s.intervalSec === 86400) };

  const d1 = googleToPayload(dailyOnly, "RELIANCE", "NSE", false, "1d", "5m");
  assert.ok(d1);
  assert.equal(d1.interval, "1d");
  assert.equal(d1.degraded, "daily");
  assert.equal(d1.candles.length, 2, "1d uses last two daily candles");

  const d5 = googleToPayload(dailyOnly, "RELIANCE", "NSE", false, "5d", "5m");
  assert.ok(d5);
  assert.equal(d5.interval, "1d");
  assert.equal(d5.degraded, "daily");
  assert.ok(d5.candles.length <= 6, "5d slices six daily candles");

  const noneOnly = { quote: parsed.quote, series: [] };
  assert.equal(googleToPayload(noneOnly, "RELIANCE", "NSE", false, "1d", "5m"), null);
});

test("googleToPayload skips malformed rows instead of crashing", () => {
  const parsed = {
    quote: { name: "X", prevClose: 100 },
    series: [
      {
        intervalSec: 900,
        candles: [
          { time: 1000, open: 10, high: 11, low: 9, close: 10.5, volume: 5 },
          { time: 1300, open: 10.5, high: 12, low: 10, close: 11, volume: 0 },
        ],
      },
    ],
  };
  const p = googleToPayload(parsed, "RELIANCE", "NSE", false, "5d", "15m");
  assert.ok(p, "well-formed series passes through");
  assert.equal(p.candles.length, 2);
  assert.equal(p.changePct !== null, true, "prevClose available -> pct derived");
});

/* ---------- previousCloseFromCandles / distinctTradingDays / dayChange ---------- */

/* IST is UTC+05:30, so an IST trading date spans 03:30Z -> 18:29Z.
   Bars below straddle IST midnights deterministically. */
const T = (y, mo, d, h, mi) => Math.floor(Date.UTC(y, mo - 1, d, h, mi) / 1000);
const bar = (time, close) => ({ time, open: close - 1, high: close + 1, low: close - 2, close, volume: 0 });

test("previousCloseFromCandles walks back past the IST day boundary", () => {
  /* Aug 20 IST session (09:15 & 15:15 IST) followed by Aug 21 first bar */
  const candles = [
    bar(T(2026, 8, 20, 3, 45), 100),
    bar(T(2026, 8, 20, 9, 45), 110),
    bar(T(2026, 8, 21, 3, 45), 108),
  ];
  assert.equal(previousCloseFromCandles(candles), 110, "last bar of the prior IST day");
});

test("previousCloseFromCandles treats late-UTC bars as one IST day", () => {
  /* 20:00Z Aug 20 = 01:30 IST Aug 21; 23:50Z Aug 20 = 05:20 IST Aug 21 ->
     same IST calendar day, so there is no previous day */
  const candles = [bar(T(2026, 8, 20, 20, 0), 100), bar(T(2026, 8, 20, 23, 50), 90)];
  assert.equal(previousCloseFromCandles(candles), null);
});

test("previousCloseFromCandles edge cases", () => {
  assert.equal(previousCloseFromCandles([]), null);
  assert.equal(previousCloseFromCandles([bar(T(2026, 8, 20, 5, 0), 100)]), null);
  assert.equal(
    previousCloseFromCandles([bar(T(2026, 8, 20, 5, 0), 100), bar(T(2026, 8, 20, 6, 0), 101)]),
    null,
    "same IST day -> no previous close"
  );
  assert.equal(
    previousCloseFromCandles([bar(T(2026, 8, 19, 5, 0), 99), bar(T(2026, 8, 20, 5, 0), 101)]),
    99
  );
});

test("distinctTradingDays counts unique IST sessions", () => {
  const candles = [
    bar(T(2026, 8, 20, 4, 0), 1),
    bar(T(2026, 8, 20, 17, 0), 2),
    bar(T(2026, 8, 20, 18, 0), 3),
    bar(T(2026, 8, 21, 4, 0), 4),
    bar(T(2026, 8, 21, 5, 0), 5),
  ];
  /* Aug 20 17:00Z/18:00Z fall on IST Aug 20 (22:30/23:30) -> still 2 days */
  assert.equal(distinctTradingDays(candles), 2);
  assert.equal(distinctTradingDays([]), 0);
});

test("dayChange computes absolute and percentage change, null-safe", () => {
  assert.deepEqual(dayChange(105, 100), { change: 5, changePct: 5 });
  assert.ok(Math.abs(dayChange(99, 110).changePct - (-11 / 110) * 100) < 1e-12);
  assert.deepEqual(dayChange(null, 100), { change: null, changePct: null });
  assert.deepEqual(dayChange(105, null), { change: null, changePct: null });
  assert.deepEqual(dayChange(105, 0), { change: null, changePct: null });
});
