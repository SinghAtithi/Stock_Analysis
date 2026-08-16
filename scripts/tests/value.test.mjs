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

const {
  valueMetrics,
  zToScore,
  s099HmlStrategy,
  s076NcavStrategy,
  s078LowPeStrategy,
  s080MagicFormulaStrategy,
  valueStrategies,
} = await import("../../web/src/lib/strategies/strategies/s099-value.ts");

/* ------------------------------------------------------------------ *
 * Fixtures. Values are small clean numbers; ratios hand-computed:     *
 *                                                                     *
 * A CASHHO  : mcap 1000, P/B 2.0, P/E 20,  debt 200, cash 100,        *
 *              EBIT 110, ROIC 0.20, CA 800,  TL 300                   *
 *   bm 0.50, ncav 0.50, ey 0.05, EV 1100, ebitEv 0.10                 *
 * B DEBTCO  : mcap 500,  P/B 5.0, P/E 10,  debt 400, cash 50,         *
 *              EBIT 68,  ROIC 0.10, CA 300,  TL 250                   *
 *   bm 0.20, ncav 0.10, ey 0.10, EV 850,  ebitEv 0.08                 *
 * C MARGIN  : mcap 2000, P/B 1.0, P/E 50,  debt 100, cash 300,        *
 *              EBIT 90,  ROIC 0.30, CA 900,  TL 800                   *
 *   bm 1.00, ncav 0.05, ey 0.02, EV 1800, ebitEv 0.05                 *
 * D CASHEAL : mcap 400,  P/B 0.8, P/E 8,   debt 0,   cash 100,        *
 *              EBIT 60,  ROIC 0.15, CA 600,  TL 100                   *
 *   bm 1.25, ncav 1.25, ey 0.125, EV 300, ebitEv 0.20                 *
 *                                                                     *
 * Hand-computed z-scores (population mean/std over the 4 symbols):    *
 *   bm:     A -0.577  B -1.307  C 0.638  D 1.246                      *
 *   ncav:   A  0.052  B -0.781  C -0.885 D 1.614                      *
 *   ey:     A -0.577  B  0.638  C -1.307 D 1.246                      *
 *   ebitEv: A -0.133  B -0.489  C -1.022 D 1.643                      *
 *   roic:   A  0.169  B -1.183  C  1.521 D -0.507                     *
 * Scores = clamp(50 + 50*z, 0, 100), so B's bm z < -1 -> 0 and        *
 * D's bm z > 1 -> 100, etc. Exact non-clamped scores are recomputed   *
 * inline in the test below (independent mean/std implementation).     *
 * ------------------------------------------------------------------ */

function metrics({ mcap, pb, pe, debt, cash, opInc, roc, ca, tl }) {
  return {
    marketCap: mcap,
    priceToBook: pb,
    trailingPE: pe,
    totalDebt: debt,
    totalCash: cash,
    operatingIncome: opInc,
    returnOnCapital: roc,
    currentAssets: ca,
    totalLiabilities: tl,
  };
}

const FIX = {
  A: metrics({ mcap: 1000, pb: 2.0, pe: 20, debt: 200, cash: 100, opInc: 110, roc: 0.2, ca: 800, tl: 300 }),
  B: metrics({ mcap: 500, pb: 5.0, pe: 10, debt: 400, cash: 50, opInc: 68, roc: 0.1, ca: 300, tl: 250 }),
  C: metrics({ mcap: 2000, pb: 1.0, pe: 50, debt: 100, cash: 300, opInc: 90, roc: 0.3, ca: 900, tl: 800 }),
  D: metrics({ mcap: 400, pb: 0.8, pe: 8, debt: 0, cash: 100, opInc: 60, roc: 0.15, ca: 600, tl: 100 }),
};

function valueCtx(specs) {
  const funds = new Map(specs.map(([sym, m]) => [sym, m]));
  return {
    getFundamentals: async (sym) => funds.get(sym) ?? null,
    getUniverse: () => [...funds.keys()],
    getCandles: async () => [],
  };
}

const approx = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

/** Independent reimplementation of indicators.zscore (population std). */
function zscoreOf(values) {
  const n = values.length;
  const mean = values.reduce((a, v) => a + v, 0) / n;
  const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);
  return values.map((v) => (v - mean) / std);
}

