import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
import { execFileSync } from "node:child_process";
import { openDb } from "../../scripts/lib/db.mjs";
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
  assert.deepEqual([...ALERT_TYPES], [
    "price_above",
    "price_below",
    "strategy_enter",
    "strategy_exit",
  ]);
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

/* ---------- membership alerts (TASK-59) ---------- */

import { isMembershipType, membershipDiff, membershipEvents } from "../../web/src/lib/alerts.ts";

test("membershipDiff reports entered and exited symbols", () => {
  const prev = ["A", "B", "C", "D"];
  const curr = ["B", "C", "D", "E", "F"];
  const { entered, exited } = membershipDiff(prev, curr);
  assert.deepEqual(entered.sort(), ["E", "F"]);
  assert.deepEqual(exited, ["A"]);
});

test("membershipDiff handles identical lists and empty inputs", () => {
  assert.deepEqual(membershipDiff(["X"], ["X"]), { entered: [], exited: [] });
  assert.deepEqual(membershipDiff([], ["Y"]), { entered: ["Y"], exited: [] });
  assert.deepEqual(membershipDiff(["Z"], []), { entered: [], exited: ["Z"] });
});

test("membershipEvents fires strategy_enter/exit rows for the watched strategy only", () => {
  const rows = [
    row("m1", "strategy_enter", undefined, undefined, "dev-1"), // placeholder shape below
  ];
  void rows;
  const mkRow = (id, type, strategyId) => ({
    id,
    device_id: "device-aaaaaaaa",
    type,
    payload_json: JSON.stringify({ strategyId, topN: 10 }),
  });
  const membership = new Map([
    ["S100", { entered: ["E"], exited: [] }],
    ["S081", { entered: [], exited: ["Q"] }],
  ]);
  const fired = membershipEvents(
    [
      mkRow("m1", "strategy_enter", "S100"),
      mkRow("m2", "strategy_exit", "S100"), // no exits in S100 diff
      mkRow("m3", "strategy_exit", "S081"),
      mkRow("m4", "price_above", "S100"), // price type — not membership lane
    ],
    membership,
    NOW
  );
  assert.equal(fired.length, 2);
  assert.equal(fired[0].id, "m1");
  assert.equal(fired[0].detail, "S100 top-10: entered E");
  assert.equal(fired[1].id, "m3");
});

test("membershipEvents skips unreadable payloads and unknown strategies", () => {
  const membership = new Map([["S100", { entered: ["E"], exited: [] }]]);
  const fired = membershipEvents(
    [
      { id: "x1", device_id: "d", type: "strategy_enter", payload_json: "{oops" },
      mkRowSafe("x2", "strategy_enter", "UNKNOWN"),
    ],
    membership,
    NOW
  );
  assert.equal(fired.length, 0);
});

function mkRowSafe(id, type, strategyId) {
  return {
    id,
    device_id: "device-aaaaaaaa",
    type,
    payload_json: JSON.stringify({ strategyId, topN: 10 }),
  };
}

test("validateAlertInput accepts membership alerts with known strategy and sane topN", () => {
  const known = new Set(["S100"]);
  const good = validateAlertInput(
    { deviceId: "abcd1234-5678", type: "strategy_enter", strategyId: "S100", topN: 15 },
    known
  );
  assert.ok(good.ok);
  if (good.ok) {
    assert.equal(good.value.strategyId, "S100");
    assert.equal(good.value.topN, 15);
    assert.equal(good.value.symbol, undefined);
  }
  // unknown strategy rejected when registry set provided
  const bad = validateAlertInput(
    { deviceId: "abcd1234-5678", type: "strategy_exit", strategyId: "NOPE", topN: 10 },
    known
  );
  assert.equal(bad.ok, false);
  // topN bounds
  for (const topN of [0, -5, 51, 2.5]) {
    const r = validateAlertInput(
      { deviceId: "abcd1234-5678", type: "strategy_enter", strategyId: "S100", topN },
      known
    );
    assert.equal(r.ok, false, String(topN));
  }
});

test("isMembershipType gates the two lanes", () => {
  assert.equal(isMembershipType("strategy_enter"), true);
  assert.equal(isMembershipType("strategy_exit"), true);
  assert.equal(isMembershipType("price_above"), false);
});

/* ---------- CLI evaluator integration (temp DB) ---------- */


test("run-alerts.mjs fires membership alert from snapshot diff in temp DB", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "nifty-alerts-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dbPath = path.join(dir, "alerts.db");

  // seed schema-minimal tables + two differing runs + one active membership alert
  const db = openDb(dbPath);
  db.exec(`CREATE TABLE alerts (id TEXT PRIMARY KEY, device_id TEXT, type TEXT, payload_json TEXT, active INTEGER DEFAULT 1, created_at INTEGER, fired_at INTEGER);
           CREATE TABLE signal_snapshots (strategy_id TEXT, symbol TEXT, rank INTEGER, as_of INTEGER)`);
  db.prepare(`INSERT INTO alerts (id, device_id, type, payload_json, active, created_at)
              VALUES ('a1', 'device-aaaaaaaa', 'strategy_enter', '{"strategyId":"S100","topN":2}', 1, 1)`).run();
  const ins = db.prepare(`INSERT INTO signal_snapshots (strategy_id, symbol, rank, as_of) VALUES ('S100', ?, ?, ?)`);
  for (const [i, s] of ["AAA", "BBB"].entries()) ins.run(s, i + 1, 1000); // prev top2: AAA,BBB
  for (const [i, s] of [["BBB", 1], ["CCC", 2]].entries()) ins.run(s[0], s[1], 2000); // curr top2: BBB,CCC
  db.close();

  const out = execFileSync("node", [
    "--experimental-strip-types",
    path.join(HERE, "..", "run-alerts.mjs"),
  ], {
    env: { ...process.env, NIFTY_DB_PATH: dbPath },
    encoding: "utf8",
  });

  assert.match(out, /1 fired/, "digest reports one fired alert");
  assert.match(out, /entered CCC/, "detail names the entering symbol");

  const after = openDb(dbPath);
  const row = after.prepare("SELECT active, fired_at FROM alerts WHERE id = 'a1'").get();
  after.close();
  assert.equal(row.active, 0, "alert deactivated");
  assert.ok(row.fired_at > 0, "fired_at stamped");
});
