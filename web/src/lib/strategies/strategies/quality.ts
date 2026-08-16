/**
 * T18 — Quality trio composite (S096 Gross Profitability, S102 RMW proxy,
 * S095 Sloan Accruals).
 *
 * One self-contained strategy module (registry wiring lands with a later
 * task; registry.ts is not touched here). Exports the pure per-symbol metric
 * extractor and the cross-sectional composite builder so tests can exercise
 * each layer without a network/DB context.
 *
 * FUNDAMENTALS DATA CONTRACT — getFundamentals() accepts either of two
 * documented shapes, both produced by scripts/ingest-fundamentals.mjs:
 *
 *   1. Flat ("metrics_json", what the T10 runner hands out today):
 *        grossProfit, totalRevenue, operatingIncome, totalAssets,
 *        totalCash, totalDebt, netIncome,
 *        accrual_netIncome, accrual_operatingCashFlow,
 *        accrual_totalAssetsCur, accrual_totalAssetsPrior
 *      Flat keys are the exact flattenMetrics() output. Note: flat
 *      grossProfit is populated from Yahoo financialData.grossProfits by
 *      flattenMetrics (source key documented there).
 *
 *   2. Nested ("module_json", raw quoteSummary.result[0]):
 *        financialData.{grossProfits,grossProfit,totalRevenue,
 *          operatingIncome,netIncome}
 *        incomeStatementHistory.incomeStatementHistory[0].
 *          {grossProfit,totalRevenue,costOfRevenue,operatingIncome,netIncome}
 *        balanceSheetHistory.balanceSheetStatements[0..1].
 *          {totalAssets,cash|cashAndShortTermInvestments|
 *           cashCashEquivalentsAndShortTermInvestments,
 *           totalDebt,totalLiabilities|totalLiabilitiesNetMinorityInterest}
 *        cashflowStatementHistory.cashflowStatements[0].{operatingCashflow}
 *      Values may be numbers or Yahoo {raw,fmt} objects.
 *
 * METRIC FORMULAS (exact):
 *   S096 gpA  = grossProfit / totalAssets
 *              (grossProfit source chain: financialData.grossProfits →
 *               financialData.grossProfit → incomeStatementHistory
 *               grossProfit → income totalRevenue − costOfRevenue)
 *   S102 opMargin = operatingIncome / totalRevenue
 *   S095 accruals:
 *       preferred (needs 2 full balance-sheet years) — ΔNOA / avg(totalAssets):
 *         NOA = totalAssets − cash − (totalLiabilities − totalDebt)
 *         [simplification: non-debt liabilities = totalLiabilities − totalDebt;
 *          NOA = operating assets net of operating liabilities]
 *         accruals = (NOA_cur − NOA_prior) / ((TA_cur + TA_prior) / 2)
 *       fallback (balance-sheet depth missing) — Sloan's CFO proxy:
 *         accruals = (netIncome − CFO) / avg(totalAssets)
 *         avg = (TA_cur + TA_prior)/2, else TA_cur when prior year is absent.
 *       Higher accruals = lower earnings quality (Sloan 1996) → inverted in
 *       the composite.
 *
 * COMPOSITE (cross-sectional, per run):
 *   For each of {gpA, opMargin, accruals}: z = (x − mean)/max(std, 1e-9),
 *   clamped to ±3, computed over every universe symbol with that metric
 *   (n >= 3). composite z = equal-weight mean of (zGp + zOp − zAcc).
 *   score 0-100 = equal-weight mean of the per-metric tie-averaged
 *   percentile ranks (pctRank from indicators.ts), accruals inverted —
 *   the percentile rank is the robust transform of the z composite and
 *   stays meaningful for small cross-sections. Single-symbol run: pctRank
 *   defines a lone value at percentile 0; with all three metrics present
 *   the accrual inversion maps its own 0-percentile to 100, so the lone
 *   composite is deterministically (0+0+100)/3 = 33.33 — documented
 *   transform, meaningful only as a neutral placeholder. z components are
 *   null when n < 3. Components with insufficient data are null (never
 *   NaN, never a throw).
 */
import type { Signal, Strategy, StrategyContext, StrategyMeta } from "../types";
import { pctRank, safeDiv } from "../indicators";

const CONCURRENCY = 10;
const Z_CLAMP = 3;
const STD_FLOOR = 1e-9;
const MIN_Z_SAMPLE = 3;

type Json = Record<string, unknown>;

export interface QualityMetrics {
  /** S096 gross profitability: grossProfit / totalAssets. */
  gpA: number | null;
  /** S102 RMW proxy: operatingIncome / totalRevenue. */
  opMargin: number | null;
  /** S095 accruals (higher = lower quality). */
  accruals: number | null;
  /** Which accrual variant was computed: "noa" | "cfo" | null. */
  accrualModel: "noa" | "cfo" | null;
}

