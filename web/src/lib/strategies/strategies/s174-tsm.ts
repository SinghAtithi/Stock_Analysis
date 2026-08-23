/**
 * S174 — Time-Series Momentum (Moskowitz-Ooi-Pedersen). Asset-level (T16).
 * Per asset: sign of the 12-1 return (skip last month) drives direction;
 * position size is vol-scaled — exposure = sign * (volTarget / realizedVol).
 * Score 0-100: 50 neutral, 100 = full-target long exposure, 0 = full short.
 * CASH is synthetic: ret12 = 0, sign 0, neutral score 50.
 * Self-registering on import. Never throws — returns null on insufficient data.
 */
import type { Signal, Strategy, StrategyContext, StrategyMeta } from "../types";
import { register } from "../store";
import { ASSETS, CASH, ret12 } from "./s172-dual";

const VOL_WINDOW = 60; // trading days of daily returns for realized vol
const VOL_TARGET = 0.15; // annualized target vol (15%)
const LOOKBACK_DAYS = 520;
const MIN_VOL_SAMPLES = 20;

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function isFiniteNum(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

/** Annualized realized volatility from the trailing daily returns. */
export function realizedVol(closes: number[], window = VOL_WINDOW): number | null {
  if (!Array.isArray(closes) || closes.length < 2) return null;
  const start = Math.max(1, closes.length - window);
  const returns: number[] = [];
  for (let i = start; i < closes.length; i++) {
    const prev = closes[i - 1];
    const cur = closes[i];
    if (!isFiniteNum(prev) || !isFiniteNum(cur) || prev === 0) return null;
    returns.push(cur / prev - 1);
  }
  if (returns.length < MIN_VOL_SAMPLES) return null;

  let mean = 0;
  for (const r of returns) mean += r;
  mean /= returns.length;
  let variance = 0;
  for (const r of returns) variance += (r - mean) * (r - mean);
  variance /= returns.length;
  const std = Math.sqrt(variance);
  if (!Number.isFinite(std) || std === 0) return null;
  return std * Math.sqrt(252);
}

interface AssetTsm {
  symbol: string;
  ret12: number | null;
  vol: number | null;
}

interface Snapshot {
  day: number;
  stats: Map<string, AssetTsm>;
}

const cache = new WeakMap<StrategyContext, Snapshot>();

async function loadSnapshot(ctx: StrategyContext): Promise<Snapshot> {
  const day = Math.floor(Date.now() / 86_400_000);
  const hit = cache.get(ctx);
  if (hit && hit.day === day) return hit;

  const stats = new Map<string, AssetTsm>();
  for (const symbol of ASSETS) {
    let candles: Awaited<ReturnType<StrategyContext["getCandles"]>> = [];
    try {
      candles = await ctx.getCandles(symbol, LOOKBACK_DAYS);
    } catch {
      candles = [];
    }
    if (!candles || candles.length < 2) {
      stats.set(symbol, { symbol, ret12: null, vol: null });
      continue;
    }
    const closes = candles.map((c) => c.close);
    stats.set(symbol, { symbol, ret12: ret12(closes), vol: realizedVol(closes) });
  }

  const snap: Snapshot = { day, stats };
  cache.set(ctx, snap);
  return snap;
}

const meta: StrategyMeta = {
  id: "S174",
  name: "Time-Series Momentum (MOP)",
  category: "momentum",
  juryRank: 3,
  edgeScore: 9.5,
  universe: "nifty50",
  inputs: [`retWindow=12m-1m`, `volTarget=${VOL_TARGET}`, `volWindow=${VOL_WINDOW}d`, `assets=${ASSETS.join("|")}+${CASH}`],
  description:
    "Asset-level time-series momentum: direction = sign of 12-1 return (skip last month) per asset; exposure scaled by volTarget/realizedVol. Score maps exposure to 0-100 (50 neutral, 100 full-target long, 0 full short).",
};

export const s174TsmStrategy: Strategy = {
  meta,
  async compute(ctx: StrategyContext, symbol: string): Promise<Signal | null> {
    if (symbol === CASH) {
      return {
        symbol,
        score: 50,
        rank: 0,
        components: { ret12: 0, sign: 0, vol: null, volTarget: VOL_TARGET, exposure: 0 },
      };
    }
    if (!ASSETS.includes(symbol as (typeof ASSETS)[number])) return null;

    const snap = await loadSnapshot(ctx);
    const stat = snap.stats.get(symbol);
    if (!stat || !isFiniteNum(stat.ret12) || !isFiniteNum(stat.vol)) return null;

    const sign = Math.sign(stat.ret12 as number);
    const exposure = sign * (VOL_TARGET / (stat.vol as number));
    const score = Math.max(0, Math.min(100, 50 + exposure * 50));

    return {
      symbol,
      score: round2(score),
      rank: 0,
      components: {
        ret12: round2(stat.ret12 as number),
        sign,
        vol: round2(stat.vol as number),
        volTarget: VOL_TARGET,
        exposure: round2(exposure),
      },
    };
  },
};

register(s174TsmStrategy);
