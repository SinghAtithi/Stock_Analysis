import type { Signal, Strategy, StrategyContext, StrategyMeta } from "../types";
import { register } from "../registry";

/**
 * S081 — Piotroski F-Score (jury rank #9). Classic 9-criteria 0-9 score over
 * two years of stored fundamentals. Current-year values come from the flat
 * metrics (flattenMetrics EXACT keys); prior-year values and share counts come
 * from the raw module_json histories. Criterion 7's share count is sourced
 * from defaultKeyStatistics.sharesOutstanding (cur) vs
 * balanceSheetHistory.balanceSheetStatements[1].totalCommonSharesOutstanding
 * (prior) — neither key is flattened.
 *
 * Null when prior-year data is missing for >= 4 criteria; missing criteria in
 * emitted signals count as not-passing (conservative).
 */

type Row = Record<string, unknown>;

function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Flat metrics, accepting either the row's metrics_json or the row itself. */
function flatOf(fund: Row, key: string): number | null {
  const direct = num(fund[key]);
  if (direct !== null) return direct;
  const nested = fund.metrics_json;
  if (nested && typeof nested === "object") return num((nested as Row)[key]);
  return null;
}

/** Yahoo {raw, fmt} value. */
function rawOf(o: Row | undefined, key: string): number | null {
  if (!o) return null;
  const v = o[key];
  if (!v || typeof v !== "object") return null;
  return num((v as Row).raw);
}

function histOf(
  mod: Row | null,
  section: string,
  listKey: string,
  i: number,
  key: string
): number | null {
  if (!mod) return null;
  const sec = mod[section];
  if (!sec || typeof sec !== "object") return null;
  const list = (sec as Row)[listKey];
  if (!Array.isArray(list)) return null;
  return rawOf(list[i] as Row | undefined, key);
}

/** n / d with a strict positive denominator; null when undefined. */
function ratio(n: number | null, d: number | null): number | null {
  if (n === null || d === null || d <= 0) return null;
  return n / d;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

const meta: StrategyMeta = {
  id: "S081",
  name: "Piotroski F-Score",
  category: "value",
  juryRank: 9,
  edgeScore: 8.67,
  universe: "nifty500",
  inputs: [],
  description:
    "Piotroski F-Score: 9-point fundamental health screen (profitability, accrual quality, leverage/liquidity, efficiency), scored 0-100 as (fscore/9)*100.",
};

const SECTIONS = {
  bs: "balanceSheetHistory",
  bsList: "balanceSheetStatements",
  inc: "incomeStatementHistory",
  incList: "incomeStatementHistory",
} as const;

export const s081Strategy: Strategy = {
  meta,
  async compute(ctx: StrategyContext, symbol: string): Promise<Signal | null> {
    try {
      const snapshot = ctx.getFundamentals
        ? await ctx.getFundamentals(symbol)
        : null;
      if (!snapshot || typeof snapshot !== "object") return null;
      const fund = snapshot as Row;
      const mod =
        fund.module_json && typeof fund.module_json === "object"
          ? (fund.module_json as Row)
          : null;

      const ni = flatOf(fund, "netIncome") ?? flatOf(fund, "accrual_netIncome");
      const ocf = flatOf(fund, "accrual_operatingCashFlow");
      const assetsCur =
        flatOf(fund, "totalAssets") ?? flatOf(fund, "accrual_totalAssetsCur");
      const assetsPrior =
        flatOf(fund, "accrual_totalAssetsPrior") ??
        histOf(mod, SECTIONS.bs, SECTIONS.bsList, 1, "totalAssets");
      const debtCur = flatOf(fund, "totalDebt");
      const debtPrior = histOf(mod, SECTIONS.bs, SECTIONS.bsList, 1, "totalDebt");
      const revCur = flatOf(fund, "totalRevenue");
      const gpCur = flatOf(fund, "grossProfit");
      const niPrior = histOf(mod, SECTIONS.inc, SECTIONS.incList, 1, "netIncome");
      const gpPrior = histOf(mod, SECTIONS.inc, SECTIONS.incList, 1, "grossProfit");
      const revPrior = histOf(mod, SECTIONS.inc, SECTIONS.incList, 1, "totalRevenue");

      const roaCur = ratio(ni, assetsCur);
      const roaPrior = ratio(niPrior, assetsPrior);
      const levCur = ratio(debtCur, assetsCur);
      const levPrior = ratio(debtPrior, assetsPrior);
      const crCur = ratio(
        histOf(mod, SECTIONS.bs, SECTIONS.bsList, 0, "currentAssets"),
        histOf(mod, SECTIONS.bs, SECTIONS.bsList, 0, "currentLiabilities")
      );
      const crPrior = ratio(
        histOf(mod, SECTIONS.bs, SECTIONS.bsList, 1, "currentAssets"),
        histOf(mod, SECTIONS.bs, SECTIONS.bsList, 1, "currentLiabilities")
      );
      const gmCur = ratio(gpCur, revCur);
      const gmPrior = ratio(gpPrior, revPrior);
      const atCur = ratio(revCur, assetsCur);
      const atPrior = ratio(revPrior, assetsPrior);

      const dks = mod?.defaultKeyStatistics;
      const sharesCur =
        dks && typeof dks === "object"
          ? rawOf(dks as Row, "sharesOutstanding")
          : null;
      const sharesPrior = histOf(
        mod,
        SECTIONS.bs,
        SECTIONS.bsList,
        1,
        "totalCommonSharesOutstanding"
      );

      const p1 = roaCur === null ? null : roaCur > 0;
      const p2 = ocf === null ? null : ocf > 0;
      const p3 =
        roaCur === null || roaPrior === null ? null : roaCur > roaPrior;
      const p4 = ocf === null || ni === null ? null : ocf > ni;
      const p5 =
        levCur === null || levPrior === null ? null : levCur < levPrior;
      const p6 = crCur === null || crPrior === null ? null : crCur > crPrior;
      const p7 =
        sharesCur === null || sharesPrior === null
          ? null
          : sharesCur <= sharesPrior;
      const p8 = gmCur === null || gmPrior === null ? null : gmCur > gmPrior;
      const p9 = atCur === null || atPrior === null ? null : atCur > atPrior;

      const criteria = [p1, p2, p3, p4, p5, p6, p7, p8, p9];
      const missing = criteria.filter((c) => c === null).length;
      if (missing >= 4) return null;

      const fscore = criteria.filter((c) => c === true).length;
      const signal: Signal = {
        symbol,
        score: round2((fscore / 9) * 100),
        rank: 0,
        components: {
          fscore,
          p1: p1 === true ? 1 : 0,
          p2: p2 === true ? 1 : 0,
          p3: p3 === true ? 1 : 0,
          p4: p4 === true ? 1 : 0,
          p5: p5 === true ? 1 : 0,
          p6: p6 === true ? 1 : 0,
          p7: p7 === true ? 1 : 0,
          p8: p8 === true ? 1 : 0,
          p9: p9 === true ? 1 : 0,
        },
      };
      return signal;
    } catch {
      return null;
    }
  },
};

register(s081Strategy);