export interface CompositeResult {
  /** Equal-weight percentile composite, 0-100 (accruals inverted). */
  score: number | null;
  zGp: number | null;
  zOp: number | null;
  zAcc: number | null;
  pctGp: number | null;
  pctOp: number | null;
  pctAcc: number | null;
}

/** Robust number coercion: number, numeric string, or Yahoo {raw,fmt}. */
export function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (v !== null && typeof v === "object") {
    const raw = (v as Json).raw;
    if (raw !== undefined) return num(raw);
  }
  return null;
}

function pick(o: Json, keys: string[]): number | null {
  for (const k of keys) {
    const v = num(o[k]);
    if (v !== null) return v;
  }
  return null;
}

interface BsYear {
  totalAssets: number | null;
  cash: number | null;
  totalDebt: number | null;
  totalLiabilities: number | null;
}

interface NestedShape {
  grossProfit: number | null;
  totalRevenue: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  cfo: number | null;
  bs: (BsYear | null)[];
}

const BS_CASH_KEYS = [
  "cash",
  "cashAndShortTermInvestments",
  "cashCashEquivalentsAndShortTermInvestments",
];
const BS_TL_KEYS = ["totalLiabilities", "totalLiabilitiesNetMinorityInterest"];

function readNested(record: Json): NestedShape | null {
  if (
    !("financialData" in record) &&
    !("incomeStatementHistory" in record) &&
    !("balanceSheetHistory" in record) &&
    !("cashflowStatementHistory" in record)
  ) {
    return null;
  }
  const fin =
    record.financialData && typeof record.financialData === "object"
      ? (record.financialData as Json)
      : {};
  const incomeRaw =
    record.incomeStatementHistory &&
    typeof record.incomeStatementHistory === "object"
      ? (record.incomeStatementHistory as Json).incomeStatementHistory
      : undefined;
  const income = Array.isArray(incomeRaw) ? (incomeRaw as Json[]) : [];
  const income0 = income.length > 0 && typeof income[0] === "object" ? income[0] : {};
  const bsRaw =
    record.balanceSheetHistory && typeof record.balanceSheetHistory === "object"
      ? (record.balanceSheetHistory as Json).balanceSheetStatements
      : undefined;
  const bs = Array.isArray(bsRaw) ? (bsRaw as Json[]) : [];
  const cfRaw =
    record.cashflowStatementHistory &&
    typeof record.cashflowStatementHistory === "object"
      ? (record.cashflowStatementHistory as Json).cashflowStatements
      : undefined;
  const cf = Array.isArray(cfRaw) ? (cfRaw as Json[]) : [];
  const cf0 = cf.length > 0 && typeof cf[0] === "object" ? cf[0] : {};

  const bsYear = (b: Json): BsYear => ({
    totalAssets: pick(b, ["totalAssets"]),
    cash: pick(b, BS_CASH_KEYS),
    totalDebt: pick(b, ["totalDebt"]),
    totalLiabilities: pick(b, BS_TL_KEYS),
  });

  return {
    grossProfit:
      pick(fin, ["grossProfits", "grossProfit"]) ??
      pick(income0, ["grossProfit"]) ??
      (income0.totalRevenue !== undefined && income0.costOfRevenue !== undefined
        ? (() => {
            const rev = num(income0.totalRevenue);
            const cogs = num(income0.costOfRevenue);
            return rev !== null && cogs !== null ? rev - cogs : null;
          })()
        : null),
    totalRevenue:
      pick(fin, ["totalRevenue"]) ?? pick(income0, ["totalRevenue"]),
    operatingIncome:
      pick(fin, ["operatingIncome"]) ?? pick(income0, ["operatingIncome"]),
    netIncome: pick(fin, ["netIncome"]) ?? pick(income0, ["netIncome"]),
    cfo: pick(cf0, ["operatingCashflow"]),
    bs: [bs.length > 0 ? bsYear(bs[0]) : null, bs.length > 1 ? bsYear(bs[1]) : null],
  };
}

/** NOA = totalAssets − cash − (totalLiabilities − totalDebt). */
function noa(y: BsYear): number | null {
  if (
    y.totalAssets === null ||
    y.cash === null ||
    y.totalLiabilities === null ||
    y.totalDebt === null
  ) {
    return null;
  }
  return y.totalAssets - y.cash - (y.totalLiabilities - y.totalDebt);
}

