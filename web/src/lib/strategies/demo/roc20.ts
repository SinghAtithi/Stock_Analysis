import type { Signal, Strategy, StrategyContext, StrategyMeta } from "../types";
import { evalDay } from "../pointInTime";
import { pctRank, roc } from "../indicators";

const ROC_PERIOD = 20;
const LOOKBACK_DAYS = 40;
const MIN_CANDLES = ROC_PERIOD + 5;
const CONCURRENCY = 10;

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

const meta: StrategyMeta = {
  id: "demo-roc20",
  name: "ROC(20) Momentum",
  category: "momentum",
  juryRank: null,
  edgeScore: null,
  universe: "nifty500",
  inputs: [`rocPeriod=${ROC_PERIOD}`],
  subtitle: "20-day momentum, short-term rate of change",
  description:
    "Demo strategy: 20-day rate of change, scored as the percentile rank of ROC across the universe.",
};

interface Distribution {
  day: number;
  universe: string;
  rocs: Map<string, number | null>;
}

const cache = new WeakMap<StrategyContext, Distribution>();

async function loadDistribution(ctx: StrategyContext, universe: "nifty50" | "nifty500") {
  const day = evalDay(ctx);
  const hit = cache.get(ctx);
  if (hit && hit.day === day && hit.universe === universe) return hit;

  const symbols = ctx.getUniverse ? ctx.getUniverse(universe) ?? [] : [];
  const rocs = new Map<string, number | null>();

  for (let start = 0; start < symbols.length; start += CONCURRENCY) {
    const chunk = symbols.slice(start, start + CONCURRENCY);
    const results = await Promise.all(
      chunk.map(async (symbol) => {
        try {
          const candles = await ctx.getCandles(symbol, LOOKBACK_DAYS);
          if (!candles || candles.length < MIN_CANDLES) return [symbol, null] as const;
          const closes = candles.map((c) => c.close);
          const r = roc(closes, ROC_PERIOD);
          const last = r[r.length - 1];
          return [symbol, last] as const;
        } catch {
          return [symbol, null] as const;
        }
      })
    );
    for (const [symbol, last] of results) rocs.set(symbol, last);
  }

  const dist: Distribution = { day, universe, rocs };
  cache.set(ctx, dist);
  return dist;
}

export const roc20Strategy: Strategy = {
  meta,
  async compute(ctx, symbol) {
    const dist = await loadDistribution(ctx, meta.universe);
    const rocVal = dist.rocs.get(symbol);
    if (rocVal === undefined || rocVal === null) return null;

    const entries = [...dist.rocs.entries()].filter(
      (e): e is [string, number] => e[1] !== null
    );
    if (entries.length < 2) return null;

    const values = entries.map((e) => e[1]);
    const pct = pctRank(values);
    const i = entries.findIndex((e) => e[0] === symbol);
    const score = pct[i];

    const signal: Signal = {
      symbol,
      score: round2(score as number),
      rank: 0,
      components: {
        roc20: round2(rocVal),
        pctRank: round2(score as number),
        sampleSize: entries.length,
        rocPeriod: ROC_PERIOD,
        lookbackDays: LOOKBACK_DAYS,
      },
    };
    return signal;
  },
};
