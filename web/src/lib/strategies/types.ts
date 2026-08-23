import type { Candle } from "../types";

/**
 * Pure type declarations for the quant strategy framework.
 * ERASABLE syntax only (no enums, namespaces, parameter properties):
 * this module is loaded by Node's native type stripping from scripts/.
 */

export interface StrategyMeta {
  /** Stable id, e.g. "demo-roc20" or "S100". Used as signal_snapshots.strategy_id. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Family, mirroring RANKINGS.md groupings, e.g. "momentum", "value". */
  category: string;
  /** Final jury rank from RANKINGS.md (1 = best). null for strategies not yet juried. */
  juryRank: number | null;
  /** Mean juror edge score 1-10 from RANKINGS.md. null for strategies not yet juried. */
  edgeScore: number | null;
  /** Design universe this strategy is built for. The runner may override via CLI. */
  universe: "nifty50" | "nifty500";
  /** Tunable inputs, e.g. ["rocPeriod=20"]. */
  inputs: string[];
  description: string;
}

export interface Signal {
  symbol: string;
  /** Cross-sectional score 0-100; higher = stronger signal. */
  score: number;
  /** Rank 1..N assigned by the runner (score desc). Strategies emit 0. */
  rank: number;
  /** Debuggable per-strategy breakdown, serialized into components_json. */
  components: Record<string, number | string | null>;
}

/**
 * Data access handed to strategies. Minimal + extensible: add optional methods
 * as later tasks (T15+) need them without breaking existing strategies.
 */
export interface StrategyContext {
  /**
   * Daily candles for a symbol, oldest first. The runner guarantees at least
   * `lookbackDays` of calendar range (fewer candles if history is short).
   */
  getCandles(symbol: string, lookbackDays: number): Promise<Candle[]> | Candle[];
  /** Optional fundamental snapshot (fundamentals table). */
  getFundamentals?(
    symbol: string
  ): Promise<Record<string, unknown> | null> | Record<string, unknown> | null;
  /** Optional analyst/derived snapshot (analyst_data table). */
  getAnalyst?(
    symbol: string
  ): Promise<Record<string, unknown> | null> | Record<string, unknown> | null;
  /** Optional universe membership (resolved from instruments.json idx). */
  getUniverse?(universe: "nifty50" | "nifty500"): string[] | null;
  /**
   * Evaluation clock, epoch MILLISECONDS — the instant this computation is
   * "as of". Strategies MUST derive wall-clock quantities (cache-day keys,
   * event ages) from here instead of Date.now(), or walk-forward backfills
   * (--as-of) leak the real present into historical evaluations. Optional
   * for backward compatibility: treat absence as Date.now().
   */
  now?(): number;
}

export interface Strategy {
  meta: StrategyMeta;
  /**
   * Produce a signal for one symbol, or null when inputs are insufficient
   * (short history, missing data). Must never throw — return null instead.
   */
  compute(ctx: StrategyContext, symbol: string): Promise<Signal | null> | Signal | null;
}