/**
 * Pure per-symbol metric extraction. Never throws, never returns NaN:
 * every missing/malformed input degrades to null. Accepts the flat
 * metrics_json shape or the nested module_json shape (see header).
 */
export function computeQuality(record: Record<string, unknown>): QualityMetrics {
  const r = record as Json;
  const nested = readNested(r);

  // ---- S096 gross profitability: grossProfit / totalAssets ----
  const grossProfit = nested?.grossProfit ?? pick(r, ["grossProfit"]);
  const totalAssets =
    nested?.bs[0]?.totalAssets ?? pick(r, ["totalAssets", "accrual_totalAssetsCur"]);
  const gpA = safeDiv(grossProfit, totalAssets);

  // ---- S102 RMW proxy: operatingIncome / totalRevenue ----
  const operatingIncome =
    nested?.operatingIncome ?? pick(r, ["operatingIncome"]);
  const totalRevenue = nested?.totalRevenue ?? pick(r, ["totalRevenue"]);
  const opMargin = safeDiv(operatingIncome, totalRevenue);

  // ---- S095 accruals ----
  let accruals: number | null = null;
  let accrualModel: "noa" | "cfo" | null = null;

  if (nested && nested.bs[0] !== null && nested.bs[1] !== null) {
    const noaCur = noa(nested.bs[0]);
    const noaPrior = noa(nested.bs[1]);
    const taCur = nested.bs[0].totalAssets;
    const taPrior = nested.bs[1].totalAssets;
    if (
      noaCur !== null &&
      noaPrior !== null &&
      taCur !== null &&
      taPrior !== null
    ) {
      const avgTa = (taCur + taPrior) / 2;
      accruals = safeDiv(noaCur - noaPrior, avgTa);
      accrualModel = "noa";
    }
  }

  if (accruals === null) {
    const netIncome =
      nested?.netIncome ?? pick(r, ["accrual_netIncome", "netIncome"]);
    const cfo = nested?.cfo ?? pick(r, ["accrual_operatingCashFlow"]);
    const taCur =
      nested?.bs[0]?.totalAssets ??
      pick(r, ["accrual_totalAssetsCur", "totalAssets"]);
    const taPrior =
      nested?.bs[1]?.totalAssets ?? pick(r, ["accrual_totalAssetsPrior"]);
    const avgTa =
      taCur !== null && taPrior !== null
        ? (taCur + taPrior) / 2
        : taCur;
    if (netIncome !== null && cfo !== null && avgTa !== null) {
      accruals = safeDiv(netIncome - cfo, avgTa);
      accrualModel = "cfo";
    }
  }

  return { gpA, opMargin, accruals, accrualModel };
}

/** Cross-sectional z: (x − mean)/max(std, 1e-9), clamped ±3; null for n < 3. */
function crossZ(values: number[]): (number | null)[] {
  const n = values.length;
  if (n < MIN_Z_SAMPLE) return new Array(n).fill(null);
  let mean = 0;
  for (const v of values) mean += v;
  mean /= n;
  let variance = 0;
  for (const v of values) variance += (v - mean) * (v - mean);
  variance /= n;
  const std = Math.sqrt(variance);
  if (!Number.isFinite(std)) return new Array(n).fill(null);
  const robust = Math.max(std, STD_FLOOR);
  return values.map((v) => {
    const z = (v - mean) / robust;
    return Math.max(-Z_CLAMP, Math.min(Z_CLAMP, z));
  });
}

/**
 * Equal-weight composite over a universe of per-symbol QualityMetrics.
 * z components (n >= 3) are reported per symbol; the 0-100 score is the
 * equal-weight mean of per-metric tie-averaged percentile ranks, with the
 * accruals rank inverted (low accruals = high quality). Symbols with no
 * available metric map to null — never NaN.
 */
