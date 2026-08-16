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

const { getStrategy } = await import(
  "../../web/src/lib/strategies/registry.ts"
);
const { s104Strategy } = await import(
  "../../web/src/lib/strategies/strategies/s104-pead.ts"
);

// --- fixtures shaped exactly like the ingest scripts produce ----------------
// fundamentals: the earningsHistory module inside module_json, i.e. the raw
// quoteSummary.result[0] payload stored by ingest-fundamentals.mjs.
// analyst: derived_json as returned by ingest-analyst.mjs flattenDerived().

const DAY_MS = 86_400_000;
const now = Date.now();
const eventSec = Math.floor((now - 20 * DAY_MS) / 1000);
const yearAgoSec = Math.floor((now - 385 * DAY_MS) / 1000);

const f = (v) => ({ raw: v, fmt: String(v) });

/** earningsHistory module: keys copied from the Yahoo payload shape. */
function earningsModule({ overrides = {}, prior = null }) {
  const entries = [
    {
      quarter: f(1),
      epsActual: f(12.5),
      epsEstimate: f(10),
      epsDifference: f(2.5),
      surprisePercent: f(25),
      quarterEndDate: f(eventSec - 5 * DAY_MS),
      reportDate: f(eventSec),
      estimateCount: f(18),
    },
  ];
  if (prior) {
    entries.push({
      quarter: f(1),
      epsActual: f(prior),
      epsEstimate: f(9.4),
      epsDifference: null,
      surprisePercent: null,
      quarterEndDate: f(yearAgoSec),
      reportDate: f(yearAgoSec + 6 * DAY_MS),
      estimateCount: f(15),
    });
  }
  const entry = entries[0];
  for (const [k, v] of Object.entries(overrides)) {
    if (v === null) delete entry[k];
    else entry[k] = f(v);
  }
  return { history: entries, maxAge: 86400 };
}

const fundamentalsModule = (eh) => ({ earningsHistory: eh });

/** derived_json keys copied from flattenDerived() in ingest-analyst.mjs. */
function analystDerived({ epsEstimate }) {
  return {
    rating: { strongBuy: 4, buy: 6, hold: 6, sell: 1, strongSell: 1, total: 18, rawScore: 3.7 },
    ratingMean: 1.6,
    numberOfAnalystOpinions: 18,
    recommendationKey: "buy",
    targetMeanPrice: 1150,
    targetHighPrice: 1400,
    targetLowPrice: 900,
    currentPrice: 1000,
    targetUpsidePct: 15,
    revisionTrend: {
      period: "0q",
      periodEndDate: "2026-03-31",
      growthEstimate: 12.5,
      epsEstimate,
      epsRev7dPct: 1.1,
      epsRev30dPct: 3.4,
      epsRev90dPct: 5.6,
    },
  };
}

/** Deterministic candles in ms epoch: flat pre-event, then an exact ramp from
 * close 100 at the event day to close 100·(1 + endDriftPct/100) at the end. */
function candlesAfterEvent(eventsAgoDays, endDriftPct) {
  const eventMs = eventSec * 1000;
  const out = [];
  for (let i = 5; i >= 1; i--) {
    out.push({ time: eventMs - i * DAY_MS, open: 100, high: 100, low: 100, close: 100, volume: 100000 });
  }
  for (let i = 0; i <= eventsAgoDays; i++) {
    const frac = i / eventsAgoDays;
    const close = 100 * (1 + (endDriftPct / 100) * frac);
    out.push({ time: eventMs + i * DAY_MS, open: close, high: close * 1.01, low: close * 0.99, close, volume: 100000 });
  }
  return out;
}

const approx = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// --- SUE math on a known fixture --------------------------------------------

