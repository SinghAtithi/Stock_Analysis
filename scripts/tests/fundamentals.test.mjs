import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { openDb } from "../lib/db.mjs";
import { applyMigrations } from "../migrate.mjs";
import { HostBackoff } from "../lib/curl.mjs";
import {
  flattenMetrics,
  extractAccruals,
  resolveUniverse,
  ingestFundamentals,
  cachePath,
} from "../ingest-fundamentals.mjs";

const NOW = 1_800_000_000_000; // fixed epoch ms
const DAY = 24 * 3600 * 1000;

/* Build a realistic quoteSummary.result[0] payload. Fields follow Yahoo's
   {raw, fmt} shape; callers may delete modules/fields to test missing data. */
function fixtureResult() {
  const f = (raw) => (raw == null ? null : { raw, fmt: String(raw) });
  return {
    defaultKeyStatistics: {
      marketCap: f(19_000_000_000_000),
      trailingPE: f(22.5),
      forwardPE: f(20.1),
      priceToBook: f(3.2),
      enterpriseValue: f(20_500_000_000_000),
      dividendYield: f(0.0035),
      fiftyTwoWeekHigh: f(3300),
      fiftyTwoWeekLow: f(2200),
      bookValue: f(950),
    },
    financialData: {
      priceToSalesTrailing12Months: f(3.8),
      returnOnEquity: f(0.19),
      returnOnAssets: f(0.08),
      returnOnCapital: f(0.12),
      debtToEquity: f(0.45),
      currentRatio: f(1.6),
      freeCashflow: f(1_200_000_000_000),
      grossProfits: f(3_000_000_000_000),
      totalRevenue: f(9_500_000_000_000),
      operatingIncome: f(1_800_000_000_000),
      netIncome: f(1_400_000_000_000),
      ebitda: f(2_100_000_000_000),
    },
    incomeStatementHistory: {
      incomeStatementHistory: [
        {
          netIncome: f(1_400_000_000_000),
          operatingIncome: f(1_800_000_000_000),
          depreciationAndAmortization: f(300_000_000_000),
        },
      ],
    },
    balanceSheetHistory: {
      balanceSheetStatements: [
        { totalAssets: f(18_000_000_000_000), totalDebt: f(2_500_000_000_000), cash: f(1_500_000_000_000) },
        { totalAssets: f(16_500_000_000_000), totalDebt: f(2_200_000_000_000), cash: f(1_300_000_000_000) },
      ],
    },
    cashflowStatementHistory: {
      cashflowStatements: [{ operatingCashflow: f(1_600_000_000_000) }],
    },
    summaryProfile: { sector: "Energy", industry: "Oil & Gas Refining & Marketing" },
  };
}

const wrap = (result) => ({ quoteSummary: { result: [result] } });

function tempDb(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "niftyterm-fund-test-"));
  const db = openDb(path.join(dir, "test.db"));
  applyMigrations(db);
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { dir, db };
}

test("flattenMetrics: numbers parsed from raw, strings coerced, missing modules -> null", () => {
  const r = fixtureResult();
  r.financialData.marketCap = { raw: "19000000000000", fmt: "19T" };
  delete r.summaryProfile;
  delete r.earningsHistory;
  const m = flattenMetrics(r);

  assert.equal(m.marketCap, 19_000_000_000_000, "numeric string coerced");
  assert.equal(m.trailingPE, 22.5);
  assert.equal(m.forwardPE, 20.1);
  assert.equal(m.priceToBook, 3.2);
  assert.equal(m.priceToSales, 3.8);
  assert.equal(m.enterpriseValue, 20_500_000_000_000);
  assert.equal(m.ebitda, 2_100_000_000_000);
  assert.ok(Math.abs(m.evToEbitda - 20_500_000_000_000 / 2_100_000_000_000) < 1e-9);
  assert.equal(m.evToEbitda_derived, false, "EV/EBITDA from reported EBITDA, not derived");
  assert.ok(Math.abs(m.earningsYield - 1 / 22.5) < 1e-12);
  assert.equal(m.earningsYield_derived, true);
  assert.equal(m.dividendYield, 0.0035);
  assert.equal(m.returnOnEquity, 0.19);
  assert.equal(m.returnOnAssets, 0.08);
  assert.equal(m.returnOnCapital, 0.12);
  assert.equal(m.debtToEquity, 0.45);
  assert.equal(m.currentRatio, 1.6);
  assert.equal(m.freeCashflow, 1_200_000_000_000);
  assert.equal(m.totalRevenue, 9_500_000_000_000);
  assert.equal(m.operatingIncome, 1_800_000_000_000);
  assert.equal(m.netIncome, 1_400_000_000_000);
  assert.equal(m.totalAssets, 18_000_000_000_000);
  assert.equal(m.totalDebt, 2_500_000_000_000);
  assert.equal(m.totalCash, 1_500_000_000_000);
  assert.equal(m.ebit, 1_800_000_000_000);
  assert.equal(m.fiftyTwoWeekHigh, 3300);
  assert.equal(m.fiftyTwoWeekLow, 2200);
  assert.equal(m.bookValue, 950);
  assert.equal(m.sector, null, "missing summaryProfile -> null");
  assert.equal(m.industry, null);
});

