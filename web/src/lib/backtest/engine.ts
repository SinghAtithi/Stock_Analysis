import type { Candle } from "../types";
import type { Strategy, StrategyContext } from "../strategies/types";

/**
 * Backtest engine v1 (T23). Long-only, monthly-rebalanced top-N portfolios.
 *
 * ERASABLE TS only: this module is loaded by Node's native type stripping
 * from scripts/ (see scripts/run-backtest.mjs for the resolve hook). No
 * enums, no parameter properties, no runtime-affecting TS syntax.
 *
 * Conventions:
 * - Candle timestamps may be UNIX seconds (eod_candles) or milliseconds
 *   (strategy fixtures); the engine auto-detects (ts >= 1e12 -> ms).
 * - Signal as_of follows signal_snapshots: UNIX seconds, UTC.
 * - Rebalance executes at the CLOSE of the first trading day of each month;
 *   the signal lookup as-of is UTC midnight of that date (as_of <= date).
 * - Turnover = gross one-way traded fraction = max(sum of buys, sum of sells)
 *   of portfolio weight. Full rotation = 1.0. Cost = turnover * (costPct +
 *   slippagePct), deducted from equity on the rebalance day.
 * - No snapshot on a rebalance date -> hold the previous portfolio. No
 *   portfolio ever formed -> cash (flat equity).
 * - Benchmark = buy-and-hold equal-weight universe: fixed 1/N weights over
 *   symbols priced on the first window day; forward-filled prices; symbols
 *   not yet listed contribute zero.
 * - A symbol must have a price on the rebalance date to be holdable; scored
 *   symbols without data (unlisted / missing series) are skipped.
 */

export interface BacktestConfig {
  /** Number of highest-scored symbols held, equal weight. */
  topN: number;
  rebalance: "monthly";
  /** YYYY-MM-DD (inclusive), UTC. */
  startDate: string;
  /** YYYY-MM-DD (inclusive), UTC. Defaults to the last candle date. */
  endDate?: string;
  /** One-way brokerage cost, fraction (0.0015 = 15 bps). */
  costPct: number;
  /** One-way slippage, fraction (0.0005 = 5 bps). */
  slippagePct: number;
}

/** Supplies a cross-sectional score for a symbol as of a date; null = none. */
export interface Scorer {
  score(symbol: string, asOf: number): number | null | Promise<number | null>;
}

export interface SnapshotRow {
  symbol: string;
  score: number;
  /** UNIX seconds (UTC). */
  as_of: number;
}

export interface EquityPoint {
  /** YYYY-MM-DD, UTC. */
  date: string;
  /** Strategy cumulative equity, starts at 1. */
  strat: number;
  /** Benchmark cumulative equity, starts at 1. */
  bench: number;
}

export interface TradeEntry {
  date: string;
  /** Gross one-way traded fraction (max of buys/sells). Full rotation = 1. */
  turnover: number;
  /** Fraction of equity deducted this rebalance (turnover * cost). */
  costPaid: number;
  added: string[];
  removed: string[];
  held: string[];
}

export interface BacktestResult {
  equity: EquityPoint[];
  trades: TradeEntry[];
  rebalanceDates: string[];
  /** Sum of one-way turnover across all rebalances. */
  totalTurnover: number;
  /** Trading days with at least one position. */
  investedDays: number;
  config: BacktestConfig;
}

export const DEFAULT_COST_PCT = 0.0015;
export const DEFAULT_SLIPPAGE_PCT = 0.0005;

function tsToMs(ts: number): number {
  return ts < 1e12 ? ts * 1000 : ts;
}

/** Normalize a candle/date timestamp to YYYY-MM-DD (UTC). */
export function tsToDateString(ts: number): string {
  return new Date(tsToMs(ts)).toISOString().slice(0, 10);
}

/** Convert a YYYY-MM-DD date to signal as_of (UNIX seconds, UTC midnight). */
export function dateToAsOf(date: string): number {
  return Date.parse(`${date}T00:00:00Z`) / 1000;
}

/**
 * Pure scorer over preloaded signal_snapshots rows: for a (symbol, asOf)
 * returns the score of the latest snapshot with as_of <= asOf, or null.
 */
export class SnapshotScorer implements Scorer {
  private bySymbol = new Map<string, { as_of: number; score: number }[]>();