/* ---------------- valueMetrics unit tests ---------------- */

test("valueMetrics: hand-computed ratios from metrics_json keys", () => {
  const m = valueMetrics(FIX.A);
  assert.equal(m.bm, 0.5, "B/M = 1/priceToBook");
  assert.equal(m.ncav, 0.5, "(800-300)/1000");
  assert.equal(m.ey, 0.05, "1/20");
  assert.equal(m.ev, 1100, "1000 + 200 - 100");
  assert.equal(m.ebitEv, 0.1, "110/1100");
  assert.equal(m.roic, 0.2, "reported returnOnCapital");

  const b = valueMetrics(FIX.B);
  assert.equal(b.bm, 0.2);
  assert.equal(b.ncav, 0.1, "(300-250)/500");
  assert.equal(b.ey, 0.1, "1/10");
  assert.equal(b.ev, 850, "500 + 400 - 50");
  assert.equal(b.ebitEv, 0.08, "68/850");
  assert.equal(b.roic, 0.1);

  const d = valueMetrics(FIX.D);
  assert.equal(d.bm, 1.25, "1/0.8");
  assert.equal(d.ncav, 1.25, "(600-100)/400");
  assert.equal(d.ev, 300, "400 + 0 - 100");
  assert.equal(d.ebitEv, 0.2, "60/300");
});

test("valueMetrics: NCAV reads balance-sheet keys from raw module_json shape", () => {
  const raw = {
    marketCap: 1000,
    balanceSheetHistory: {
      balanceSheetStatements: [{ totalCurrentAssets: 800, totalLiabilities: 300 }],
    },
  };
  assert.equal(valueMetrics(raw).ncav, 0.5);
});

test("valueMetrics: NCAV supports totalCurrentAssets/currentAssets aliases", () => {
  assert.equal(
    valueMetrics({ marketCap: 1000, totalCurrentAssets: 800, totalLiabilities: 300 }).ncav,
    0.5
  );
  assert.equal(
    valueMetrics({ marketCap: 1000, currentAssets: 800, totalLiabilities: 300 }).ncav,
    0.5
  );
});

test("valueMetrics: B/M falls back to bookValue/price when priceToBook missing", () => {
  const f = { bookValue: 100, marketCap: 1000 };
  assert.equal(valueMetrics(f).bm, null, "no price -> null");
  assert.equal(valueMetrics(f, 200).bm, 0.5, "per-share book / per-share price");
});

test("valueMetrics: earningsYield preferred over 1/trailingPE", () => {
  assert.equal(valueMetrics({ earningsYield: 0.04, trailingPE: 20 }).ey, 0.04);
  assert.equal(valueMetrics({ trailingPE: 20 }).ey, 0.05);
  assert.equal(valueMetrics({ trailingPE: 0 }).ey, null);
});

test("valueMetrics: ROIC falls back to EBIT/(totalAssets - totalCash)", () => {
  const f = { operatingIncome: 90, totalAssets: 1000, totalCash: 100 };
  assert.equal(valueMetrics(f).roic, 0.1, "90/900");
  const noAssets = { operatingIncome: 90 };
  assert.equal(valueMetrics(noAssets).roic, null);
});

test("valueMetrics: EV guards — zero/negative EV -> ebitEv null", () => {
  const zero = { marketCap: 100, totalDebt: 0, totalCash: 100, operatingIncome: 10 };
  assert.equal(valueMetrics(zero).ev, 0);
  assert.equal(valueMetrics(zero).ebitEv, null);
  const neg = { marketCap: 50, totalDebt: 100, totalCash: 300, operatingIncome: 10 };
  assert.equal(valueMetrics(neg).ev, -150);
  assert.equal(valueMetrics(neg).ebitEv, null);
});