export function buildComposite(
  rows: Map<string, QualityMetrics>
): Map<string, CompositeResult> {
  const gpList: { sym: string; v: number }[] = [];
  const opList: { sym: string; v: number }[] = [];
  const accList: { sym: string; v: number }[] = [];
  for (const [sym, m] of rows) {
    if (m.gpA !== null) gpList.push({ sym, v: m.gpA });
    if (m.opMargin !== null) opList.push({ sym, v: m.opMargin });
    if (m.accruals !== null) accList.push({ sym, v: m.accruals });
  }

  const zGpBySym = crossZ(gpList.map((e) => e.v));
  const zOpBySym = crossZ(opList.map((e) => e.v));
  const zAccBySym = crossZ(accList.map((e) => e.v));
  const pctGpBySym = pctRank(gpList.map((e) => e.v));
  const pctOpBySym = pctRank(opList.map((e) => e.v));
  const pctAccBySym = pctRank(accList.map((e) => e.v));

  const out = new Map<string, CompositeResult>();
  for (const [sym] of rows) {
    const gi = gpList.findIndex((e) => e.sym === sym);
    const oi = opList.findIndex((e) => e.sym === sym);
    const ai = accList.findIndex((e) => e.sym === sym);

    const pcts: number[] = [];
    if (gi !== -1 && pctGpBySym[gi] !== null) pcts.push(pctGpBySym[gi] as number);
    if (oi !== -1 && pctOpBySym[oi] !== null) pcts.push(pctOpBySym[oi] as number);
    if (ai !== -1 && pctAccBySym[ai] !== null) pcts.push(100 - (pctAccBySym[ai] as number));

    let score: number | null = null;
    if (pcts.length > 0) {
      let sum = 0;
      for (const p of pcts) sum += p;
      score = sum / pcts.length;
    }

    out.set(sym, {
      score,
      zGp: gi !== -1 ? zGpBySym[gi] : null,
      zOp: oi !== -1 ? zOpBySym[oi] : null,
      zAcc: ai !== -1 ? zAccBySym[ai] : null,
      pctGp: gi !== -1 ? pctGpBySym[gi] : null,
      pctOp: oi !== -1 ? pctOpBySym[oi] : null,
      pctAcc: ai !== -1 ? pctAccBySym[ai] : null,
    });
  }
  return out;
}

/* ---------------- strategy ---------------- */

const meta: StrategyMeta = {
  id: "S18-quality",
  name: "Quality Composite (Gross Profitability + RMW + Accruals)",
  category: "quality",
  juryRank: 4,
  edgeScore: 9.0,
  universe: "nifty500",
  inputs: ["accrualModel=noa|cfo", "weights=equal", "zClamp=3", "minZSample=3"],
  description:
    "T18 quality trio composite: S096 Novy-Marx gross profitability (GP/assets), " +
    "S102 FF operating profitability proxy (OP/revenue), S095 Sloan accruals " +
    "(ΔNOA/avg assets, CFO-proxy fallback). Equal-weight cross-sectional z/percentile " +
    "composite, accruals inverted; juryRank/edgeScore = best of family (S096).",
};

interface Distribution {
  day: number;
  universe: string;
  rows: Map<string, QualityMetrics>;
}

const cache = new WeakMap<StrategyContext, Distribution>();

async function loadRows(ctx: StrategyContext, universe: "nifty50" | "nifty500"): Promise<Distribution> {
  const day = Math.floor(Date.now() / 86_400_000);
  const hit = cache.get(ctx);
  if (hit && hit.day === day && hit.universe === universe) return hit;

  const symbols = ctx.getUniverse ? ctx.getUniverse(universe) ?? [] : [];
  const rows = new Map<string, QualityMetrics>();

  if (ctx.getFundamentals) {
    for (let start = 0; start < symbols.length; start += CONCURRENCY) {
      const chunk = symbols.slice(start, start + CONCURRENCY);
      const results = await Promise.all(
        chunk.map(async (symbol) => {
          try {
            const f = await ctx.getFundamentals!(symbol);
            if (!f || typeof f !== "object") return null;
            const m = computeQuality(f as Record<string, unknown>);
            if (m.gpA === null && m.opMargin === null && m.accruals === null) return null;
            return [symbol, m] as const;
          } catch {
            return null;
          }
        })
      );
      for (const r of results) {
        if (r) rows.set(r[0], r[1]);
      }
    }
  }

  const dist: Distribution = { day, universe, rows };
  cache.set(ctx, dist);
  return dist;
}

function round(x: number | null, digits: number): number | null {
  if (x === null || !Number.isFinite(x)) return null;
  const f = Math.pow(10, digits);
  return Math.round(x * f) / f;
}

export const qualityStrategy: Strategy = {
  meta,
  async compute(ctx: StrategyContext, symbol: string): Promise<Signal | null> {
    const dist = await loadRows(ctx, meta.universe);
    const m = dist.rows.get(symbol);
    if (!m) return null;

    const composite = buildComposite(dist.rows);
    const c = composite.get(symbol);
    if (!c || c.score === null) return null;

    const score = Math.round(c.score * 100) / 100;
    const signal: Signal = {
      symbol,
      score,
      rank: 0,
      components: {
        gpA: round(m.gpA, 6),
        opMargin: round(m.opMargin, 6),
        accruals: round(m.accruals, 6),
        zGp: round(c.zGp, 3),
        zOp: round(c.zOp, 3),
        zAcc: round(c.zAcc, 3),
        composite: score,
        accrualModel: m.accrualModel,
        sampleSize: dist.rows.size,
      },
    };
    return signal;
  },
};
