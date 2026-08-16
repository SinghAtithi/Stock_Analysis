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

const { computeQuality, buildComposite, qualityStrategy, num } = await import(
  "../../web/src/lib/strategies/strategies/quality.ts"
);

const approx = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

/* ------------------------------------------------------------------ */
/* Fixtures matching the REAL ingest-fundamentals.mjs shapes.          */
/* ------------------------------------------------------------------ */

/** Flat shape: exact flattenMetrics() metrics_json keys. */
function flatMetrics({
  grossProfit = 300,
  totalRevenue = 1000,
  operatingIncome = 200,
  totalAssets = 1000,
  netIncome = 120,
  cfo = 100,
  taPrior = 1000,
  ...rest
} = {}) {
  return {
    grossProfit,
    totalRevenue,
    operatingIncome,
    totalAssets,
    totalCash: 100,
    totalDebt: 100,
    netIncome,
    accrual_netIncome: netIncome,
    accrual_operatingCashFlow: cfo,
    accrual_totalAssetsCur: totalAssets,
    accrual_totalAssetsPrior: taPrior,
    ...rest,
  };
}

/** Nested shape: raw quoteSummary.result[0] (module_json). */
function nestedResult(over = {}) {
  const f = (raw) => (raw == null ? null : { raw, fmt: String(raw) });
  const base = {
    financialData: {
      grossProfits: f(300),
      totalRevenue: f(950),
      operatingIncome: f(180),
      netIncome: f(140),
    },
    incomeStatementHistory: {
      incomeStatementHistory: [
        {
          grossProfit: f(300),
          totalRevenue: f(950),
          costOfRevenue: f(650),
          operatingIncome: f(180),
          netIncome: f(140),
        },
      ],
    },
    balanceSheetHistory: {
      balanceSheetStatements: [
        {
          totalAssets: f(1000),
          cash: f(100),
          totalDebt: f(100),
          totalLiabilities: f(400),
        },
        {
          totalAssets: f(900),
          cash: f(120),
          totalDebt: f(110),
          totalLiabilities: f(380),
        },
      ],
    },
    cashflowStatementHistory: {
      cashflowStatements: [{ operatingCashflow: f(160) }],
    },
  };
  return mergeNested(base, over);
}

/* delete keys deep: { financialData: { grossProfits: null } } removes key */
function mergeNested(base, over) {
  const out = JSON.parse(JSON.stringify(base));
  for (const [mod, fields] of Object.entries(over)) {
    if (!out[mod]) continue;
    for (const [key, val] of Object.entries(fields)) {
      if (val === null) delete out[mod][key];
      else out[mod][key] = val;
    }
  }
  return out;
}

/** 3-symbol universe for the composite tests (hand-computed z below). */
function trioCtx(getFundamentals) {
  return {
    getCandles: () => [],
    getUniverse: () => ["ALPHA", "BETA", "GAMMA"],
    getFundamentals,
  };
}

/* ------------------------------------------------------------------ */
/* (a) per-metric correctness on hand-computed fixtures                */
/* ------------------------------------------------------------------ */

test("S096 gross profitability: grossProfit / totalAssets (flat shape)", () => {
  const m = computeQuality(flatMetrics({ grossProfit: 300, totalAssets: 1000 }));
  assert.ok(approx(m.gpA, 0.3), `gpA = 300/1000 = 0.3, got ${m.gpA}`);
  assert.ok(approx(m.opMargin, 0.2), `opMargin = 200/1000 = 0.2, got ${m.opMargin}`);
});

test("S102 RMW proxy: operatingIncome / totalRevenue", () => {
  const m = computeQuality(flatMetrics({ totalRevenue: 950, operatingIncome: 180 }));
  assert.ok(approx(m.opMargin, 180 / 950), `180/950, got ${m.opMargin}`);
});