test("valueMetrics: NaN-safety — missing/garbage keys -> null, never NaN", () => {
  const empty = valueMetrics({});
  for (const k of ["bm", "ncav", "ey", "ebitEv", "roic", "ev"]) {
    assert.equal(empty[k], null);
  }
  const junk = valueMetrics({
    marketCap: NaN,
    priceToBook: "not-a-number",
    trailingPE: Infinity,
    totalDebt: null,
    totalCash: {},
    operatingIncome: "110",
  });
  for (const k of ["bm", "ncav", "ey", "ebitEv", "roic", "ev"]) {
    assert.equal(junk[k], null, `${k} must be null`);
  }
  const coerced = valueMetrics({ marketCap: "1000", operatingIncome: "110" });
  assert.equal(coerced.ev, null, "missing debt/cash keeps ev null");
});

test("zToScore maps z to clamped 0-100", () => {
  assert.equal(zToScore(0), 50);
  assert.equal(zToScore(1), 100);
  assert.equal(zToScore(-1), 0);
  assert.equal(zToScore(0.5), 75);
  assert.equal(zToScore(3), 100);
  assert.equal(zToScore(-3), 0);
});

/* ---------------- strategy metas ---------------- */

test("value family metas carry jury ids, ranks, edge scores", () => {
  const byId = new Map(valueStrategies.map((s) => [s.meta.id, s.meta]));
  assert.equal(byId.get("S099").name, "Value Factor (HML)");
  assert.equal(byId.get("S099").category, "value");
  assert.equal(byId.get("S099").juryRank, 8);
  assert.equal(byId.get("S099").edgeScore, 8.5);
  assert.equal(byId.get("S076").juryRank, 15);
  assert.equal(byId.get("S076").edgeScore, 8.67);
  assert.equal(byId.get("S078").juryRank, 29);
  assert.equal(byId.get("S078").edgeScore, 7.17);
  assert.equal(byId.get("S080").juryRank, 12);
  assert.equal(byId.get("S080").edgeScore, 8.83);
  assert.equal(valueStrategies.length, 4);
  for (const s of valueStrategies) {
    assert.equal(s.meta.universe, "nifty500");
    assert.ok(s.meta.juryRank !== null, "juried, not a demo");
  }
});

/* ---------------- cross-sectional scoring ---------------- */

const SCORE_OF = {
  S099: (s) => s099HmlStrategy.compute(s[0], s[1]),
  S076: (s) => s076NcavStrategy.compute(s[0], s[1]),
  S078: (s) => s078LowPeStrategy.compute(s[0], s[1]),
  S080: (s) => s080MagicFormulaStrategy.compute(s[0], s[1]),
};

test("S099 ranks by book-to-market, clamps at 0 and 100", async () => {
  const ctx = valueCtx([
    ["A", FIX.A], ["B", FIX.B], ["C", FIX.C], ["D", FIX.D], ["NODATA", null],
  ]);
  const a = await s099HmlStrategy.compute(ctx, "A");
  const b = await s099HmlStrategy.compute(ctx, "B");
  const c = await s099HmlStrategy.compute(ctx, "C");
  const d = await s099HmlStrategy.compute(ctx, "D");
  assert.ok(a && b && c && d, "all four emit");
  assert.ok(d.score > c.score && c.score > a.score && a.score > b.score,
    "D(bm 1.25) > C(1.0) > A(0.5) > B(0.2)");
  assert.equal(b.score, 0, "bm z < -1 clamps to 0");
  assert.equal(d.score, 100, "bm z > 1 clamps to 100");
  assert.equal(await s099HmlStrategy.compute(ctx, "NODATA"), null);
  assert.equal(await s099HmlStrategy.compute(ctx, "NOSUCH"), null, "not in universe");
  for (const s of [a, b, c, d]) {
    assert.equal(s.rank, 0, "rank assigned by runner");
    assert.equal(s.components.sampleSize, 4);
  }
});

test("S099 score matches independently computed z-score (fixture)", async () => {
  const ctx = valueCtx([["A", FIX.A], ["B", FIX.B], ["C", FIX.C], ["D", FIX.D]]);
  const bmValues = [FIX.A, FIX.B, FIX.C, FIX.D].map((m) => 1 / m.priceToBook);
  const zs = zscoreOf(bmValues);
  const expected = Math.round((50 + 50 * zs[2]) * 100) / 100; // symbol C
  const c = await s099HmlStrategy.compute(ctx, "C");
  assert.equal(c.score, expected, `hand-z ${zs[2].toFixed(6)} -> ${expected}`);
});

