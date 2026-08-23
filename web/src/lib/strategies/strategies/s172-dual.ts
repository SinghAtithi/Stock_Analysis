/**
 * S172 — Dual Momentum (Antonacci). Asset-level (T16).
 * Absolute momentum: asset above its 200d SMA → risk-on for that asset.
 * Relative momentum: rank assets by 12-1 return (skip last month); if the
 * top-ranked asset's 12-1 return is negative → cash regime.
 * Score 0-100: 100 = risk-on + top-relative (above 200d SMA, rank 1);
 * 0 = cash regime, or the asset's own absolute momentum is off (≤ 200d SMA).
 * Self-registering on import. Never throws — returns null on insufficient data.
 */
import type { Signal, Strategy, StrategyContext, StrategyMeta } from "../types";
import { sma, safeDiv } from "../indicators";
import { register } from "../store";

export const ASSETS = ["NIFTY 50", "SENSEX", "GOLDBEES"] as const;
export const CASH = "CASH";

const SMA_PERIOD = 200;
const RET_LOOKBACK = 252; // trading days ≈ 12 months
const SKIP_DAYS = 21; // skip the last month (MOP 12-1 convention)
const LOOKBACK_DAYS = 520; // calendar days requested from ctx
const MIN_CANDLES = RET_LOOKBACK + SKIP_DAYS + 10;

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function isFiniteNum(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

/** 12-1 return (skip 1m): P[t-21] / P[t-252] - 1. Null when data is short. */
export function ret12(closes: number[]): number | null {
  if (!Array.isArray(closes) || closes.length < MIN_CANDLES) return null;
  const cur = closes[closes.length - 1 - SKIP_DAYS];
  const base = closes[closes.length - 1 - SKIP_DAYS - RET_LOOKBACK];
  if (!isFiniteNum(cur) || !isFiniteNum(base) || base === 0) return null;
  return (cur - base) / base;
}

interface AssetStat {
  symbol: string;
  ret12: number | null;
  sma200Ratio: number | null; // last close / 200d SMA; > 1 = above
}

interface Snapshot {
  day: number;
  stats: Map<string, AssetStat>;
  /** Risky assets sorted by ret12 desc (only those with data). */
  ranked: string[];
  /** "risk-on" when the top risky asset's 12-1 return >= 0, else "cash". */
  regime: "risk-on" | "cash" | "unknown";
}

const cache = new WeakMap<StrategyContext, Snapshot>();

async function loadSnapshot(ctx: StrategyContext): Promise<Snapshot> {
  const day = Math.floor(Date.now() / 86_400_000);
  const hit = cache.get(ctx);
  if (hit && hit.day === day) return hit;

  const stats = new Map<string, AssetStat>();
  for (const symbol of ASSETS) {
    let candles: Awaited<ReturnType<StrategyContext["getCandles"]>> = [];
    try {
      candles = await ctx.getCandles(symbol, LOOKBACK_DAYS);
    } catch {
      candles = [];
    }
    if (!candles || candles.length < MIN_CANDLES) {
      stats.set(symbol, { symbol, ret12: null, sma200Ratio: null });
      continue;
    }
    const closes = candles.map((c) => c.close);
    const ma = sma(closes, SMA_PERIOD);
    const lastClose = closes[closes.length - 1];
    const maLast = ma[ma.length - 1];
    const ratio = isFiniteNum(lastClose) && isFiniteNum(maLast) ? safeDiv(lastClose, maLast) : null;
    stats.set(symbol, { symbol, ret12: ret12(closes), sma200Ratio: ratio });
  }

  const ranked = [...stats.values()]
    .filter((s) => isFiniteNum(s.ret12))
    .sort((a, b) => (b.ret12 as number) - (a.ret12 as number))
    .map((s) => s.symbol);

  let regime: Snapshot["regime"] = "unknown";
  if (ranked.length > 0) {
    const top = stats.get(ranked[0]);
    regime = top && isFiniteNum(top.ret12) && top.ret12 < 0 ? "cash" : "risk-on";
  }

  const snap: Snapshot = { day, stats, ranked, regime };
  cache.set(ctx, snap);
  return snap;
}

const meta: StrategyMeta = {
  id: "S172",
  name: "Dual Momentum (Antonacci)",
  category: "momentum",
  juryRank: 5,
  edgeScore: 8.83,
  universe: "nifty50",
  inputs: [`smaPeriod=${SMA_PERIOD}`, `retWindow=12m-1m`, `assets=${ASSETS.join("|")}+${CASH}`],
  description:
    "Asset-level dual momentum: 200d SMA absolute-momentum gate + 12-1 return relative ranking over NIFTY 50/SENSEX/GOLDBEES; cash regime when the top asset's 12-1 return is negative. Score 100 at top of the risk-on stack, 0 in cash.",
};

export const s172DualStrategy: Strategy = {
  meta,
  async compute(ctx: StrategyContext, symbol: string): Promise<Signal | null> {
    const snap = await loadSnapshot(ctx);
    const isCash = symbol === CASH;
    if (!isCash && !ASSETS.includes(symbol as (typeof ASSETS)[number])) return null;
    if (snap.regime === "unknown") return null;

    if (isCash) {
      return {
        symbol,
        score: snap.regime === "cash" ? 100 : 0,
        rank: 0,
        components: { sma200: null, ret12: 0, regime: snap.regime, rank: null },
      };
    }

    const stat = snap.stats.get(symbol);
    if (!stat || !isFiniteNum(stat.ret12)) return null; // missing series

    const rank = snap.ranked.indexOf(symbol) + 1; // 0 = not ranked
    let score = 0;
    if (snap.regime === "risk-on" && isFiniteNum(stat.sma200Ratio) && stat.sma200Ratio > 1 && rank > 0) {
      score = 100 - (rank - 1) * (100 / ASSETS.length);
    }

    return {
      symbol,
      score: round2(Math.max(0, Math.min(100, score))),
      rank: 0,
      components: {
        sma200: isFiniteNum(stat.sma200Ratio) ? round2(stat.sma200Ratio as number) : null,
        ret12: round2(stat.ret12),
        regime: snap.regime,
        rank: rank > 0 ? rank : null,
      },
    };
  },
};

register(s172DualStrategy);