test("S095 flat shape -> Sloan CFO proxy: (NI - CFO) / avg(totalAssets)", () => {
  // avg TA = (1000 + 1000)/2 = 1000; (120 - 100)/1000 = 0.02
  const m = computeQuality(flatMetrics({ netIncome: 120, cfo: 100 }));
  assert.ok(approx(m.accruals, 0.02), `(120-100)/1000, got ${m.accruals}`);
  assert.equal(m.accrualModel, "cfo");
  // prior-year TA used when present: (120 - 100) / ((1000 + 900)/2) = 20/950
  const prior = computeQuality(
    flatMetrics({ netIncome: 120, cfo: 100, taPrior: 900 })
  );
  assert.ok(approx(prior.accruals, 20 / 950), `avg(1000,900), got ${prior.accruals}`);
});

test("S095 nested shape -> balance-sheet ΔNOA path when depth exists", () => {
  // NOA = TA - cash - (TL - TD)
  // cur: 1000 - 100 - (400 - 100) = 600 ; prior: 900 - 120 - (380 - 110) = 510
  // ΔNOA = 90 ; avgTA = 950 ; accruals = 90/950 = 0.0947368...
  const m = computeQuality(nestedResult());
  assert.equal(m.accrualModel, "noa");
  assert.ok(approx(m.accruals, 90 / 950), `ΔNOA/avgTA, got ${m.accruals}`);
  assert.ok(approx(m.gpA, 0.3), "gpA from financialData.grossProfits");
  assert.ok(approx(m.opMargin, 180 / 950), "opMargin from financialData");
});

test("S095 nested shape -> CFO fallback when balance-sheet depth is missing", () => {
  const shallow = nestedResult({
    balanceSheetHistory: { balanceSheetStatements: undefined },
    financialData: { netIncome: { raw: 140 } },
  });
  // only TA_cur=1000 from... none -> flat keys absent -> avgTA null -> accruals null
  const m = computeQuality(shallow);
  assert.equal(m.accrualModel, null);
  assert.equal(m.accruals, null, "no CFO path inputs -> null, not crash");

  // single-year balance sheet + cashflow -> (140-160)/1000 = -0.02
  const oneYear = nestedResult({
    balanceSheetHistory: {
      balanceSheetStatements: [
        {
          totalAssets: { raw: 1000 },
          cash: { raw: 100 },
          totalDebt: { raw: 100 },
          totalLiabilities: { raw: 400 },
        },
      ],
    },
  });
  const m2 = computeQuality(oneYear);
  assert.equal(m2.accrualModel, "cfo");
  assert.ok(approx(m2.accruals, (140 - 160) / 1000), `got ${m2.accruals}`);
});

test("S096 grossProfit sourced from incomeStatementHistory when financialData absent", () => {
  const viaStmt = nestedResult({
    financialData: { grossProfits: null },
  });
  assert.ok(
    approx(computeQuality(viaStmt).gpA, 0.3),
    "income statement grossProfit used"
  );

  const viaDerivation = nestedResult({
    financialData: { grossProfits: null },
    incomeStatementHistory: {
      incomeStatementHistory: [
        { totalRevenue: { raw: 950 }, costOfRevenue: { raw: 650 } },
      ],
    },
  });
  assert.ok(
    approx(computeQuality(viaDerivation).gpA, 300 / 1000),
    "totalRevenue - costOfRevenue derivation"
  );
});

test("num() coerces numbers, numeric strings, and {raw,fmt} objects", () => {
  assert.equal(num(42), 42);
  assert.equal(num("300"), 300);
  assert.equal(num({ raw: 5, fmt: "5" }), 5);
  assert.equal(num({ raw: "950" }), 950);
  assert.equal(num(null), null);
  assert.equal(num(NaN), null);
  assert.equal(num(Infinity), null);
  assert.equal(num("abc"), null);
  assert.equal(num({ raw: null }), null);
});

/* ------------------------------------------------------------------ */
/* (b) missing / malformed data -> null components, never a crash      */
/* ------------------------------------------------------------------ */