test("flattenMetrics: EV/EBITDA derived from operatingIncome + D&A when EBITDA missing", () => {
  const r = fixtureResult();
  delete r.financialData.ebitda;
  const m = flattenMetrics(r);
  const expected = 20_500_000_000_000 / (1_800_000_000_000 + 300_000_000_000);
  assert.ok(Math.abs(m.evToEbitda - expected) < 1e-6);
  assert.equal(m.evToEbitda_derived, true, "derivation flagged");
  assert.equal(m.ebitda, 2_100_000_000_000, "derived EBITDA recorded");
});

test("extractAccruals: current + prior year balance sheet inputs", () => {
  const a = extractAccruals(fixtureResult());
  assert.equal(a.accrual_netIncome, 1_400_000_000_000);
  assert.equal(a.accrual_operatingCashFlow, 1_600_000_000_000);
  assert.equal(a.accrual_totalAssetsCur, 18_000_000_000_000);
  assert.equal(a.accrual_totalAssetsPrior, 16_500_000_000_000, "prior year from history array index 1");

  const single = extractAccruals({ balanceSheetHistory: { balanceSheetStatements: [{ totalAssets: { raw: 5 } }] } });
  assert.equal(single.accrual_totalAssetsCur, 5);
  assert.equal(single.accrual_totalAssetsPrior, null, "no prior year -> null, not throw");
  assert.equal(single.accrual_netIncome, null);
});

test("resolveUniverse: idx membership, NSE preference, limit", () => {
  const n50 = resolveUniverse({ universe: "nifty50" });
  assert.equal(n50.length, 50, "NIFTY 50 = 50 distinct symbols");
  assert.ok(n50.every((x) => x.yahoo.endsWith(".NS")), "NSE listing preferred -> .NS");
  assert.ok(n50.some((x) => x.symbol === "RELIANCE" && x.yahoo === "RELIANCE.NS"));
  assert.ok(n50.some((x) => x.symbol === "TCS" && x.yahoo === "TCS.NS"));

  const n500 = resolveUniverse({ universe: "nifty500" });
  assert.equal(n500.length, 500, "NIFTY 500 = 500 distinct symbols");

  const limited = resolveUniverse({ universe: "nifty50", limit: 5 });
  assert.equal(limited.length, 5);
});

test("ingest: upsert + freshness — stale refetched, fresh skipped, force overrides", async (t) => {
  const { dir, db } = tempDb(t);
  const symbols = [
    { symbol: "RELIANCE", name: "RELIANCE", yahoo: "RELIANCE.NS" },
    { symbol: "TCS", name: "TCS", yahoo: "TCS.NS" },
  ];
  let calls = 0;
  const fetchFn = async (yahoo) => {
    calls += 1;
    return wrap(fixtureResult());
  };

  const first = await ingestFundamentals(db, { symbols, fetchFn, now: NOW });
  assert.deepEqual(
    [first.fetched, first.skipped, first.failed.length],
    [2, 0, 0],
    "first run fetches everything"
  );
  assert.equal(calls, 2);

  const fresh = await ingestFundamentals(db, { symbols, fetchFn, now: NOW + 3600_000 });
  assert.deepEqual([fresh.fetched, fresh.skipped], [0, 2], "fetched < 7d ago -> skipped");
  assert.equal(calls, 2, "no network calls on fresh skip");

  const stale = await ingestFundamentals(db, { symbols, fetchFn, now: NOW + 8 * DAY });
  assert.deepEqual([stale.fetched, stale.skipped], [2, 0], "stale (>7d) -> refetched");
  assert.equal(calls, 4);

  const forced = await ingestFundamentals(db, { symbols, fetchFn, now: NOW + 2 * DAY, force: true });
  assert.deepEqual([forced.fetched, forced.skipped], [2, 0], "--force ignores freshness");
  assert.equal(calls, 6);

  const row = db.prepare("SELECT * FROM fundamentals WHERE symbol = ?").get("RELIANCE");
  assert.equal(row.fetched_at, Math.floor((NOW + 2 * DAY) / 1000), "fetched_at in seconds");
  const metrics = JSON.parse(row.metrics_json);
  assert.equal(metrics.trailingPE, 22.5);
  assert.equal(metrics.degraded, false);
  const modules = JSON.parse(row.module_json);
  assert.ok(modules.financialData?.ebitda?.raw > 0, "module_json keeps raw modules");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fundamentals").get().n, 2, "no duplicate rows");
});