  constructor(rows: SnapshotRow[]) {
    for (const row of rows) {
      if (!Number.isFinite(row.score)) continue;
      let list = this.bySymbol.get(row.symbol);
      if (!list) {
        list = [];
        this.bySymbol.set(row.symbol, list);
      }
      list.push({ as_of: row.as_of, score: row.score });
    }
    for (const list of this.bySymbol.values()) {
      list.sort((a, b) => a.as_of - b.as_of);
    }
  }

  score(symbol: string, asOf: number): number | null {
    const list = this.bySymbol.get(symbol);
    if (!list || list.length === 0) return null;
    let lo = 0;
    let hi = list.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].as_of <= asOf) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return found === -1 ? null : list[found].score;
  }
}

/**
 * Scorer that computes live signals from a registered registry strategy.
 * `makeContext(asOf)` must hand back a StrategyContext whose getCandles is
 * point-in-time (only candles with time <= asOf). One context per asOf is
 * cached, so cross-sectional distribution caches work across symbols.
 * Used by T15+ real runs — no engine change needed.
 */
export class StrategyScorer implements Scorer {
  private strategy: Strategy;
  private makeContext: (asOf: number) => StrategyContext;
  private ctxByAsOf = new Map<number, StrategyContext>();

  constructor(strategy: Strategy, makeContext: (asOf: number) => StrategyContext) {
    this.strategy = strategy;
    this.makeContext = makeContext;
  }

  async score(symbol: string, asOf: number): Promise<number | null> {
    let ctx = this.ctxByAsOf.get(asOf);
    if (!ctx) {
      ctx = this.makeContext(asOf);
      this.ctxByAsOf.set(asOf, ctx);
    }
    try {
      const signal = await this.strategy.compute(ctx, symbol);
      return signal && Number.isFinite(signal.score) ? signal.score : null;
    } catch {
      return null;
    }
  }
}