test("S076 ranks by NCAV/marketCap", async () => {
  const ctx = valueCtx([["A", FIX.A], ["B", FIX.B], ["C", FIX.C], ["D", FIX.D]]);
  const a = await s076NcavStrategy.compute(ctx, "A");
  const b = await s076NcavStrategy.compute(ctx, "B");
  const c = await s076NcavStrategy.compute(ctx, "C");
  const d = await s076NcavStrategy.compute(ctx, "D");
  assert.ok(d.score > a.score && a.score > b.score && b.score > c.score,
    "D(1.25) > A(0.5) > B(0.1) > C(0.05)");
  assert.equal(d.score, 100, "ncav z 1.61 clamps to 100");
});

test("S078 ranks by earnings yield (inverse P/E)", async () => {
  const ctx = valueCtx([["A", FIX.A], ["B", FIX.B], ["C", FIX.C], ["D", FIX.D]]);
  const a = await s078LowPeStrategy.compute(ctx, "A");
  const b = await s078LowPeStrategy.compute(ctx, "B");
  const c = await s078LowPeStrategy.compute(ctx, "C");
  const d = await s078LowPeStrategy.compute(ctx, "D");
  assert.ok(d.score > b.score && b.score > a.score && a.score > c.score,
    "D(0.125) > B(0.1) > A(0.05) > C(0.02)");
  assert.equal(c.score, 0, "ey z < -1 clamps to 0");
  assert.equal(d.score, 100);
});

test("S080 magic formula ranks by EBIT/EV + ROIC z-composite", async () => {
  const ctx = valueCtx([["A", FIX.A], ["B", FIX.B], ["C", FIX.C], ["D", FIX.D]]);
  const a = await s080MagicFormulaStrategy.compute(ctx, "A");
  const b = await s080MagicFormulaStrategy.compute(ctx, "B");
  const c = await s080MagicFormulaStrategy.compute(ctx, "C");
  const d = await s080MagicFormulaStrategy.compute(ctx, "D");
  assert.ok(d.score > c.score && c.score > a.score && a.score > b.score,
    "D(ebitEv z 1.64, roic z -0.51) leads; B worst on both");
  for (const s of [a, b, c, d]) {
    assert.ok(s.score >= 0 && s.score <= 100);
  }
});

test("components carry the five raw metrics + 0-100 family composite", async () => {
  const ctx = valueCtx([["A", FIX.A], ["B", FIX.B], ["C", FIX.C], ["D", FIX.D]]);
  const a = await s099HmlStrategy.compute(ctx, "A");
  assert.equal(a.components.bm, 0.5);
  assert.equal(a.components.ncav, 0.5);
  assert.equal(a.components.ey, 0.05);
  assert.equal(a.components.ebitEv, 0.1);
  assert.equal(a.components.roic, 0.2);
  assert.ok(a.components.composite >= 0 && a.components.composite <= 100);

  const b = await s076NcavStrategy.compute(ctx, "B");
  assert.equal(b.components.bm, 0.2);
  assert.equal(b.components.ncav, 0.1);
  assert.equal(b.components.ey, 0.1);
  assert.equal(b.components.ebitEv, 0.08);
  assert.equal(b.components.roic, 0.1);

  const d = await s078LowPeStrategy.compute(ctx, "D");
  assert.equal(d.components.bm, 1.25);
  assert.equal(d.components.ncav, 1.25);
  assert.equal(d.components.ey, 0.13, "1/8 rounded to 2dp");
  assert.equal(d.components.ebitEv, 0.2);
  assert.equal(d.components.roic, 0.15);
});

test("family composite is the equal-weight z-mean of all five metrics", async () => {
  const ctx = valueCtx([["A", FIX.A], ["B", FIX.B], ["C", FIX.C], ["D", FIX.D]]);
  const all = [FIX.A, FIX.B, FIX.C, FIX.D];
  const zOf = (key, fn) => zscoreOf(all.map(fn))[2]; // symbol C index
  const zs = [
    zOf("bm", (m) => 1 / m.priceToBook),
    zOf("ncav", (m) => (m.currentAssets - m.totalLiabilities) / m.marketCap),
    zOf("ey", (m) => 1 / m.trailingPE),
    zOf("ebitEv", (m) => m.operatingIncome / (m.marketCap + m.totalDebt - m.totalCash)),
    zOf("roic", (m) => m.returnOnCapital),
  ];
  const mean = zs.reduce((x, y) => x + y, 0) / 5;
  const expected = Math.round((50 + 50 * mean) * 100) / 100;
  const c = await s080MagicFormulaStrategy.compute(ctx, "C");
  assert.equal(c.components.composite, expected, `z-mean ${mean.toFixed(6)} -> ${expected}`);
});