test("ingest: fetch failure without cache -> failed, with cache -> degraded cached row", async (t) => {
  const { dir, db } = tempDb(t);
  const cacheDir = path.join(dir, "cache");
  const symbols = [
    { symbol: "ALPHA", name: "ALPHA", yahoo: "ALPHA.NS" },
    { symbol: "BETA", name: "BETA", yahoo: "BETA.NS" },
  ];
  const boom = async () => {
    throw new Error("429 Too Many Requests");
  };

  const fail = await ingestFundamentals(db, { symbols, fetchFn: boom, now: NOW, cacheDir });
  assert.deepEqual([fail.fetched, fail.cached, fail.failed.length], [0, 0, 2]);

  const cachedPath = cachePath("ALPHA.NS", cacheDir);
  const { writeFileSync } = await import("node:fs");
  writeFileSync(cachedPath, JSON.stringify(wrap(fixtureResult())));

  const degraded = await ingestFundamentals(db, { symbols, fetchFn: boom, now: NOW + DAY, cacheDir });
  assert.deepEqual([degraded.fetched, degraded.cached], [1, 0], "cache-hit row still counts as fetched");
  const row = db.prepare("SELECT metrics_json FROM fundamentals WHERE symbol = ?").get("ALPHA");
  assert.equal(JSON.parse(row.metrics_json).degraded, true, "degraded flag set on cache fallback");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fundamentals").get().n, 1);
});

test("ingest: circuit breaker skips the rest after 3 consecutive failures", async (t) => {
  const { dir, db } = tempDb(t);
  const symbols = ["A", "B", "C", "D", "E"].map((s) => ({ symbol: s, name: s, yahoo: `${s}.NS` }));
  const boom = async () => {
    throw new Error("429 Too Many Requests");
  };
  const run = await ingestFundamentals(db, { symbols, fetchFn: boom, now: NOW });
  assert.equal(run.breakerOpened, true);
  assert.equal(run.failed.length, 5, "all five recorded as failed");
  assert.ok(run.failed.some((f) => f.includes("circuit")), "remaining symbols marked circuit-skipped");
  assert.equal(run.coveragePct, 0);
});

test("ingest: rate-limited failures park via backoff, don't open the circuit breaker", async (t) => {
  const { dir, db } = tempDb(t);
  const symbols = ["A", "B", "C", "D"].map((s) => ({ symbol: s, name: s, yahoo: `${s}.NS` }));
  const backoff = new HostBackoff({ jitter: 0, baseDelayMs: 10, parkMs: 50, maxRetries: 0 });
  let calls = 0;
  const fetchFn = async (yahoo) => {
    calls += 1;
    if (yahoo === "D.NS") return wrap(fixtureResult());
    const e = new Error("429 Too Many Requests");
    e.rateLimited = true;
    e.host = "query1.finance.yahoo.com";
    throw e;
  };
  const run = await ingestFundamentals(db, { symbols, fetchFn, backoff, now: NOW });
  assert.equal(run.breakerOpened, false, "sustained throttle never opens the breaker");
  assert.equal(run.failed.length, 3);
  assert.equal(run.fetched, 1, "D still fetched after three parked 429s — universe not burned");
  assert.equal(calls, 4);
  assert.ok(!run.failed.some((f) => f.includes("circuit")), "no circuit-skip entries");
});