export async function runBacktest(
  candlesBySymbol: Map<string, Candle[]>,
  scorer: Scorer,
  config: BacktestConfig
): Promise<BacktestResult> {
  const costPct = config.costPct ?? DEFAULT_COST_PCT;
  const slippagePct = config.slippagePct ?? DEFAULT_SLIPPAGE_PCT;
  const startDate = config.startDate;
  const endDate = config.endDate;

  if (!Number.isInteger(config.topN) || config.topN < 1) {
    throw new RangeError("topN must be a positive integer");
  }
  if (config.rebalance !== "monthly") {
    throw new RangeError(`unsupported rebalance "${config.rebalance}"`);
  }
  if (!Number.isFinite(costPct) || costPct < 0) {
    throw new RangeError("costPct must be a non-negative fraction");
  }
  if (!Number.isFinite(slippagePct) || slippagePct < 0) {
    throw new RangeError("slippagePct must be a non-negative fraction");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    throw new RangeError(`startDate must be YYYY-MM-DD, got "${startDate}"`);
  }

  const symbols = [...candlesBySymbol.keys()];

  // Union of all candle dates -> trading calendar for the window.
  const allDates = new Set<string>();
  for (const sym of symbols) {
    const candles = candlesBySymbol.get(sym) ?? [];
    for (const c of candles) {
      if (Number.isFinite(c.close)) allDates.add(tsToDateString(c.time));
    }
  }
  const lastDate = [...allDates].sort()[allDates.size - 1];
  const resolvedEnd = endDate && endDate < startDate ? startDate : endDate ?? lastDate ?? startDate;
  const dates = [...allDates].filter((d) => d >= startDate && d <= resolvedEnd).sort();

  if (dates.length === 0) {
    return {
      equity: [],
      trades: [],
      rebalanceDates: [],
      totalTurnover: 0,
      investedDays: 0,
      config: { ...config, costPct, slippagePct, endDate: resolvedEnd },
    };
  }

  // Per-symbol close on every window date, forward-filled (null pre-listing).
  const prevClose = new Map<string, number>();
  const aligned = new Map<string, (number | null)[]>();
  for (const sym of symbols) {
    const candles = candlesBySymbol.get(sym) ?? [];
    const byDate = new Map<string, number>();
    let before: number | null = null;
    let beforeTs = -Infinity;
    for (const c of candles) {
      const d = tsToDateString(c.time);
      if (!Number.isFinite(c.close)) continue;
      byDate.set(d, c.close);
      if (d < startDate && c.time > beforeTs) {
        before = c.close;
        beforeTs = c.time;
      }
    }
    prevClose.set(sym, before ?? NaN);
    let last = prevClose.get(sym) ?? NaN;
    const row: (number | null)[] = [];
    for (const d of dates) {
      const c = byDate.get(d);
      if (c !== undefined) last = c;
      row.push(Number.isFinite(last) ? last : null);
    }
    aligned.set(sym, row);
  }

  // Daily simple return per symbol; null when no price on either day.
  const ret = (sym: string, i: number): number | null => {
    const row = aligned.get(sym);
    if (!row) return null;
    const cur = row[i];
    const prev = i === 0 ? (prevClose.get(sym) ?? NaN) : row[i - 1];
    if (cur === null || prev === null || !Number.isFinite(prev) || prev <= 0) return null;
    return cur / prev - 1;
  };

  // Benchmark: buy-and-hold equal weight over symbols priced on day 0.
  const benchWeights = new Map<string, number>();
  let n0 = 0;
  for (const sym of symbols) {
    if (aligned.get(sym)?.[0] !== null) n0++;
  }
  for (const sym of symbols) {
    benchWeights.set(sym, aligned.get(sym)?.[0] !== null ? 1 / n0 : 0);
  }
  const benchRet = (i: number): number => {
    let r = 0;
    for (const sym of symbols) {
      const rv = ret(sym, i);
      if (rv !== null) r += (benchWeights.get(sym) ?? 0) * rv;
    }
    return r;
  };

  // Rebalance dates: first trading day of each month in the window.
  const rebalanceDates: string[] = [];
  let lastMonth = "";
  for (const d of dates) {
    const m = d.slice(0, 7);
    if (m !== lastMonth) {
      rebalanceDates.push(d);
      lastMonth = m;
    }
  }
  const rebalanceSet = new Set(rebalanceDates);

  const weights = new Map<string, number>();
  const trades: TradeEntry[] = [];
  const equity: EquityPoint[] = [];
  let eqStrat = 1;
  let eqBench = 1;
  let totalTurnover = 0;
  let investedDays = 0;

  for (let i = 0; i < dates.length; i++) {
    const d = dates[i];

    // Portfolio return accrued with pre-rebalance weights (trade at close).
    let rp = 0;
    let investedNow = 0;
    for (const sym of symbols) {
      const w = weights.get(sym) ?? 0;
      if (w > 0) {
        investedNow += w;
        const rv = ret(sym, i);
        if (rv !== null) rp += w * rv;
      }
    }
    eqStrat *= 1 + rp;
    eqBench *= 1 + benchRet(i);

    if (rebalanceSet.has(d)) {
      const asOf = dateToAsOf(d);
      const scored: { symbol: string; score: number }[] = [];
      for (const sym of symbols) {
        if (aligned.get(sym)?.[i] === null) continue; // no price yet — unholdable
        const s = await scorer.score(sym, asOf);
        if (s !== null && Number.isFinite(s)) scored.push({ symbol: sym, score: s });
      }
      scored.sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));
      const chosen = scored.slice(0, config.topN);
      const k = chosen.length;
      const targets = new Map<string, number>();
      for (const c of chosen) targets.set(c.symbol, k > 0 ? 1 / k : 0);

      let grossBuys = 0;
      let grossSells = 0;
      for (const sym of symbols) {
        const t = targets.get(sym) ?? 0;
        const w = weights.get(sym) ?? 0;
        if (t > w) grossBuys += t - w;
        else grossSells += w - t;
      }
      const turnover = Math.max(grossBuys, grossSells);
      const cost = turnover * (costPct + slippagePct);
      totalTurnover += turnover;

      const added = [...targets.keys()].filter((s) => (weights.get(s) ?? 0) === 0);
      const removed = [...weights.keys()].filter((s) => !targets.has(s));
      const held = [...weights.keys()].filter((s) => (weights.get(s) ?? 0) > 0 && targets.has(s));

      trades.push({ date: d, turnover, costPaid: cost, added, removed, held });

      weights.clear();
      for (const [s, w] of targets) if (w > 0) weights.set(s, w);
      eqStrat *= 1 - cost;
    }

    if (investedNow > 0 || weights.size > 0) investedDays++;
    equity.push({ date: d, strat: eqStrat, bench: eqBench });
  }

  return {
    equity,
    trades,
    rebalanceDates,
    totalTurnover,
    investedDays,
    config: { ...config, costPct, slippagePct, endDate: resolvedEnd },
  };
}
