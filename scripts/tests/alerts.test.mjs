import test from "node:test";
import assert from "node:assert/strict";
import {
  crossFired,
  validateAlertInput,
  evaluatePass,
  ALERT_TYPES,
} from "../../web/src/lib/alerts.ts";

/* ---------- crossFired ---------- */

test("price_above fires at and above the threshold", () => {
  assert.equal(crossFired("price_above", 100, 99.99), false);
  assert.equal(crossFired("price_above", 100, 100), true);
  assert.equal(crossFired("price_above", 100, 250), true);
});

test("price_below fires at and below the threshold", () => {
  assert.equal(crossFired("price_below", 100, 100.01), false);
  assert.equal(crossFired("price_below", 100, 100), true);
  assert.equal(crossFired("price_below", 100, 42), true);
});

test("non-finite current price never fires", () => {
  assert.equal(crossFired("price_above", 100, NaN), false);
  assert.equal(crossFired("price_above", 100, Infinity), false);
  assert.equal(crossFired("price_above", 100, Number.NaN), false);
});

/* ---------- validateAlertInput ---------- */

const base = {
  deviceId: "abcd1234-5678",
  symbol: "reliance",
  exchange: "nse",
  type: "price_above",
  price: "2500.50",
};

test("valid input is normalized (symbol/exchange uppercased, price numeric)", () => {
  const r = validateAlertInput(base);
  assert.ok(r.ok);
  if (r.ok) {
    assert.deepEqual(r.value, {
      deviceId: "abcd1234-5678",
      symbol: "RELIANCE",
      exchange: "NSE",
      type: "price_above",
      price: 2500.5,
    });
  }
});

test("defaults exchange to NSE", () => {
  const r = validateAlertInput({ ...base, exchange: undefined });
  assert.ok(r.ok);
});

test("rejects bad device ids, symbols, types, and prices", () => {
  for (const bad of [
    { ...base, deviceId: "short" },
    { ...base, deviceId: "" },
    { ...base, symbol: "<script>" },
    { ...base, symbol: "" },
    { ...base, type: "email_me" },
    { ...base, price: -1 },
    { ...base, price: 0 },
    { ...base, price: "abc" },
    null,
  ]) {
    const r = validateAlertInput(bad);
    assert.equal(r.ok, false, JSON.stringify(bad));
  }
});

test("alert type list is closed", () => {
  assert.deepEqual([...ALERT_TYPES], ["price_above", "price_below"]);
});

/* ---------- evaluatePass ---------- */

const NOW = 1_787_484_000;
const row = (id, type, symbol, price, deviceId = "device-aaaaaaaa") => ({
  id,
  device_id: deviceId,
  type,
  payload_json: JSON.stringify({ symbol, exchange: "NSE", price }),
});

test("evaluatePass fires crosses and skips non-tape symbols", () => {
  const prices = new Map([
    ["RELIANCE", 1400],
    ["TCS", 2302],
  ]);
  const fired = evaluatePass(
    [
      row("a1", "price_below", "RELIANCE", 999999), // fires (1400 <= 999999)
      row("a2", "price_above", "TCS", 5000),        // not yet
      row("a3", "price_below", "OFFTAPE", 10),      // no price this pass
      row("a4", "price_below", "TCS", 0),           // invalid target (<=0)
      { id: "a5", device_id: "d", type: "price_below", payload_json: "{broken" },
    ],
    prices,
    NOW
  );
  assert.equal(fired.length, 1);
  assert.equal(fired[0].id, "a1");
  assert.equal(fired[0].symbol, "RELIANCE");
  assert.equal(fired[0].price, 1400);
  assert.equal(fired[0].firedAt, NOW);
});

test("evaluatePass is case-insensitive on tape symbols", () => {
  const prices = new Map([["RELIANCE", 100]]);
  const fired = evaluatePass([row("b1", "price_above", "reliance", 50)], prices, NOW);
  assert.equal(fired.length, 1);
});
