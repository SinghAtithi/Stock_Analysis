/**
 * S101 — Low-Volatility Anomaly (Frazzini & Pedersen, "Betting Against Beta").
 * Jury rank #6 (RANKINGS.md §6, edge 8.83).
 *
 * Cross-sectional realized-volatility factor. For each symbol:
 *
 *   r_i     = close[i] / close[i-1] - 1          (daily simple returns)
 *   vol126  = stdev(last 126 returns) × √252      (annualized, sample n-1)
 *
 * The anomaly INVERTS the usual risk ranking: LOWER volatility scores HIGHER.
 * The score is 100 − percentileRank(vol126) across the design universe
 * (nifty50), so the calmest names sit near 100 and the lottery tickets near 0.
 *
 * Scoring mirrors S100: a per-context distribution cache (WeakMap, day-keyed
 * via evalDay — point-in-time safe for walk-forward backfills) prefetches the
 * universe once per evaluation instant; compute() ranks against it with
 * indicators.pctRank.
 *
 * ERASABLE TS ONLY — loaded by Node's native type stripping from scripts/.
 */
import { register } from "../store";
import type { Signal, Strategy, StrategyContext, StrategyMeta } from "../types";
import { evalDay } from "../pointInTime";
import { pctRank } from "../indicators";

const LOOKBACK_DAYS = 260;
const VOL_WINDOW = 126; // trailing sessions of daily returns
const MIN_CLOSES = VOL_WINDOW + 1 + 20; // 127 closes for the window + small buffer
const TRADING_DAYS_PER_YEAR = 252;
const CONCURRENCY = 10;

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

const meta: StrategyMeta = {
  id: "S101",
  name: "Low-Volatility Anomaly",
  category: "volatility",
  juryRank: 6,
  edgeScore: 8.83,
  universe: "nifty50",
  inputs: ["126d realized vol", "annualized √252", "inverted pctRank"],
  description:
    "Low-volatility anomaly: annualized standard deviation of the last 126 daily returns, scored so that LOWER volatility earns a HIGHER percentile across the universe.",
};

interface Distribution {
  day: number;
  universe: string;
  vol: Map<string, number | null>;
}

const cache = new WeakMap<StrategyContext, Distribution>();
const pending = new WeakMap<StrategyContext, Promise<Distribution>>();

/** Annualized realized vol from closes (oldest first), or null on short/invalid history. */
export function realizedVol(closes: number[]): number | null {
  const n = closes.length;
  if (n < VOL_WINDOW + 1) return null;
  const tail = closes.slice(-(VOL_WINDOW + 1));
  const rets: number[] = [];
  for (let i = 1; i < tail.length; i++) {
    const prev = tail[i - 1];
    if (!Number.isFinite(prev) || !Number.isFinite(tail[i]) || prev <= 0) return null;
    rets.push(tail[i] / prev - 1);
  }
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, r) => a + (r - mean) * (r - mean), 0) / (rets.length - 1);
  const vol = Math.sqrt(variance);
  if (!Number.isFinite(vol)) return null;
  return vol * Math.sqrt(TRADING_DAYS_PER_YEAR);
}

async function loadDistributionBuild(
  ctx: StrategyContext,
  universe: "nifty50" | "nifty500",
  day: number
): Promise<Distribution> {
  const symbols = ctx.getUniverse ? ctx.getUniverse(universe) ?? [] : [];
  const vol = new Map<string, number | null>();

  for (let start = 0; start < symbols.length; start += CONCURRENCY) {
    const chunk = symbols.slice(start, start + CONCURRENCY);
    const results = await Promise.all(
      chunk.map(async (symbol) => {
        try {
          const candles = await ctx.getCandles(symbol, LOOKBACK_DAYS);
          if (!candles || candles.length < MIN_CLOSES) return [symbol, null] as const;
          return [symbol, realizedVol(candles.map((c) => c.close))] as const;
        } catch {
          return [symbol, null] as const;
        }
      })
    );
    for (const [symbol, v] of results) vol.set(symbol, v);
  }

  const dist: Distribution = { day, universe, vol };
  cache.set(ctx, dist);
  pending.delete(ctx);
  return dist;
}

async function loadDistribution(
  ctx: StrategyContext,
  universe: "nifty50" | "nifty500"
): Promise<Distribution> {
  const day = evalDay(ctx);
  const hit = cache.get(ctx);
  if (hit && hit.day === day && hit.universe === universe) return hit;
  const inflight = pending.get(ctx);
  if (inflight) return inflight;
  const p = loadDistributionBuild(ctx, universe, day);
  pending.set(ctx, p);
  return p;
}

export const s101LowVolStrategy: Strategy = {
  meta,
  async compute(ctx, symbol) {
    const dist = await loadDistribution(ctx, meta.universe);
    const v = dist.vol.get(symbol);
    if (v === undefined || v === null) return null;

    const entries = [...dist.vol.entries()].filter(
      (e): e is [string, number] => e[1] !== null
    );
    if (entries.length < 2) return null;

    // anomaly direction: rank raw vols, then invert — low vol ⇒ score near 100
    const values = entries.map((e) => e[1]);
    const pct = pctRank(values);
    const i = entries.findIndex((e) => e[0] === symbol);
    const score = 100 - (pct[i] as number);

    const signal: Signal = {
      symbol,
      score: round2(score),
      rank: 0,
      components: {
        vol126: round4(v),
        invertedPctRank: round2(score),
        sampleSize: entries.length,
        lookbackDays: LOOKBACK_DAYS,
        volWindow: VOL_WINDOW,
      },
    };
    return signal;
  },
};

register(s101LowVolStrategy);
