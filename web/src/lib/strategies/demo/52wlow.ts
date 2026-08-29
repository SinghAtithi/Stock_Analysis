import type { Signal, Strategy, StrategyContext, StrategyMeta } from "../types";

const LOOKBACK_DAYS = 400;
const HIGH_WINDOW = 252;
const MIN_CANDLES = 30;

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

const meta: StrategyMeta = {
  id: "demo-52wlow",
  name: "52W High Distance",
  category: "trend",
  juryRank: null,
  edgeScore: null,
  universe: "nifty500",
  inputs: [`highWindow=${HIGH_WINDOW}`],
  subtitle: "Closeness to the 52-week high",
  description:
    "Demo strategy: distance from the trailing 52-week high, inverted — closer to the high scores higher (0-100).",
};

export const w52LowStrategy: Strategy = {
  meta,
  async compute(ctx: StrategyContext, symbol: string): Promise<Signal | null> {
    const candles = await ctx.getCandles(symbol, LOOKBACK_DAYS);
    if (!candles || candles.length < MIN_CANDLES) return null;

    const window = candles.slice(-HIGH_WINDOW);
    const lastClose = candles[candles.length - 1].close;
    if (!Number.isFinite(lastClose)) return null;

    let high = -Infinity;
    for (const c of window) {
      if (Number.isFinite(c.high) && c.high > high) high = c.high;
    }
    if (!Number.isFinite(high) || high <= 0) return null;

    const distance = (high - lastClose) / high;
    const score = Math.max(0, Math.min(100, (1 - distance) * 100));

    const signal: Signal = {
      symbol,
      score: round2(score),
      rank: 0,
      components: {
        fiftyTwoWeekHigh: round2(high),
        lastClose: round2(lastClose),
        distancePct: round2(distance * 100),
        windowDays: window.length,
      },
    };
    return signal;
  },
};