test("S104 SUE math: (actual − consensus)/std from analyst range ÷ 4", async () => {
  // actual 12.5, consensus 10 (quarter estimate), std = (13 − 8)/4 = 1.25
  // SUE = 2.0 → base = 50 + 50·(2/3) = 83.33; in-window up-drift confirm:
  // 0.8·83.33 + 0.2·100 = 86.67
  const ctx = {
    getFundamentals: () => fundamentalsModule(earningsModule({})),
    getAnalyst: () =>
      analystDerived({ epsEstimate: { avg: 10.5, low: 8, high: 13, yearAgoEps: 9.5, numberOfAnalysts: 18, growth: 12.5 } }),
    getCandles: () => candlesAfterEvent(20, 10),
  };
  const s = await s104Strategy.compute(ctx, "BEATER");
  assert.ok(s, "signal emitted");
  assert.ok(approx(s.components.sue, 2.0), `sue=${s.components.sue}`);
  assert.ok(approx(s.components.surprisePct, 25), `surprisePct=${s.components.surprisePct}`);
  assert.equal(s.components.eventDate, eventSec);
  assert.ok(approx(s.components.drift60d, 10), `drift60d=${s.components.drift60d}`);
  assert.equal(s.components.mode, "sue");
  assert.ok(approx(s.score, 86.67, 1e-2), `score=${s.score}`);
  assert.ok(s.score > 50, "positive surprise scores above neutral");
  assert.equal(s.rank, 0, "rank assigned by runner, not strategy");
});

test("S104 negative surprise → direction-signed score below neutral", async () => {
  const ctx = {
    getFundamentals: () =>
      fundamentalsModule(
        earningsModule({ overrides: { epsActual: 8, epsEstimate: 10, epsDifference: -2, surprisePercent: -20 } })
      ),
    getAnalyst: () =>
      analystDerived({ epsEstimate: { avg: 10.5, low: 8, high: 13, yearAgoEps: 9.5, numberOfAnalysts: 18, growth: 12.5 } }),
    getCandles: () => candlesAfterEvent(20, -10),
  };
  const s = await s104Strategy.compute(ctx, "MISSER");
  assert.ok(s);
  // SUE = (8 − 10)/1.25 = −1.6 → base = 50 + 50·(−1.6/3) = 23.33; down-drift → 0.8·23.33
  assert.ok(approx(s.components.sue, -1.6), `sue=${s.components.sue}`);
  assert.ok(s.score < 50, "negative surprise scores below neutral");
  assert.ok(s.components.drift60d < 0);
});

test("S104 consensus falls back to analyst epsEstimate.avg when quarter estimate missing", async () => {
  const ctx = {
    getFundamentals: () => fundamentalsModule(earningsModule({ overrides: { epsEstimate: null } })),
    getAnalyst: () =>
      analystDerived({ epsEstimate: { avg: 10, low: 8, high: 13, yearAgoEps: 9.5, numberOfAnalysts: 18, growth: 12.5 } }),
    getCandles: () => candlesAfterEvent(20, 10),
  };
  const s = await s104Strategy.compute(ctx, "NOQEST");
  assert.ok(s);
  assert.ok(approx(s.components.sue, 2.0), `sue=${s.components.sue}`);
  assert.equal(s.components.mode, "sue");
});

test("S104 fallback: YoY EPS surprise when estimates/std missing", async () => {
  // no analyst data and no quarter estimate → YoY: (12.5 − 10)/10 = 25 %
  const ctx = {
    getFundamentals: () =>
      fundamentalsModule(earningsModule({ overrides: { epsEstimate: null }, prior: 10 })),
    getAnalyst: () => null,
    getCandles: () => candlesAfterEvent(20, 10),
  };
  const s = await s104Strategy.compute(ctx, "YOY");
  assert.ok(s);
  assert.equal(s.components.mode, "yoy");
  assert.equal(s.components.sue, null);
  assert.ok(approx(s.components.surprisePct, 25), `surprisePct=${s.components.surprisePct}`);
  // base = 50 + 50·0.25 = 62.5; up-drift confirm → 0.8·62.5 + 20 = 70
  assert.ok(approx(s.score, 70, 1e-2), `score=${s.score}`);
  assert.ok(s.score > 50);
});