test("empty and NaN-laden records produce null components, no crash", () => {
  const empty = computeQuality({});
  assert.deepEqual(empty, { gpA: null, opMargin: null, accruals: null, accrualModel: null });

  const poisoned = computeQuality(
    flatMetrics({ grossProfit: NaN, totalRevenue: 0, operatingIncome: Infinity, netIncome: null })
  );
  assert.equal(poisoned.gpA, null, "NaN grossProfit -> null");
  assert.equal(poisoned.opMargin, null, "revenue 0 -> safeDiv null");
  assert.equal(poisoned.accruals, null, "missing netIncome -> null accruals");
  assert.equal(poisoned.accrualModel, null);

  const zeros = computeQuality(flatMetrics({ totalAssets: 0 }));
  assert.equal(zeros.gpA, null, "assets 0 -> null, not Infinity");
});

test("missing grossProfit/operatingIncome degrade per-component", () => {
  const noGp = computeQuality(flatMetrics({ grossProfit: null }));
  assert.equal(noGp.gpA, null);
  assert.ok(approx(noGp.opMargin, 0.2), "opMargin unaffected by missing GP");
  assert.ok(approx(noGp.accruals, 0.02), "accruals unaffected by missing GP");
});

/* ------------------------------------------------------------------ */
/* (c) composite z logic on 3 fixtures                                 */
/* ------------------------------------------------------------------ */

test("composite: z-scores and percentile scores across 3-symbol universe", () => {
  const rows = new Map([
    ["ALPHA", computeQuality(flatMetrics({ grossProfit: 300, operatingIncome: 200, netIncome: 120, cfo: 100 }))],
    ["BETA", computeQuality(flatMetrics({ grossProfit: 200, operatingIncome: 150, netIncome: 140, cfo: 90 }))],
    ["GAMMA", computeQuality(flatMetrics({ grossProfit: 100, operatingIncome: 100, netIncome: 160, cfo: 80 }))],
  ]);
  // gpA [0.3, 0.2, 0.1]: mean 0.2, std sqrt(0.02/3) = 0.08164966
  // opMargin [0.2, 0.15, 0.1]: mean 0.15, std sqrt(0.005/3) = 0.04082483
  // accruals [0.02, 0.05, 0.08]: mean 0.05, std sqrt(0.0018/3) = 0.02449490
  const zOf = Math.sqrt(3 / 2); // (0.3-0.2)/0.08164966 = sqrt(3/2) = 1.224744871
  const out = buildComposite(rows);
  const a = out.get("ALPHA");
  const b = out.get("BETA");
  const g = out.get("GAMMA");

  assert.ok(approx(a.zGp, zOf, 1e-6));
  assert.ok(approx(b.zGp, 0, 1e-9));
  assert.ok(approx(g.zGp, -zOf, 1e-6));
  assert.ok(approx(a.zOp, zOf, 1e-6), "opMargin z");
  assert.ok(approx(g.zAcc, zOf, 1e-6), "accruals z (bad GAMMA is +z)");

  // equal-weight composite z = (zGp + zOp - zAcc)/3
  assert.ok(approx(a.zGp + a.zOp - a.zAcc, 3 * zOf, 1e-6));
  assert.ok(approx(g.zGp + g.zOp - g.zAcc, -3 * zOf, 1e-6));

  // score = equal-weight percentile composite, accruals inverted
  assert.equal(a.score, 100, "best on all three metrics");
  assert.equal(b.score, 50, "median everywhere");
  assert.equal(g.score, 0, "worst on all three metrics");
  assert.ok(a.score > b.score && b.score > g.score);
});

test("composite: missing components are null, not NaN; partial rows still score", () => {
  const rows = new Map([
    ["ONLYGP", computeQuality(flatMetrics({ operatingIncome: null, netIncome: null, cfo: null }))],
    ["EMPTY", computeQuality({})],
  ]);
  const out = buildComposite(rows);
  const only = out.get("ONLYGP");
  assert.ok(approx(only.score, 0), "lone gpA percentile -> 0 (single-value pctRank)");
  assert.equal(only.zGp, null, "n < 3 -> no z");
  assert.equal(only.pctGp, 0);
  assert.equal(only.pctOp, null);
  const empty = out.get("EMPTY");
  assert.equal(empty.score, null);
  assert.ok(Object.values(only).every((v) => v === null || Number.isFinite(v)));
});

