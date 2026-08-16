/* analyst.test.mjs — T12 tests: derived flattening, revision-delta math, upsert logic.
 * Run: node --test scripts/tests/  (or npm test from web/)
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../lib/db.mjs";
import { applyMigrations } from "../migrate.mjs";
import {
  flattenDerived,
  pctChange,
  buildUniverse,
  runIngest,
  FRESH_SECONDS,
} from "../ingest-analyst.mjs";

const FULL_FIXTURE = {
  quoteSummary: {
    result: [
      {
        recommendationTrend: {
          trend: [
            {
              period: "0m",
              strongBuy: { raw: 4 },
              buy: { raw: 6 },
              hold: { raw: 2 },
              sell: { raw: 1 },
              strongSell: { raw: 0 },
              numberOfAnalystOpinions: { raw: 13 },
            },
          ],
        },
        financialData: {
          targetMeanPrice: { raw: 3200 },
          targetHighPrice: { raw: 3500 },
          targetLowPrice: { raw: 2700 },
          currentPrice: { raw: 3000 },
          recommendationMean: { raw: 1.9 },
          recommendationKey: "buy",
          numberOfAnalystOpinions: { raw: 13 },
        },
        earningsTrend: {
          trend: [
            {
              period: "0q",
              periodEndDate: "2027-03-31",
              growth: { raw: 0.14 },
              epsEstimate: {
                avg: { raw: 148.2 },
                low: { raw: 140 },
                high: { raw: 155 },
                yearAgoEps: { raw: 130.1 },
                numberOfAnalysts: { raw: 12 },
                growth: { raw: 0.14 },
              },
              epsTrend: {
                current: { raw: 100 },
                "7dAgo": { raw: 90 },
                "30dAgo": { raw: 80 },
                "90dAgo": { raw: 70 },
              },
            },
          ],
        },
      },
    ],
  },
};

const FAKE_FETCH = async () => FULL_FIXTURE;

function memoryDb() {
  const db = openDb(":memory:");
  applyMigrations(db);
  return db;
}

function makeInstruments(syms) {
  return syms.map((s) => ({ s, n: s, e: "NSE", idx: ["NIFTY 50"] }));
}

/* ---------- (a) derived_json flattening ---------- */

test("flattenDerived: full fixture produces expected values", () => {
  const d = flattenDerived(FULL_FIXTURE);
  assert.deepEqual(d.rating, {
    strongBuy: 4,
    buy: 6,
    hold: 2,
    sell: 1,
    strongSell: 0,
    total: 13,
    rawScore: (5 * 4 + 4 * 6 + 3 * 2 + 2 * 1) / 13,
  });
  assert.equal(d.ratingMean, 1.9);
  assert.equal(d.recommendationKey, "buy");
  assert.equal(d.numberOfAnalystOpinions, 13);
  assert.equal(d.targetMeanPrice, 3200);
  assert.equal(d.targetHighPrice, 3500);
  assert.equal(d.targetLowPrice, 2700);
  assert.equal(d.currentPrice, 3000);
  assert.ok(Math.abs(d.targetUpsidePct - 6.6667) < 1e-3);
  assert.equal(d.revisionTrend.period, "0q");
  assert.equal(d.revisionTrend.periodEndDate, "2027-03-31");
  assert.equal(d.revisionTrend.growthEstimate, 0.14);
  assert.equal(d.revisionTrend.epsEstimate.avg, 148.2);
  assert.equal(d.revisionTrend.epsEstimate.numberOfAnalysts, 12);
  assert.ok(Math.abs(d.revisionTrend.epsRev7dPct - 11.1111) < 1e-3);
  assert.ok(Math.abs(d.revisionTrend.epsRev30dPct - 25) < 1e-3);
  assert.ok(Math.abs(d.revisionTrend.epsRev90dPct - 42.8571) < 1e-3);
});

