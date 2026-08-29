/* Pure mixer weight math (TASK-1377), server-safe: shared by /api/mixer
   (composite is computed server-side) and the /mixer page for live
   normalized displays. No "use client" directive and no window access so
   route handlers can call it directly. */

export interface MixWeight {
  strategyId: string;
  weight: number;
}

/* picker rows are capped at this many strategies — an honest limit note is
   shown next to the list (10 is plenty for a readable composite) */
export const MAX_MIX_STRATEGIES = 10;

/* Slider values below 0.5 round to zero and their contribution is removed;
   survivors are normalized to sum exactly 100 (one decimal, drift snapped
   onto the largest weight). An all-zero (or empty) mix returns an empty map
   — callers show the hint. */
export function normalizeWeights(weights: MixWeight[]): Map<string, number> {
  const raw = new Map<string, number>();
  for (const w of weights) {
    if (
      typeof w !== "object" ||
      w === null ||
      typeof w.strategyId !== "string" ||
      w.strategyId.length === 0 ||
      typeof w.weight !== "number" ||
      !Number.isFinite(w.weight) ||
      w.weight < 0.5
    ) {
      continue;
    }
    raw.set(w.strategyId, Math.min(100, w.weight));
  }
  const total = [...raw.values()].reduce((a, b) => a + b, 0);
  if (total === 0) return raw;
  const scaled = new Map<string, number>();
  for (const [id, v] of raw) scaled.set(id, Math.round((v / total) * 1000) / 10);
  const sum = [...scaled.values()].reduce((a, b) => a + b, 0);
  if (sum !== 100 && scaled.size > 0) {
    let best: string | null = null;
    let bestV = -1;
    for (const [id, v] of scaled) {
      if (v > bestV) {
        bestV = v;
        best = id;
      }
    }
    if (best !== null) scaled.set(best, (scaled.get(best) ?? 0) + (100 - sum));
  }
  return scaled;
}