/* ------------------------------------------------------------------ */
/* (d) strategy-level behavior                                         */
/* ------------------------------------------------------------------ */

test("S18-quality scores the trio cross-sectionally", async () => {
  const ctx = trioCtx((sym) => {
    const map = {
      ALPHA: flatMetrics({ grossProfit: 300, operatingIncome: 200, netIncome: 120, cfo: 100 }),
      BETA: flatMetrics({ grossProfit: 200, operatingIncome: 150, netIncome: 140, cfo: 90 }),
      GAMMA: flatMetrics({ grossProfit: 100, operatingIncome: 100, netIncome: 160, cfo: 80 }),
    };
    return map[sym] ?? null;
  });
  const a = await qualityStrategy.compute(ctx, "ALPHA");
  const b = await qualityStrategy.compute(ctx, "BETA");
  const g = await qualityStrategy.compute(ctx, "GAMMA");
  assert.ok(a && b && g);
  assert.equal(a.score, 100);
  assert.equal(b.score, 50);
  assert.equal(g.score, 0);
  assert.equal(a.rank, 0, "rank assigned by runner, not strategy");
  assert.equal(a.components.gpA, 0.3);
  assert.equal(a.components.accrualModel, "cfo");
  assert.equal(a.components.sampleSize, 3);
  assert.ok(approx(a.components.zGp, Math.sqrt(3 / 2), 1e-3), "z rounded to 3dp in components");
  assert.equal(a.components.composite, a.score);
});

test("S18-quality returns null on empty fundamentals (empty DB, graceful)", async () => {
  const ctx = trioCtx(() => null);
  assert.equal(await qualityStrategy.compute(ctx, "ALPHA"), null);
});

test("S18-quality returns null when ctx has no getFundamentals (current runner shape)", async () => {
  const ctx = { getCandles: () => [], getUniverse: () => ["ALPHA"] };
  assert.equal(await qualityStrategy.compute(ctx, "ALPHA"), null);
});

test("S18-quality single-symbol compute: documented robust transform, z null", async () => {
  const ctx = {
    getCandles: () => [],
    getUniverse: () => ["SOLO"],
    getFundamentals: () => flatMetrics({ grossProfit: 300, operatingIncome: 200, netIncome: 120, cfo: 100 }),
  };
  const s = await qualityStrategy.compute(ctx, "SOLO");
  assert.ok(s, "signal still emitted with raw components");
  // pctRank defines a lone value at percentile 0 for each metric; the accrual
  // inversion maps its own 0-percentile to 100 -> composite = (0+0+100)/3.
  assert.ok(approx(s.score, 100 / 3, 1e-2), `lone composite, got ${s.score}`);
  assert.equal(s.components.zGp, null, "n < 3 -> no z");
  assert.equal(s.components.gpA, 0.3, "raw metrics still reported");
  assert.equal(s.components.sampleSize, 1);
});

test("S18-quality two-symbol universe ranks correctly with percentile extremes", async () => {
  const ctx = {
    getCandles: () => [],
    getUniverse: () => ["HIGH", "LOW"],
    getFundamentals: (sym) =>
      sym === "HIGH"
        ? flatMetrics({ grossProfit: 300, operatingIncome: 200, netIncome: 120, cfo: 100 })
        : flatMetrics({ grossProfit: 100, operatingIncome: 100, netIncome: 160, cfo: 80 }),
  };
  const hi = await qualityStrategy.compute(ctx, "HIGH");
  const lo = await qualityStrategy.compute(ctx, "LOW");
  assert.equal(hi.score, 100);
  assert.equal(lo.score, 0);
});

test("S18-quality meta is honest about the family jury stats", () => {
  assert.equal(qualityStrategy.meta.id, "S18-quality");
  assert.equal(qualityStrategy.meta.category, "quality");
  assert.equal(qualityStrategy.meta.juryRank, 4, "best of family (S096)");
  assert.equal(qualityStrategy.meta.edgeScore, 9.0);
  assert.match(qualityStrategy.meta.description, /S096/);
  assert.match(qualityStrategy.meta.description, /S102/);
  assert.match(qualityStrategy.meta.description, /S095/);
});