test("flattenDerived: missing modules -> nulls, no throws", () => {
  assert.deepEqual(flattenDerived({ quoteSummary: { result: [{}] } }), {
    rating: null,
    ratingMean: null,
    numberOfAnalystOpinions: null,
    recommendationKey: null,
    targetMeanPrice: null,
    targetHighPrice: null,
    targetLowPrice: null,
    currentPrice: null,
    targetUpsidePct: null,
    revisionTrend: null,
  });
  assert.deepEqual(flattenDerived({ quoteSummary: { result: [] } }), flattenDerived({}));
  assert.deepEqual(flattenDerived(null), flattenDerived({}));
  /* partial modules: rating without a full set must not invent a score */
  const partial = flattenDerived({
    quoteSummary: {
      result: [{ financialData: { targetMeanPrice: { raw: 200 }, currentPrice: { raw: 100 } } }],
    },
  });
  assert.equal(partial.rating, null);
  assert.equal(partial.targetUpsidePct, 100);
  assert.equal(partial.revisionTrend, null);
});

/* ---------- (b) revision-delta math ---------- */

test("pctChange: math, zero-denominator and missing -> null", () => {
  assert.ok(Math.abs(pctChange(110, 100) - 10) < 1e-9);
  assert.ok(Math.abs(pctChange(90, 100) + 10) < 1e-9);
  assert.ok(Math.abs(pctChange(100, 0)) < 0.0001); /* null -> cannot compare */
  assert.equal(pctChange(100, 0), null);
  assert.equal(pctChange(null, 50), null);
  assert.equal(pctChange(50, null), null);
  assert.equal(pctChange(null, null), null);
});

test("revision deltas use epsTrend current vs 7d/30d/90d ago", () => {
  const d = flattenDerived({
    quoteSummary: {
      result: [
        {
          earningsTrend: {
            trend: [
              {
                period: "0q",
                epsTrend: {
                  current: { raw: 100 },
                  "7dAgo": { raw: 90 },
                  "30dAgo": { raw: 80 },
                  "90dAgo": { raw: 70 },
                },
              },
            ],
          },
        },
      ],
    },
  });
  assert.ok(Math.abs(d.revisionTrend.epsRev7dPct - 11.1111) < 1e-3);
  assert.ok(Math.abs(d.revisionTrend.epsRev30dPct - 25) < 1e-3);
  assert.ok(Math.abs(d.revisionTrend.epsRev90dPct - 42.8571) < 1e-3);
  /* flat revisions -> 0%, not null */
  const flat = flattenDerived({
    quoteSummary: {
      result: [
        {
          earningsTrend: {
            trend: [
              { epsTrend: { current: { raw: 100 }, "7dAgo": { raw: 100 } } },
            ],
          },
        },
      ],
    },
  });
  assert.equal(flat.revisionTrend.epsRev7dPct, 0);
  assert.equal(flat.revisionTrend.epsRev30dPct, null);
});

/* ---------- (c) upsert logic: fresh skip, --force refetch ---------- */

test("ingest: fetch once, skip fresh row, refetch on --force", async () => {
  const db = memoryDb();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return FULL_FIXTURE;
  };
  const instruments = makeInstruments(["RELIANCE"]);

  const s1 = await runIngest(db, {
    universe: "nifty50",
    instruments,
    fetchImpl,
    cacheDir: null,
    delayMs: 0,
  });
  assert.equal(s1.fetched.length, 1);
  assert.equal(calls, 1);

  /* second run: row is fresh -> skipped, no fetch */
  const s2 = await runIngest(db, {
    universe: "nifty50",
    instruments,
    fetchImpl,
    cacheDir: null,
    delayMs: 0,
  });
  assert.equal(s2.skipped.length, 1);
  assert.equal(calls, 1);

  /* third run with --force: refetches and overwrites */
  const s3 = await runIngest(db, {
    universe: "nifty50",
    instruments,
    fetchImpl,
    cacheDir: null,
    delayMs: 0,
    force: true,
  });
  assert.equal(s3.fetched.length, 1);
  assert.equal(calls, 2);

  const row = db.prepare("SELECT * FROM analyst_data WHERE symbol = ?").get("RELIANCE.NS");
  assert.ok(row);
  assert.equal(row.symbol, "RELIANCE.NS");
  assert.equal(JSON.parse(row.payload_json).quoteSummary.result[0].financialData.currentPrice.raw, 3000);
  assert.equal(JSON.parse(row.derived_json).targetMeanPrice, 3200);
  assert.ok(row.fetched_at > 0);
  /* fetched_at is fresh relative to the FRESH_SECONDS window */
  assert.ok(Math.floor(Date.now() / 1000) - row.fetched_at < FRESH_SECONDS);
});

