/**
 * S100 — Momentum Factor (Jegadeesh & Titman, 1993). Jury rank #1.
 *
 * Cross-sectional 12-month-minus-1-month momentum. For each symbol the
 * trailing 12-month return is measured from ~1 month ago (the most recent
 * ~21 sessions are skipped to avoid short-term reversal):
 *
 *   momentum12 = close[t-21] / close[t-252] - 1
 *   momentum1  = close[t-1]  / close[t-21]  - 1
 *
 * The score is the percentile rank of momentum12 across the design universe
 * (nifty50), 0-100 — momentum is a relative factor, so the score is never a
 * per-symbol transform. momentum1 (the skipped month) is carried in
 * components for later 12-minus-1 combination work.
 *
 * Scoring mirrors demo/roc20 exactly: a per-context distribution cache
 * (WeakMap, day-keyed) prefetches the universe's momentum once, and compute()
 * normalizes each symbol against that distribution with indicators.pctRank.
 *
 * ERASABLE TS ONLY (no enums, namespaces, parameter properties) — this module
 * is loaded by Node's native type stripping from scripts/.
 */
import { register } from "../store";
import type { Signal, Strategy, StrategyContext, StrategyMeta } from "../types";
import { pctRank } from "../indicators";

const LOOKBACK_DAYS = 400;
const MOMENTUM_WINDOW = 252; // trailing 12-month window (sessions)
const SKIP_SESSIONS = 21; // ~1-month skip (sessions)
const MIN_CLOSES = 200; // spec'd hard floor on valid closes (see ROADMAP/T15)
const MIN_WINDOW_CLOSES = MOMENTUM_WINDOW + 1; // close[t-252] index exists (253)
const CONCURRENCY = 10;

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

const meta: StrategyMeta = {
  id: "S100",
  name: "Momentum Factor (JT)",
  category: "momentum",
  juryRank: 1,
  edgeScore: 9.83,
  universe: "nifty50",
  inputs: ["12m return", "1m skip", "pctRank"],
  description:
    "Jegadeesh-Titman cross-sectional momentum: trailing 12-month return skipping the last ~1 month, scored as the percentile rank of momentum12 across the universe.",
};

interface Distribution {
  day: number;
  universe: string;
  momentum12: Map<string, number | null>;
  momentum1: Map<string, number | null>;
}

const cache = new WeakMap<StrategyContext, Distribution>();

/** 12m-minus-1m-skip and 1m returns from closes (oldest first), or null. */
function momentumPair(closes: number[]): { m12: number; m1: number } | null {
  const n = closes.length;
  if (n < MIN_CLOSES || n < MIN_WINDOW_CLOSES) return null;

  const i12End = n - 1 - SKIP_SESSIONS; // close[t-21]
  const i12Start = n - 1 - MOMENTUM_WINDOW; // close[t-252]
  const i1End = n - 1 - 1; // close[t-1]

  const base12 = closes[i12Start];
  const end12 = closes[i12End];
  const end1 = closes[i1End];
  if (
    !Number.isFinite(base12) ||
    !Number.isFinite(end12) ||
    !Number.isFinite(end1) ||
    base12 <= 0
  ) {
    return null;
  }
  return {
    m12: end12 / base12 - 1,
    m1: end1 / end12 - 1,
  };
}

async function loadDistribution(ctx: StrategyContext, universe: "nifty50" | "nifty500") {
  const day = Math.floor(Date.now() / 86_400_000);
  const hit = cache.get(ctx);
  if (hit && hit.day === day && hit.universe === universe) return hit;

  const symbols = ctx.getUniverse ? ctx.getUniverse(universe) ?? [] : [];
  const momentum12 = new Map<string, number | null>();
  const momentum1 = new Map<string, number | null>();

  for (let start = 0; start < symbols.length; start += CONCURRENCY) {
    const chunk = symbols.slice(start, start + CONCURRENCY);
    const results = await Promise.all(
      chunk.map(async (symbol) => {
        try {
          const candles = await ctx.getCandles(symbol, LOOKBACK_DAYS);
          if (!candles || candles.length < MIN_CLOSES) {
            return [symbol, null, null] as const;
          }
          const closes = candles.map((c) => c.close);
          const pair = momentumPair(closes);
          if (!pair) return [symbol, null, null] as const;
          return [symbol, pair.m12, pair.m1] as const;
        } catch {
          return [symbol, null, null] as const;
        }
      })
    );
    for (const [symbol, m12, m1] of results) {
      momentum12.set(symbol, m12);
      momentum1.set(symbol, m1);
    }
  }

  const dist: Distribution = { day, universe, momentum12, momentum1 };
  cache.set(ctx, dist);
  return dist;
}

export const s100MomentumStrategy: Strategy = {
  meta,
  async compute(ctx, symbol) {
    const dist = await loadDistribution(ctx, meta.universe);
    const m12 = dist.momentum12.get(symbol);
    if (m12 === undefined || m12 === null) return null;

    const entries = [...dist.momentum12.entries()].filter(
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
        momentum12: round4(m12),
        momentum1: round4(dist.momentum1.get(symbol) as number),
        pctRank: round2(score as number),
        sampleSize: entries.length,
        lookbackDays: LOOKBACK_DAYS,
        momentumWindow: MOMENTUM_WINDOW,
        skipSessions: SKIP_SESSIONS,
      },
    };
    return signal;
  },
};

register(s100MomentumStrategy);