test("composite composite ordering follows the value stack", async () => {
  const ctx = valueCtx([["A", FIX.A], ["B", FIX.B], ["C", FIX.C], ["D", FIX.D]]);
  const a = await s099HmlStrategy.compute(ctx, "A");
  const b = await s099HmlStrategy.compute(ctx, "B");
  const c = await s099HmlStrategy.compute(ctx, "C");
  const d = await s099HmlStrategy.compute(ctx, "D");
  assert.equal(d.components.composite, 100, "D leads every metric but roic");
  assert.ok(c.components.composite > a.components.composite, "C edges A on composite");
  assert.ok(a.components.composite > b.components.composite, "A beats B");
});

/* ---------------- missing-data grace ---------------- */

test("missing fundamentals row -> null for every value strategy", async () => {
  const ctx = valueCtx([["A", FIX.A], ["GHOST", null]]);
  for (const s of valueStrategies) {
    assert.equal(await s.compute(ctx, "GHOST"), null);
  }
});

test("context without getFundamentals -> all null, no crash (empty-DB case)", async () => {
  const ctx = {
    getUniverse: () => ["A", "B", "C"],
    getCandles: async () => [],
  };
  for (const s of valueStrategies) {
    assert.equal(await s.compute(ctx, "A"), null);
  }
});

test("partial data: missing priceToBook nulls S099 only; composite survives", async () => {
  const noPb = { ...FIX.B };
  delete noPb.priceToBook;
  const ctx = valueCtx([["A", FIX.A], ["B", noPb], ["C", FIX.C], ["D", FIX.D]]);
  const b99 = await s099HmlStrategy.compute(ctx, "B");
  const b76 = await s076NcavStrategy.compute(ctx, "B");
  assert.equal(b99, null, "S099 needs bm");
  assert.ok(b76, "S076 unaffected");
  assert.equal(b76.components.bm, null);
  assert.ok(b76.components.composite !== null, "composite uses remaining four metrics");
});

test("missing ROIC: S080 scores on EBIT/EV alone", async () => {
  const noRoc = { ...FIX.A };
  delete noRoc.returnOnCapital;
  delete noRoc.totalAssets;
  const ctx = valueCtx([["A", noRoc], ["B", FIX.B], ["C", FIX.C], ["D", FIX.D]]);
  const a = await s080MagicFormulaStrategy.compute(ctx, "A");
  assert.ok(a, "still emits on ebitEv alone");
  const b = await s099HmlStrategy.compute(ctx, "A");
  assert.ok(b.components.roic === null, "roic component null");
});

test("missing both EBIT and ROIC -> S080 null, others emit", async () => {
  const noProfit = { ...FIX.A };
  delete noProfit.operatingIncome;
  delete noProfit.ebit;
  delete noProfit.returnOnCapital;
  delete noProfit.totalAssets;
  const ctx = valueCtx([["A", noProfit], ["B", FIX.B], ["C", FIX.C], ["D", FIX.D]]);
  assert.equal(await s080MagicFormulaStrategy.compute(ctx, "A"), null);
  assert.ok(await s076NcavStrategy.compute(ctx, "A"), "ncav independent of earnings");
  assert.ok(await s078LowPeStrategy.compute(ctx, "A"), "ey independent of EBIT");
});

test("universe smaller than two symbols -> null (z undefined), no crash", async () => {
  const ctx = valueCtx([["A", FIX.A]]);
  for (const s of valueStrategies) {
    assert.equal(await s.compute(ctx, "A"), null);
  }
});

test("no getUniverse -> null, no crash", async () => {
  const ctx = { getFundamentals: async () => FIX.A };
  for (const s of valueStrategies) {
    assert.equal(await s.compute(ctx, "A"), null);
  }
});
