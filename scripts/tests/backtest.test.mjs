import { registerHooks } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";

registerHooks({
  resolve(specifier, context, nextResolve) {
    const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
    const hasExtension = /\.[a-z0-9]+$/i.test(specifier);
    if (isRelative && !hasExtension) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { runBacktest, SnapshotScorer, dateToAsOf } = await import(
  "../../web/src/lib/backtest/engine.ts"
);
const { computeMetrics, computeSeriesMetrics, RF_ANNUAL, TRADING_DAYS_PER_YEAR } =
  await import("../../web/src/lib/backtest/metrics.ts");

const approx = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// --- fixture helpers ---------------------------------------------------------

function dayTs(iso) {
  return Date.parse(`${iso}T00:00:00Z`) / 1000;
}

/** Daily candles (UNIX-second ts, like eod_candles) for the 2020-01..04 window. */
function windowCandles(closes) {
  const start = dayTs("2020-01-01");
  const out = [];
  for (let i = 0; i < closes.length; i++) {
    const c = closes[i];
    out.push({ time: start + i * 86400, open: c, high: c, low: c, close: c, volume: 1e6 });
  }
  return out;
}

function withPrevClose(candles, close) {
  return [{ time: candles[0].time - 86400, open: close, high: close, low: close, close, volume: 1e6 }, ...candles];
}

// --- (a) metrics: hand-computed ----------------------------------------------

test("metrics: CAGR / Sharpe / Sortino / maxDD on hand-computed series", () => {
  // 12 monthly returns alternating +1% / -1%, exactly one calendar year.
  const points = [];
  let v = 1;
  for (let m = 0; m <= 12; m++) {
    const date = m === 12 ? "2021-01-01" : `2020-${String(m + 1).padStart(2, "0")}-01`;
    if (m > 0) v *= m % 2 === 1 ? 1.01 : 0.99;
    points.push({ date, value: v });
  }

  const m = computeSeriesMetrics(points);

  // mean = 0; sample std of 12 values of magnitude 0.01.
  const expStd = Math.sqrt((12 * 0.0001) / 11);
  const expAnnVol = expStd * Math.sqrt(TRADING_DAYS_PER_YEAR);
  const expYears = 366 / 365.25; // 2020 is a leap year
  const expTotal = Math.pow(0.9999, 6) - 1;

  assert.ok(approx(m.years, expYears));
  assert.ok(approx(m.totalReturn, expTotal));
  assert.ok(approx(m.cagr, Math.pow(Math.pow(0.9999, 6), 1 / expYears) - 1));
  assert.ok(approx(m.annualizedVol, expAnnVol));
  assert.ok(approx(m.sharpe, (0 - RF_ANNUAL) / expAnnVol), "sharpe uses rf=6.5%");
  // downside deviation: 6 negative returns of -0.01.
  const expDownside = Math.sqrt((6 * 0.0001) / 12) * Math.sqrt(TRADING_DAYS_PER_YEAR);
  assert.ok(approx(m.sortino, (0 - RF_ANNUAL) / expDownside));
  // peak stays at 1.01; worst trough is the last: 0.9999^6 / 1.01 - 1.
  assert.ok(approx(m.maxDrawdown, 1 - Math.pow(0.9999, 6) / 1.01));
  assert.equal(m.maxDrawdownPeakDate, "2020-02-01");
  assert.equal(m.maxDrawdownTroughDate, "2021-01-01");
  assert.equal(m.positiveMonths, 6);
  assert.equal(m.totalMonths, 12);
  assert.ok(approx(m.hitRate, 0.5));
});

test("metrics: maxDrawdown peak/trough dates on a clear drawdown", () => {
  const points = [
    { date: "2020-01-01", value: 1 },
    { date: "2020-02-01", value: 1.2 },
    { date: "2020-03-01", value: 0.8 },
    { date: "2020-04-01", value: 1.3 },
    { date: "2020-05-01", value: 1.0 },
  ];
  const m = computeSeriesMetrics(points);
  assert.ok(approx(m.maxDrawdown, 1 - 0.8 / 1.2));
  assert.equal(m.maxDrawdownPeakDate, "2020-02-01");
  assert.equal(m.maxDrawdownTroughDate, "2020-03-01");
  assert.equal(m.positiveMonths, 2);
  assert.equal(m.totalMonths, 4);
});

test("metrics: monotonic series has no drawdown; turnover/exposure computed", () => {
  const points = [
    { date: "2020-01-01", value: 1 },
    { date: "2020-07-01", value: 1.1 },
    { date: "2021-01-01", value: 1.21 },
  ];
  const m = computeSeriesMetrics(points);
  assert.equal(m.maxDrawdown, null);
  assert.equal(m.maxDrawdownPeakDate, null);
  assert.ok(approx(m.cagr, Math.pow(1.21, 1 / (366 / 365.25)) - 1), "cagr over 366-day leap year");

  const full = computeMetrics({
    equity: points.map((p) => ({ date: p.date, strat: p.value, bench: p.value })),
    totalTurnover: 5,
    investedDays: 2,
  });
  assert.ok(approx(full.annualizedTurnover, 5 / (366 / 365.25)));
  assert.ok(approx(full.exposure, 2 / 3));
});

// --- (b) engine: selection, cost, benchmark -----------------------------------

test("engine: topN selection + turnover cost + buy-and-hold benchmark", async () => {
  const closesA = Array(121).fill(100); // flat
  const closesB = Array.from({ length: 121 }, (_, i) => 100 * Math.pow(1.01, i + 1)); // +1%/day
  const candlesBySymbol = new Map([
    ["A", withPrevClose(windowCandles(closesA), 100)],
    ["B", withPrevClose(windowCandles(closesB), 100)],
  ]);
  const scorer = new SnapshotScorer([
    { symbol: "A", score: 95, as_of: dateToAsOf("2020-01-01") },
    { symbol: "B", score: 5, as_of: dateToAsOf("2020-01-01") },
    { symbol: "A", score: 5, as_of: dateToAsOf("2020-02-01") },
    { symbol: "B", score: 95, as_of: dateToAsOf("2020-02-01") },
  ]);

  const result = await runBacktest(candlesBySymbol, scorer, {
    topN: 1,
    rebalance: "monthly",
    startDate: "2020-01-01",
    endDate: "2020-04-30",
    costPct: 0.0015,
    slippagePct: 0.0005,
  });

  assert.equal(result.equity.length, 121);
  assert.deepEqual(result.rebalanceDates, [
    "2020-01-01", "2020-02-01", "2020-03-01", "2020-04-01",
  ]);

  // Rebalance 1: cash -> A. Turnover 1.0 (buy 100%), cost 0.2% on Jan 1.
  assert.equal(result.trades[0].date, "2020-01-01");
  assert.ok(approx(result.trades[0].turnover, 1));
  assert.ok(approx(result.trades[0].costPaid, 0.002));
  assert.deepEqual(result.trades[0].added, ["A"]);
  assert.deepEqual(result.trades[0].removed, []);

  // Rebalance 2: A -> B flip. Full rotation again.
  assert.equal(result.trades[1].date, "2020-02-01");
  assert.ok(approx(result.trades[1].turnover, 1));
  assert.deepEqual(result.trades[1].added, ["B"]);
  assert.deepEqual(result.trades[1].removed, ["A"]);

  // Later rebalances: hold B, no turnover.
  assert.ok(approx(result.trades[2].turnover, 0));
  assert.deepEqual(result.trades[2].held, ["B"]);

  // Equity: Jan 1 -> cost 0.2%; flat while holding A; Feb 1 -> cost 0.2%;
  // then B compounds +1%/day for 89 days (Feb 2 .. Apr 30).
  assert.ok(approx(result.equity[0].strat, 1 * (1 - 0.002)));
  assert.ok(approx(result.equity[31].strat, 1 * (1 - 0.002) * (1 - 0.002)));
  assert.ok(approx(result.equity[120].strat, 0.996004 * Math.pow(1.01, 89)));

  // Benchmark: fixed equal weight, +0.5%/day; 121 returns because the
  // pre-window close anchors the first window day (2019-12-31 -> 2020-01-01).
  assert.ok(approx(result.equity[120].bench, Math.pow(1.005, 121)));
});

test("engine: zero cost isolates turnover; topN=universe equals benchmark", async () => {
  const closesA = Array(121).fill(100);
  const closesB = Array.from({ length: 121 }, (_, i) => 100 * Math.pow(1.01, i + 1));
  const candlesBySymbol = new Map([
    ["A", withPrevClose(windowCandles(closesA), 100)],
    ["B", withPrevClose(windowCandles(closesB), 100)],
  ]);
  const scorer = new SnapshotScorer([
    { symbol: "A", score: 95, as_of: dateToAsOf("2020-01-01") },
    { symbol: "B", score: 5, as_of: dateToAsOf("2020-01-01") },
    { symbol: "A", score: 5, as_of: dateToAsOf("2020-02-01") },
    { symbol: "B", score: 95, as_of: dateToAsOf("2020-02-01") },
  ]);
  const config = {
    topN: 1,
    rebalance: "monthly",
    startDate: "2020-01-01",
    endDate: "2020-04-30",
    costPct: 0,
    slippagePct: 0,
  };

  const noCost = await runBacktest(candlesBySymbol, scorer, config);
  assert.ok(approx(noCost.equity[120].strat, Math.pow(1.01, 89)), "no cost: pure B growth");
  assert.ok(approx(noCost.totalTurnover, 2), "two full rotations, cost-free");

  // topN = 2: hold both, equal weight, no costs. Strategy enters at the
  // close of day 0 (point-in-time signals) -> 120 daily returns, while the
  // benchmark anchors on the pre-window close -> 121. So strat = bench/1.005.
  const all = await runBacktest(candlesBySymbol, scorer, { ...config, topN: 2 });
  assert.ok(approx(all.equity[120].strat, all.equity[120].bench / 1.005));
  assert.ok(approx(all.equity[120].strat, Math.pow(1.005, 120)));
});

// --- (c) signal lookup ---------------------------------------------------------

test("signal lookup: as_of <= date picks the nearest snapshot", () => {
  const scorer = new SnapshotScorer([
    { symbol: "X", score: 3, as_of: 300 },
    { symbol: "X", score: 1, as_of: 100 },
    { symbol: "X", score: 2, as_of: 200 },
    { symbol: "Y", score: 9, as_of: 150 },
    { symbol: "Z", score: NaN, as_of: 250 }, // skipped
  ]);
  assert.equal(scorer.score("X", 50), null, "no snapshot before first as_of");
  assert.equal(scorer.score("X", 100), 1, "as_of inclusive on the boundary");
  assert.equal(scorer.score("X", 150), 1);
  assert.equal(scorer.score("X", 199), 1);
  assert.equal(scorer.score("X", 200), 2);
  assert.equal(scorer.score("X", 500), 3);
  assert.equal(scorer.score("Y", 200), 9);
  assert.equal(scorer.score("Z", 500), null, "NaN score never returned");
  assert.equal(scorer.score("NOPE", 500), null);
});

// --- (d) NaN-safety -----------------------------------------------------------

test("NaN-safety: empty inputs produce null metrics, never throw", () => {
  const empty = computeSeriesMetrics([]);
  for (const key of [
    "totalReturn", "cagr", "annualizedVol", "sharpe", "sortino",
    "maxDrawdown", "hitRate", "years",
  ]) {
    assert.equal(empty[key], null, `${key} is null on empty input`);
  }
  assert.equal(empty.tradingDays, 0);

  const full = computeMetrics({ equity: [], totalTurnover: 0, investedDays: 0 });
  assert.equal(full.annualizedTurnover, null);
  assert.equal(full.exposure, null);

  const one = computeSeriesMetrics([{ date: "2020-01-01", value: 1 }]);
  assert.equal(one.cagr, null);
  assert.equal(one.maxDrawdown, null);
});

test("NaN-safety: zero-variance equity yields null Sharpe/Sortino", async () => {
  const flat = computeSeriesMetrics(
    Array.from({ length: 10 }, (_, i) => ({ date: `2020-01-0${i + 1}`, value: 1 }))
  );
  assert.equal(flat.sharpe, null);
  assert.equal(flat.sortino, null);
  assert.ok(approx(flat.cagr, 0));

  // Engine with no signals at all: stays in cash, flat equity.
  const candlesBySymbol = new Map([
    ["A", withPrevClose(windowCandles(Array(61).fill(100)), 100)],
  ]);
  const scorer = new SnapshotScorer([{ symbol: "A", score: 50, as_of: dayTs("2020-03-15") }]);
  const result = await runBacktest(candlesBySymbol, scorer, {
    topN: 1,
    rebalance: "monthly",
    startDate: "2020-01-01",
    endDate: "2020-02-29",
    costPct: 0.0015,
    slippagePct: 0.0005,
  });
  assert.ok(result.equity.every((e) => approx(e.strat, 1)), "cash: flat equity");
  assert.equal(result.investedDays, 0);
  const m = computeMetrics({
    equity: result.equity,
    totalTurnover: result.totalTurnover,
    investedDays: result.investedDays,
  });
  assert.ok(approx(m.totalReturn, 0));
  assert.equal(m.exposure, 0);
});

test("NaN-safety: empty universe and NaN candles never throw", async () => {
  const empty = await runBacktest(new Map(), new SnapshotScorer([]), {
    topN: 5,
    rebalance: "monthly",
    startDate: "2020-01-01",
    costPct: 0.0015,
    slippagePct: 0.0005,
  });
  assert.deepEqual(empty.equity, []);
  assert.deepEqual(empty.trades, []);

  const bad = windowCandles([NaN, 100, 100]);
  bad[0] = { ...bad[0], close: NaN };
  const result = await runBacktest(new Map([["A", bad]]), new SnapshotScorer([]), {
    topN: 1,
    rebalance: "monthly",
    startDate: "2020-01-01",
    endDate: "2020-01-31",
    costPct: 0.0015,
    slippagePct: 0.0005,
  });
  assert.equal(result.equity.length, 2, "NaN close date excluded from calendar");
  assert.ok(result.equity.every((e) => Number.isFinite(e.strat)));
});
