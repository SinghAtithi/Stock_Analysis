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

const { s081Strategy } = await import(
  "../../web/src/lib/strategies/strategies/s081-fscore.ts"
);

/* ---------------- fixture helpers ---------------- */

const f = (raw) => ({ raw, fmt: String(raw) });

/** Perfect-health module payload: every criterion passes (see numbers below). */
function perfectModule() {
  return {
    defaultKeyStatistics: { sharesOutstanding: f(100) },
    incomeStatementHistory: {
      incomeStatementHistory: [
        { netIncome: f(500), grossProfit: f(800), totalRevenue: f(2000) },
        { netIncome: f(400), grossProfit: f(550), totalRevenue: f(1500) },
      ],
    },
    balanceSheetHistory: {
      balanceSheetStatements: [
        {
          totalAssets: f(5000),
          totalDebt: f(1000),
          currentAssets: f(3000),
          currentLiabilities: f(1000),
          totalCommonSharesOutstanding: f(100),
        },
        {
          totalAssets: f(4500),
          totalDebt: f(1200),
          currentAssets: f(2400),
          currentLiabilities: f(1200),
          totalCommonSharesOutstanding: f(120),
        },
      ],
    },
    cashflowStatementHistory: {
      cashflowStatements: [{ operatingCashflow: f(600) }],
    },
  };
}

/** Row shape as stored in the fundamentals table (metrics_json + module_json). */
function fundRow({ flat = {}, module = perfectModule() } = {}) {
  return {
    metrics_json: {
      netIncome: 500,
      totalAssets: 5000,
      accrual_totalAssetsPrior: 4500,
      accrual_netIncome: 500,
      accrual_operatingCashFlow: 600,
      totalDebt: 1000,
      grossProfit: 800,
      totalRevenue: 2000,
      ...flat,
    },
    module_json: module,
  };
}

function ctxWithFund(fundOrNull) {
  return { getFundamentals: async () => fundOrNull };
}

/* Hand-computed expectations for the perfect fixture:
   p1 ROA  500/5000        = 0.10      > 0                 : true
   p2 OCF  600             > 0                             : true
   p3 dROA 0.10 > 400/4500 = 0.0889                        : true
   p4 CFO>NI 600 > 500                                     : true
   p5 dLev 1000/5000=0.2 < 1200/4500=0.2667                : true
   p6 dCR  3000/1000=3.0 > 2400/1200=2.0                   : true
   p7 dil  100 <= 120                                      : true
   p8 dGM  800/2000=0.40 > 550/1500=0.3667                 : true
   p9 dTurn 2000/5000=0.40 > 1500/4500=0.3333              : true  */

test("S081 perfect fixture scores 9/9 (score 100)", async () => {
  const sig = await s081Strategy.compute(ctxWithFund(fundRow()), "PERFECT");
  assert.ok(sig, "signal emitted");
  assert.equal(sig.score, 100);
  assert.equal(sig.rank, 0, "rank assigned by runner");
  assert.equal(sig.components.fscore, 9);
  for (let i = 1; i <= 9; i++) {
    assert.equal(sig.components[`p${i}`], 1, `p${i} passes`);
  }
});

test("S081 worst-case fixture scores 0/9 (score 0)", async () => {
  const worst = fundRow({
    flat: {
      netIncome: -100,
      totalAssets: 5000,
      accrual_totalAssetsPrior: 5000,
      accrual_netIncome: -100,
      accrual_operatingCashFlow: -150,
      totalDebt: 2000,
      grossProfit: 100,
      totalRevenue: 1000,
    },
    module: {
      defaultKeyStatistics: { sharesOutstanding: f(200) },
      incomeStatementHistory: {
        incomeStatementHistory: [
          { netIncome: f(-100), grossProfit: f(100), totalRevenue: f(1000) },
          { netIncome: f(-50), grossProfit: f(200), totalRevenue: f(1200) },
        ],
      },
      balanceSheetHistory: {
        balanceSheetStatements: [
          {
            totalAssets: f(5000),
            totalDebt: f(2000),
            currentAssets: f(800),
            currentLiabilities: f(2000),
            totalCommonSharesOutstanding: f(200),
          },
          {
            totalAssets: f(5000),
            totalDebt: f(1000),
            currentAssets: f(1000),
            currentLiabilities: f(1000),
            totalCommonSharesOutstanding: f(100),
          },
        ],
      },
      cashflowStatementHistory: {
        cashflowStatements: [{ operatingCashflow: f(-150) }],
      },
    },
  });
  const sig = await s081Strategy.compute(ctxWithFund(worst), "WORST");
  assert.ok(sig, "signal emitted");
  assert.equal(sig.score, 0);
  assert.equal(sig.components.fscore, 0);
  for (let i = 1; i <= 9; i++) {
    assert.equal(sig.components[`p${i}`], 0, `p${i} fails`);
  }
});