test("S104 stale event (outside 60d window) is faded and drift is null", async () => {
  const staleSec = Math.floor((now - 120 * DAY_MS) / 1000);
  const ctx = {
    getFundamentals: () =>
      fundamentalsModule(
        earningsModule({ overrides: { reportDate: staleSec, quarterEndDate: staleSec - 5 * DAY_MS } })
      ),
    getAnalyst: () =>
      analystDerived({ epsEstimate: { avg: 10.5, low: 8, high: 13, yearAgoEps: 9.5, numberOfAnalysts: 18, growth: 12.5 } }),
    getCandles: () => candlesAfterEvent(120, 10),
  };
  const s = await s104Strategy.compute(ctx, "STALE");
  assert.ok(s);
  assert.equal(s.components.drift60d, null, "no drift outside the window");
  // base 83.33 faded to 0.6·83.33 = 50.00
  assert.ok(approx(s.score, 50, 1e-2), `score=${s.score}`);
});

// --- graceful degradation ---------------------------------------------------

test("S104 returns null when no data getters exist (empty real run)", async () => {
  const ctx = { getCandles: () => candlesAfterEvent(20, 10) };
  assert.equal(await s104Strategy.compute(ctx, "ANY"), null);
});

test("S104 returns null when fundamentals/analyst rows are missing or empty", async () => {
  const ctx = {
    getFundamentals: () => null,
    getAnalyst: () => null,
  };
  assert.equal(await s104Strategy.compute(ctx, "NODATA"), null);
});

test("S104 returns null when no earnings history and no year-ago comparator", async () => {
  const ctx = {
    getFundamentals: () => fundamentalsModule(earningsModule({ overrides: { epsEstimate: null } })),
    getAnalyst: () => null,
  };
  assert.equal(await s104Strategy.compute(ctx, "ONLYCUR"), null);
});

test("S104 tolerates metrics_json (no earnings keys) and raw DB row wrappers", async () => {
  const withModuleJson = {
    getFundamentals: () => ({ module_json: fundamentalsModule(earningsModule({})) }),
    getAnalyst: () => ({ derived_json: analystDerived({ epsEstimate: { avg: 10.5, low: 8, high: 13 } }) }),
    getCandles: () => candlesAfterEvent(20, 10),
  };
  assert.ok(await s104Strategy.compute(withModuleJson, "WRAPPED"));
  const metricsOnly = {
    getFundamentals: () => ({ marketCap: 1e12, trailingPE: 22.5 }),
    getAnalyst: () => null,
  };
  assert.equal(await s104Strategy.compute(metricsOnly, "METRICSONLY"), null);
});

test("S104 never throws on candle fetch failure (treats as no drift)", async () => {
  const ctx = {
    getFundamentals: () => fundamentalsModule(earningsModule({})),
    getAnalyst: () => analystDerived({ epsEstimate: { avg: 10.5, low: 8, high: 13 } }),
    getCandles: () => {
      throw new Error("candles unavailable");
    },
  };
  const s = await s104Strategy.compute(ctx, "NOCANDLES");
  assert.ok(s, "signal still emitted without candles");
  assert.equal(s.components.drift60d, null);
  assert.ok(approx(s.score, 83.33, 1e-2), `score=${s.score}`);
});

// --- registration -----------------------------------------------------------

test("S104 self-registers on import", () => {
  const s = getStrategy("S104");
  assert.ok(s, "registered via module import side effect");
  assert.equal(s.meta.name, "PEAD / SUE");
  assert.equal(s.meta.juryRank, 2);
  assert.equal(s.meta.edgeScore, 9.67);
  assert.equal(s.meta.category, "event");
});

test("S104 meta is honest and consistent", () => {
  assert.match(s104Strategy.meta.id, /^S\d+$/);
  assert.ok(s104Strategy.meta.inputs.length > 0);
  assert.equal(s104Strategy.meta.universe, "nifty50");
});
