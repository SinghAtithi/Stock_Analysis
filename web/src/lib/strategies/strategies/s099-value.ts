/**
 * Value family (T19): S099 Value Factor (HML), S076 Graham Net-Net (NCAV),
 * S078 Low P/E, S080 Greenblatt Magic Formula.
 *
 * All four are cross-sectional: each symbol's raw metric (or z-composite of
 * metrics) is z-scored against the design universe, then mapped to 0-100 via
 * score = clamp(50 + 50*z, 0, 100). The family composite (component of every
 * signal) is the equal-weight z-mean of all five metrics, same 0-100 mapping.
 *
 * Source keys (T10 flattenMetrics metrics_json unless noted):
 *   marketCap, priceToBook, bookValue (Yahoo per-share!), trailingPE,
 *   earningsYield (=1/trailingPE), operatingIncome, ebit, totalDebt,
 *   totalCash, totalAssets, returnOnCapital.
 * NCAV inputs are NOT flattened by T10 yet, so they are read defensively:
 *   metrics_json: currentAssets ?? totalCurrentAssets, totalLiabilities
 *   raw module_json: balanceSheetHistory.balanceSheetStatements[0].
 *     totalCurrentAssets / totalLiabilities
 *
 * NOTE on B/M: Yahoo's bookValue is PER-SHARE, so bookValue/marketCap would be
 * dimensionally wrong (B_ps/(P*shares)). B/M = 1/priceToBook (≡ total book
 * equity / marketCap); fallback: bookValue / lastClose (per-share vs per-share).
 *
 * Never throws: missing keys, empty universes, or a context without
 * getFundamentals yield null signals, not exceptions.
 */
import type {
  Signal,
  Strategy,
  StrategyContext,
  StrategyMeta,
} from "../types";
import { evalDay } from "../pointInTime";
import { safeDiv, zscore } from "../indicators";

const CONCURRENCY = 10;
const MIN_SAMPLES = 2;

type MetricKey = "bm" | "ncav" | "ey" | "ebitEv" | "roic";

interface RawMetrics {
  bm: number | null;
  ncav: number | null;
  ey: number | null;
  ebitEv: number | null;
  roic: number | null;
  ev: number | null;
}

const ALL_METRICS: MetricKey[] = ["bm", "ncav", "ey", "ebitEv", "roic"];

/** Raw quoteSummary balance-sheet shape (module_json) for NCAV fallback. */
interface RawBalanceSheet {
  totalCurrentAssets?: unknown;
  totalLiabilities?: unknown;
}
interface RawQuoteSummary {
  balanceSheetHistory?: { balanceSheetStatements?: RawBalanceSheet[] };
}

function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/** z-score → 0-100: clamp(50 + 50*z). */
export function zToScore(z: number): number {
  return Math.max(0, Math.min(100, 50 + 50 * z));
}

/**
 * Five raw value metrics from a fundamentals record. Accepts the T10
 * flattened metrics_json shape (primary), and falls back to the raw
 * quoteSummary module shape (balanceSheetHistory) for balance-sheet keys.
 */
