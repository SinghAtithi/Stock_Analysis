/**
 * TASK-1376 — paper trading book: slippage math, buy/sell fill semantics
 * (cash checks, avg-cost merge, realized P&L), Nifty benchmark anchoring
 * and equity-curve append dedupe.
 *
 * Run: npm test  (from web/)  ·  node --test scripts/tests/paper-book.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  INITIAL_CASH,
  SLIPPAGE_DEFAULT,
  applySlippage,
  appendPoint,
  bookPnlPct,
  equityValue,
  fillOrder,
  loadBook,
  newBook,
  niftyCurve,
  niftyPctNow,
  niftyStartFrom,
  positionUnrealized,
  positionUnrealizedPct,
} from "../../web/src/lib/paperBook.ts";

const DAY = 86_400_000;

const order = (over = {}) => ({
  symbol: "RELIANCE",
  name: "Reliance Industries",
  exchange: "NSE",
  type: "Equity",
  side: "buy",
  qty: 10,
  refPrice: 2400,
  slippagePct: 0.001,
  note: "momentum + earnings tailwind",
  time: 1_700_000_000_000,
  ...over,
});

test("new book starts with ₹10L cash and zero positions/trades", () => {
  const b = newBook();
  assert.equal(b.cash, INITIAL_CASH);
  assert.equal(b.positions.length, 0);
  assert.equal(b.trades.length, 0);
  assert.equal(b.firstTradeAt, null);
  assert.equal(b.slippagePct, SLIPPAGE_DEFAULT);
});

test("slippage: buy fills above ref, sell fills below, 2dp rounding", () => {
  assert.equal(applySlippage(2400, "buy", 0.001), 2402.4);
  assert.equal(applySlippage(2400, "sell", 0.001), 2397.6);
  assert.equal(applySlippage(33.333, "buy", 0.005), 33.5);
});

test("buy deducts cash, creates position at fill price, records trade", () => {
  const b = newBook();
  const res = fillOrder(b, order());
  assert.equal(res.error, null);
  assert.equal(res.book.cash, INITIAL_CASH - 10 * 2402.4);
  assert.equal(res.book.positions.length, 1);
  const p = res.book.positions[0];
  assert.equal(p.symbol, "RELIANCE");
  assert.equal(p.qty, 10);
  assert.equal(p.avgCost, 2402.4);
  assert.equal(res.book.trades.length, 1);
  assert.equal(res.book.firstTradeAt, order().time);
  assert.equal(res.book.trades[0].fillPrice, 2402.4);
  assert.equal(res.book.trades[0].refPrice, 2400);
  assert.equal(res.book.trades[0].realizedPnl, null);
  assert.equal(res.book.trades[0].note, "momentum + earnings tailwind");
});

test("second buy merges into the position with weighted avg cost", () => {
  let b = newBook();
  b = fillOrder(b, order({ qty: 10, refPrice: 2400 })).book;
  b = fillOrder(b, order({ qty: 20, refPrice: 2500, time: 1_700_000_100_000 })).book;
  const p = b.positions[0];
  assert.equal(p.qty, 30);
  assert.equal(p.avgCost, (10 * 2402.4 + 20 * 2502.5) / 30);
  assert.equal(b.trades.length, 2);
});

test("buy with insufficient cash is rejected and mutates nothing", () => {
  const b = newBook();
  const res = fillOrder(b, order({ qty: 1_000_000, refPrice: 1000 }));
  assert.equal(res.error, "not_enough_cash");
  assert.equal(res.trade, null);
  assert.deepEqual(res.book, b);
});

test("sell books realized P&L, partial sell keeps position, full sell removes", () => {
  let b = newBook();
  b = fillOrder(b, order({ qty: 20, refPrice: 2400 })).book;
  const sellFill = 2500 * 0.999;
  const round2 = (v) => Math.round(v * 100) / 100;
  const partial = fillOrder(
    b,
    order({ side: "sell", qty: 5, refPrice: 2500, time: 1_700_000_200_000 }),
  );
  assert.equal(partial.error, null);
  assert.equal(partial.book.positions[0].qty, 15);
  assert.equal(partial.book.positions[0].realizedPnl, round2((sellFill - 2402.4) * 5));
  assert.equal(partial.book.trades[1].realizedPnl, round2((sellFill - 2402.4) * 5));
  assert.equal(partial.book.cash, INITIAL_CASH - 20 * 2402.4 + 5 * sellFill);

  const full = fillOrder(
    partial.book,
    order({ side: "sell", qty: 15, refPrice: 2600, time: 1_700_000_300_000 }),
  );
  assert.equal(full.error, null);
  assert.equal(full.book.positions.length, 0);
  assert.equal(full.book.trades.length, 3);
  assert.equal(
    full.book.cash,
    INITIAL_CASH - 20 * 2402.4 + 5 * sellFill + 15 * (2600 * 0.999),
  );
});

test("sell without a position or above held qty is rejected", () => {
  const b = newBook();
  assert.equal(fillOrder(b, order({ side: "sell", qty: 1 })).error, "no_position");
  let held = newBook();
  held = fillOrder(held, order({ qty: 5 })).book;
  assert.equal(
    fillOrder(held, order({ side: "sell", qty: 6 })).error,
    "qty_exceeds_position",
  );
});

test("indices are not tradable — benchmark only", () => {
  const b = newBook();
  const res = fillOrder(b, order({ symbol: "NIFTY 50", type: "Index" }));
  assert.equal(res.error, "index_not_tradable");
});

test("invalid qty / price are rejected", () => {
  const b = newBook();
  assert.equal(fillOrder(b, order({ qty: 0 })).error, "qty_must_be_positive");
  assert.equal(fillOrder(b, order({ refPrice: 0 })).error, "price_unavailable");
});

test("position unrealized math uses cost basis", () => {
  let b = newBook();
  b = fillOrder(b, order({ qty: 10, refPrice: 1000 })).book;
  const p = b.positions[0];
  assert.equal(positionUnrealized(p, 1100), (1100 - 1001) * 10);
  assert.ok(Math.abs(positionUnrealizedPct(p, 1100) - ((1100 / 1001 - 1) * 100)) < 1e-9);
  assert.equal(positionUnrealized(p, 1001), 0);
});

test("equity value falls back to avg cost when a price is missing", () => {
  let b = newBook();
  b = fillOrder(b, order({ qty: 10, refPrice: 1000 })).book;
  const eq = equityValue(b, new Map());
  assert.equal(eq, b.cash + 10 * 1001);
  const eq2 = equityValue(b, new Map([["RELIANCE", 1200]]));
  assert.equal(eq2, b.cash + 10 * 1200);
  assert.ok(Math.abs(bookPnlPct(eq2) - ((eq2 / INITIAL_CASH - 1) * 100)) < 1e-9);
});

test("nifty start anchors to the last close at or before first trade", () => {
  const candles = [
    { time: 1_700_000_000_000 - 2 * DAY, close: 22000 },
    { time: 1_700_000_000_000 - DAY, close: 22100 },
    { time: 1_700_000_000_000, close: 22200 },
    { time: 1_700_000_000_000 + DAY, close: 22300 },
  ];
  assert.equal(niftyStartFrom(candles, 1_700_000_000_000), 22200);
  assert.equal(niftyStartFrom(candles, 1_700_000_000_000 + 1000), 22200);
  assert.equal(niftyStartFrom(candles, 1_700_000_000_000 - 3 * DAY), 22000);
  assert.equal(niftyStartFrom([], 1_700_000_000_000), null);
});

test("nifty % since first trade uses latest close over anchor", () => {
  const candles = [
    { time: 1_700_000_000_000 - DAY, close: 22000 },
    { time: 1_700_000_000_000, close: 22200 },
    { time: 1_700_000_000_000 + DAY, close: 22300 },
  ];
  assert.equal(niftyPctNow(candles, 22200), (22300 / 22200 - 1) * 100);
  const curve = niftyCurve(candles, 22200);
  assert.equal(curve.length, 3);
  assert.equal(curve[0].pct, (22000 / 22200 - 1) * 100);
});

test("appendPoint dedupes identical rapid checkpoints and caps length", () => {
  let b = newBook();
  b = appendPoint(b, 1_700_000_000_000, 0.02, 0.01);
  b = appendPoint(b, 1_700_000_000_000 + 30_000, 0.02, 0.01);
  assert.equal(b.curve.length, 1);
  b = appendPoint(b, 1_700_000_000_000 + 60_000, 0.021, 0.011);
  assert.equal(b.curve.length, 2);
  b = appendPoint(b, 1_700_000_000_000 + 120_000, 0.021, 0.011);
  assert.equal(b.curve.length, 2);
  b = appendPoint(b, 1_700_000_000_000 + 180_000, 0.022, 0.011);
  assert.equal(b.curve.length, 3);
  for (let i = 0; i < 500; i++) {
    b = appendPoint(b, 1_700_000_000_000 + (i + 1) * 60_000, 1 + i * 0.5, 0.2);
  }
  assert.equal(b.curve.length, 400);
});

test("garbage localStorage payloads fall back to a fresh book", () => {
  const reads = [];
  const store = {
    getItem: (k) => {
      reads.push(k);
      return "not json";
    },
    setItem: () => {},
    removeItem: () => {},
  };
  const orig = globalThis.window;
  globalThis.window = {
    localStorage: store,
  };
  try {
    const b = loadBook();
    assert.equal(reads[0], "niftyterm.paperBook");
    assert.equal(b.cash, INITIAL_CASH);
    assert.equal(b.positions.length, 0);
  } finally {
    if (orig) globalThis.window = orig;
    else delete globalThis.window;
  }
});