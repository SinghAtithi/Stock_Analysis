import type { Strategy } from "./types";
import { roc20Strategy } from "./demo/roc20";
import { w52LowStrategy } from "./demo/52wlow";

const strategies = new Map<string, Strategy>();

/** Register a strategy. Later registrations of the same id overwrite. */
export function register(strategy: Strategy): void {
  strategies.set(strategy.meta.id, strategy);
}

/** Look up a strategy by id. */
export function getStrategy(id: string): Strategy | undefined {
  return strategies.get(id);
}

/**
 * All registered strategies, sorted by juryRank ascending (best first).
 * Unranked strategies (juryRank null) sort last; ties break by id.
 */
export function listStrategies(): Strategy[] {
  return [...strategies.values()].sort((a, b) => {
    const ra = a.meta.juryRank;
    const rb = b.meta.juryRank;
    if (ra === null && rb === null) return a.meta.id.localeCompare(b.meta.id);
    if (ra === null) return 1;
    if (rb === null) return -1;
    if (ra !== rb) return ra - rb;
    return a.meta.id.localeCompare(b.meta.id);
  });
}

register(roc20Strategy);
register(w52LowStrategy);
