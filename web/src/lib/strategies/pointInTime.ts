import type { StrategyContext } from "./types";

/**
 * Evaluation clock for a strategy computation (TASK-34).
 *
 * Returns ctx.now() when the runner supplies a point-in-time clock, else the
 * real wall clock. Strategies must route EVERY Date.now() dependency —
 * distribution-cache day keys, event-age math — through this helper, or
 * walk-forward backfills reuse stale caches and leak the present into
 * historical as-of evaluations.
 */
export function evalNow(ctx: StrategyContext): number {
  return ctx.now?.() ?? Date.now();
}

/** Calendar-day bucket of evalNow(), UTC days since epoch. */
export function evalDay(ctx: StrategyContext): number {
  return Math.floor(evalNow(ctx) / 86_400_000);
}