test("ingest: stale row is refetched without --force; failures recorded, no upsert", async () => {
  const db = memoryDb();
  const now = Date.now();
  db.prepare(
    "INSERT INTO analyst_data (symbol, payload_json, derived_json, fetched_at) VALUES (?, '{}', '{}', ?)"
  ).run("OLD.NS", Math.floor(now / 1000) - FRESH_SECONDS * 2);

  let calls = 0;
  const fetchImpl = async (backoff, sym) => {
    calls += 1;
    if (sym === "BAD.NS") throw new Error("429 Too Many Requests");
    return FULL_FIXTURE;
  };
  const instruments = makeInstruments(["OLD", "BAD"]);

  const s = await runIngest(db, {
    universe: "nifty50",
    instruments,
    fetchImpl,
    cacheDir: null,
    delayMs: 0,
  });
  assert.equal(s.fetched.length, 1); /* OLD.NS refreshed despite being on disk */
  assert.equal(s.failed.length, 1); /* BAD.NS failed, counted, no crash */
  assert.equal(s.failed[0].symbol, "BAD.NS");
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM analyst_data").get().c, 1); /* failed -> no upsert */
  assert.equal(db.prepare("SELECT symbol FROM analyst_data").get().symbol, "OLD.NS");
  assert.equal(calls, 2);
});

/* ---------- circuit breaker ---------- */

test("ingest: circuit opens after 3 consecutive failures, remaining marked failed", async () => {
  const db = memoryDb();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    throw new Error("429 Too Many Requests");
  };
  const instruments = makeInstruments(["A", "B", "C", "D", "E"]);
  const s = await runIngest(db, {
    universe: "nifty50",
    instruments,
    fetchImpl,
    cacheDir: null,
    delayMs: 0,
  });
  assert.equal(calls, 3); /* breaker stops fetching */
  assert.equal(s.failed.length, 5); /* rest marked failed, no crash */
  assert.match(s.failed[4].error, /circuit open/);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM analyst_data").get().c, 0);
});

/* ---------- universe ---------- */

test("buildUniverse: nifty50 vs nifty100 membership, .NS suffix applied", () => {
  const instruments = [
    { s: "RELIANCE", e: "NSE", idx: ["NIFTY 50", "NIFTY 500"] },
    { s: "HDFCBANK", e: "NSE", idx: ["NIFTY 50"] },
    { s: "ABB", e: "NSE", idx: ["NIFTY NEXT 50"] },
    { s: "TATAMOTORS", e: "NSE", idx: ["NIFTY 500"] },
  ];
  assert.deepEqual(buildUniverse(instruments, { universe: "nifty50" }), [
    "RELIANCE.NS",
    "HDFCBANK.NS",
  ]);
  assert.deepEqual(buildUniverse(instruments, { universe: "nifty100" }), [
    "RELIANCE.NS",
    "HDFCBANK.NS",
    "ABB.NS",
  ]);
  assert.deepEqual(buildUniverse(instruments, { universe: "all" }), [
    "RELIANCE.NS",
    "HDFCBANK.NS",
    "ABB.NS",
    "TATAMOTORS.NS",
  ]);
  assert.throws(() => buildUniverse(instruments, { universe: "nope" }));
});