export function valueMetrics(
  fund: Record<string, unknown>,
  price: number | null = null
): RawMetrics {
  const bs0: RawBalanceSheet =
    ((fund as RawQuoteSummary).balanceSheetHistory?.balanceSheetStatements?.[0]) ?? {};

  const marketCap = num(fund.marketCap);
  const trailingPE = num(fund.trailingPE);

  // B/M = 1/priceToBook (priceToBook = marketCap/total book equity).
  // Fallback: per-share bookValue / per-share price.
  const pb = num(fund.priceToBook);
  let bm: number | null = null;
  if (pb !== null && pb > 0) {
    bm = safeDiv(1, pb);
  } else if (marketCap !== null && marketCap > 0) {
    const bookValue = num(fund.bookValue);
    if (bookValue !== null && bookValue > 0 && price !== null && price > 0) {
      bm = safeDiv(bookValue, price);
    }
  }

  // NCAV / market cap: (currentAssets - totalLiabilities) / marketCap.
  const currentAssets =
    num(fund.currentAssets) ?? num(fund.totalCurrentAssets) ?? num(bs0.totalCurrentAssets);
  const totalLiabilities =
    num(fund.totalLiabilities) ?? num(bs0.totalLiabilities);
  let ncav: number | null = null;
  if (
    marketCap !== null &&
    marketCap > 0 &&
    currentAssets !== null &&
    totalLiabilities !== null
  ) {
    ncav = safeDiv(currentAssets - totalLiabilities, marketCap);
  }

  // Earnings yield: 1 / trailing PE.
  const ey =
    num(fund.earningsYield) ?? (trailingPE !== null && trailingPE > 0 ? 1 / trailingPE : null);

  // EBIT / EV: EV = marketCap + totalDebt - totalCash; EBIT = operatingIncome.
  const ebit = num(fund.operatingIncome) ?? num(fund.ebit);
  const totalDebt = num(fund.totalDebt);
  const totalCash = num(fund.totalCash);
  const ev =
    marketCap !== null && totalDebt !== null && totalCash !== null
      ? marketCap + totalDebt - totalCash
      : null;
  const ebitEv = ebit !== null && ev !== null && ev > 0 ? safeDiv(ebit, ev) : null;

  // ROIC: reported returnOnCapital, else EBIT / (totalAssets - totalCash).
  let roic = num(fund.returnOnCapital);
  if (roic === null) {
    const totalAssets = num(fund.totalAssets);
    const cash = totalCash ?? 0;
    if (ebit !== null && totalAssets !== null && totalAssets - cash > 0) {
      roic = safeDiv(ebit, totalAssets - cash);
    }
  }

  return { bm, ncav, ey, ebitEv, roic, ev };
}

interface ValueDistribution {
  day: number;
  universe: string;
  raw: Map<string, RawMetrics>;
  zs: Map<string, Record<MetricKey, number | null>>;
  sampleSize: number;
}

const cache = new WeakMap<StrategyContext, ValueDistribution>();
const pending = new WeakMap<StrategyContext, Promise<ValueDistribution>>();

/** Mean of the available z-scores for a symbol; null when fewer than `min` are valid. */
function averageZ(
  zs: Record<MetricKey, number | null>,
  keys: MetricKey[],
  min: number
): number | null {
  let sum = 0;
  let n = 0;
  for (const k of keys) {
    const z = zs[k];
    if (z !== null) {
      sum += z;
      n += 1;
    }
  }
  return n >= min ? sum / n : null;
}

async function loadDistribution(
  ctx: StrategyContext,
  universe: "nifty50" | "nifty500"
): Promise<ValueDistribution> {
  const day = evalDay(ctx);
  const hit = cache.get(ctx);
  if (hit && hit.day === day && hit.universe === universe) return hit;
  const inflight = pending.get(ctx);
  if (inflight) return inflight;
  const p = loadDistributionBuild(ctx, universe, day);
  pending.set(ctx, p);
  return p;
}

async function loadDistributionBuild(
  ctx: StrategyContext,
  universe: "nifty50" | "nifty500",
  day: number
): Promise<ValueDistribution> {
  const symbols = ctx.getUniverse ? ctx.getUniverse(universe) ?? [] : [];
  const raw = new Map<string, RawMetrics>();
  const empty: RawMetrics = { bm: null, ncav: null, ey: null, ebitEv: null, roic: null, ev: null };

  for (let start = 0; start < symbols.length; start += CONCURRENCY) {
    const chunk = symbols.slice(start, start + CONCURRENCY);
    const results = await Promise.all(
      chunk.map(async (symbol) => {
        try {
          const fund = ctx.getFundamentals ? await ctx.getFundamentals(symbol) : null;
          if (!fund || typeof fund !== "object") return [symbol, empty] as const;
          let price: number | null = null;
          if (num(fund.priceToBook) === null && num(fund.bookValue) !== null) {
            const candles = await ctx.getCandles(symbol, 5);
            const last = candles?.[candles.length - 1]?.close;
            price = num(last);
          }
          return [symbol, valueMetrics(fund as Record<string, unknown>, price)] as const;
        } catch {
          return [symbol, empty] as const;
        }
      })
    );
    for (const [symbol, metrics] of results) raw.set(symbol, metrics);
  }

  // Per-metric z-scores over the symbols with a finite raw value.
  const zs = new Map<string, Record<MetricKey, number | null>>();
  let sampleSize = 0;
  for (const [symbol, m] of raw) {
    const entry = {} as Record<MetricKey, number | null>;
    for (const k of ALL_METRICS) {
      const values: number[] = [];
      const ids: string[] = [];
      for (const [s, m2] of raw) {
        if (m2[k] !== null) {
          values.push(m2[k] as number);
          ids.push(s);
        }
      }
      const zsArr = values.length >= MIN_SAMPLES ? zscore(values) : null;
      const i = ids.indexOf(symbol);
      entry[k] = zsArr && i >= 0 ? zsArr[i] : null;
    }
    if (ALL_METRICS.some((k) => m[k] !== null)) sampleSize += 1;
    zs.set(symbol, entry);
  }

  const dist: ValueDistribution = { day, universe, raw, zs, sampleSize };
  cache.set(ctx, dist);
  pending.delete(ctx);
  return dist;
}