test("S081 nulls when prior-year data missing for >=4 criteria", async () => {
  const noPrior = fundRow({
    flat: {
      accrual_totalAssetsPrior: null,
    },
    module: null,
  });
  const sig = await s081Strategy.compute(ctxWithFund(noPrior), "NOPRIOR");
  assert.equal(sig, null, "flat-only metrics cannot price 6 of 9 criteria");

  const onlyFlat = fundRow({ module: null });
  assert.equal(
    await s081Strategy.compute(ctxWithFund(onlyFlat), "NOASSETPRIOR"),
    null,
    "no module_json at all -> prior year missing"
  );
});

test("S081 is graceful against an empty fundamentals table", async () => {
  assert.equal(
    await s081Strategy.compute(ctxWithFund(null), "EMPTY"),
    null,
    "getFundamentals returns null (empty DB row)"
  );
  assert.equal(
    await s081Strategy.compute({ getCandles: () => [] }, "EMPTY"),
    null,
    "getFundamentals not wired in context"
  );
  assert.equal(
    await s081Strategy.compute(
      { getFundamentals: async () => {
        throw new Error("db down");
      } },
      "EMPTY"
    ),
    null,
    "must never throw"
  );
});

test("S081 emits with one missing criterion counted as 0", async () => {
  const mod = perfectModule();
  delete mod.balanceSheetHistory.balanceSheetStatements[1].totalCommonSharesOutstanding;
  const sig = await s081Strategy.compute(ctxWithFund(fundRow({ module: mod })), "ONEGAP");
  assert.ok(sig, "1 missing criterion < 4 -> emitted");
  assert.equal(sig.components.fscore, 8);
  assert.equal(sig.components.p7, 0, "dilution unknown counts as not-passing");
  assert.ok(Math.abs(sig.score - 88.89) < 0.01, `score ${sig.score} = 8/9*100`);
});

/* ---------------- per-criterion math on known numbers ---------------- */

test("S081 criterion math: flips verified one at a time", async () => {
  const expect = async (flat, module, zeros) => {
    const sig = await s081Strategy.compute(
      ctxWithFund(fundRow({ flat, module })),
      "FLIP"
    );
    assert.ok(sig, "signal emitted");
    for (let i = 1; i <= 9; i++) {
      assert.equal(
        sig.components[`p${i}`],
        zeros.includes(i) ? 0 : 1,
        `p${i} expected ${zeros.includes(i) ? "fail" : "pass"}`
      );
    }
    assert.equal(sig.components.fscore, 9 - zeros.length);
  };

  await expect({ netIncome: -1 }, perfectModule(), [1, 3]); // ROA -0.0002 < 0; dROA vs 0.0889 also negative
  await expect({ netIncome: 350 }, perfectModule(), [3]); // ROA 0.07 still > 0, but < prior 0.0889
  await expect({ accrual_operatingCashFlow: -1 }, perfectModule(), [2, 4]); // CFO -1 < 0; -1 < NI 500
  await expect({ accrual_operatingCashFlow: 400 }, perfectModule(), [4]); // 400 > 0 but < NI 500
});

test("S081 criterion math: leverage flip uses exact inequality", async () => {
  const sig = await s081Strategy.compute(
    ctxWithFund(fundRow({ flat: { totalDebt: 1350 } })),
    "LEV"
  ); // 1350/5000 = 0.27 > 1200/4500 = 0.2667 -> leverage up
  assert.ok(sig);
  assert.equal(sig.components.p5, 0);
  assert.equal(sig.components.fscore, 8);
});

test("S081 criterion math: current-ratio, dilution, margin, turnover flips", async () => {
  const modA = perfectModule();
  modA.balanceSheetHistory.balanceSheetStatements[0].currentAssets = f(1000); // 1.0 < 2.0
  const a = await s081Strategy.compute(ctxWithFund(fundRow({ module: modA })), "CR");
  assert.ok(a);
  assert.equal(a.components.p6, 0);

  const modB = perfectModule();
  modB.defaultKeyStatistics.sharesOutstanding = f(150); // 150 > 120 -> dilution
  const b = await s081Strategy.compute(ctxWithFund(fundRow({ module: modB })), "DIL");
  assert.ok(b);
  assert.equal(b.components.p7, 0);

  const modC = perfectModule();
  modC.incomeStatementHistory.incomeStatementHistory[1].grossProfit = f(650); // 0.4333 > 0.40
  const c = await s081Strategy.compute(ctxWithFund(fundRow({ module: modC })), "GM");
  assert.ok(c);
  assert.equal(c.components.p8, 0);

  const modD = perfectModule();
  modD.incomeStatementHistory.incomeStatementHistory[1].totalRevenue = f(2300); // 0.5111 > 0.40
  const d = await s081Strategy.compute(ctxWithFund(fundRow({ module: modD })), "TURN");
  assert.ok(d);
  assert.equal(d.components.p9, 0);
});

test("S081 meta matches jury record", () => {
  assert.equal(s081Strategy.meta.id, "S081");
  assert.equal(s081Strategy.meta.juryRank, 9);
  assert.equal(s081Strategy.meta.category, "value");
  assert.ok(Math.abs(s081Strategy.meta.edgeScore - 8.67) < 1e-9);
});