function makeStrategy(meta: StrategyMeta, scoreKeys: MetricKey[]): Strategy {
  return {
    meta,
    async compute(ctx, symbol): Promise<Signal | null> {
      const dist = await loadDistribution(ctx, meta.universe);
      const entry = dist.zs.get(symbol);
      if (!entry) return null;
      const z = averageZ(entry, scoreKeys, 1);
      if (z === null) return null;

      const raw = dist.raw.get(symbol) as RawMetrics;
      const compositeZ = averageZ(entry, ALL_METRICS, MIN_SAMPLES);

      const components: Record<string, number | string | null> = {
        bm: raw.bm !== null ? round2(raw.bm) : null,
        ncav: raw.ncav !== null ? round2(raw.ncav) : null,
        ey: raw.ey !== null ? round2(raw.ey) : null,
        ebitEv: raw.ebitEv !== null ? round2(raw.ebitEv) : null,
        roic: raw.roic !== null ? round2(raw.roic) : null,
        composite: compositeZ !== null ? round2(zToScore(compositeZ)) : null,
        sampleSize: dist.sampleSize,
      };

      return {
        symbol,
        score: round2(zToScore(z)),
        rank: 0,
        components,
      };
    },
  };
}

export const s099HmlStrategy = makeStrategy(
  {
    id: "S099",
    name: "Value Factor (HML)",
    category: "value",
    juryRank: 8,
    edgeScore: 8.5,
    universe: "nifty500",
    inputs: ["metric=bookToMarket"],
    description:
      "Fama-French HML proxy: book-to-market (B/M) z-scored across the universe; 0-100.",
  },
  ["bm"]
);

export const s076NcavStrategy = makeStrategy(
  {
    id: "S076",
    name: "Graham Net-Net (NCAV)",
    category: "value",
    juryRank: 15,
    edgeScore: 8.67,
    universe: "nifty500",
    inputs: ["metric=ncavToMarketCap"],
    description:
      "Graham net-net: (currentAssets - totalLiabilities) / marketCap, z-scored; 0-100.",
  },
  ["ncav"]
);

export const s078LowPeStrategy = makeStrategy(
  {
    id: "S078",
    name: "Low P/E",
    category: "value",
    juryRank: 29,
    edgeScore: 7.17,
    universe: "nifty500",
    inputs: ["metric=earningsYield"],
    description:
      "Low P/E via earnings yield (1/trailingPE), z-scored across the universe; 0-100.",
  },
  ["ey"]
);

export const s080MagicFormulaStrategy = makeStrategy(
  {
    id: "S080",
    name: "Greenblatt Magic Formula",
    category: "value",
    juryRank: 12,
    edgeScore: 8.83,
    universe: "nifty500",
    inputs: ["metrics=ebitToEv,roic"],
    description:
      "Magic formula: equal-weight z-composite of EBIT/EV and ROIC, ranked 0-100.",
  },
  ["ebitEv", "roic"]
);

export const valueStrategies: Strategy[] = [
  s099HmlStrategy,
  s076NcavStrategy,
  s078LowPeStrategy,
  s080MagicFormulaStrategy,
];
