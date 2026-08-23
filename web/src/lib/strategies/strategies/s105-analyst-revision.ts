import type { Signal, Strategy, StrategyContext, StrategyMeta } from "../types";
import { register } from "../store";
import { pctRank } from "../indicators";

/**
 * S105 — Analyst Revision Drift, jury rank 11.
 *
 * Stocks whose consensus EPS estimates are being revised upward keep
 * drifting upward over the following months (analysts anchor on stale
 * information and revise slowly; see Chan, Jegadeesh & Lakonishok 1996).
 * The signal is revision momentum: how much the current consensus has
 * moved versus the 30- and 90-day-ago consensus, weighted toward the
 * fresher window (0.6 · rev30 + 0.4 · rev90), scored cross-sectionally.
 *
 * Data contract (documented for the runner):
 * - ctx.getAnalyst(symbol): analyst_data.derived_json as produced by
 *   ingest-analyst.mjs flattenDerived() — revisionTrend.epsRev7dPct,
 *   epsRev30dPct, epsRev90dPct (current vs N-days-ago consensus, %), plus
 *   epsEstimate.numberOfAnalysts. Accepts the raw DB row wrapper
 *   ({derived_json}) or the flattened object itself.
 *
 * Score transform (documented): per-symbol revision momentum is ranked
 * cross-sectionally across the universe (pctRank → 0-100). Components
 * carry the raw windows so a reader can audit the rank.
 *
 * Null policy: null when the symbol has no analyst row, no revisionTrend,
 * or neither the 30d nor 90d revision is computable; null when the
 * universe yields fewer than MIN_SAMPLES finite values; never throws.
 */

const W_30D = 0.6;
const W_90D = 0.4;
const MIN_SAMPLES = 2;
const CONCURRENCY = 8;

function num(x: unknown): number | null {
  if (typeof x === "number" && Number.isFinite(x)) return x;
  if (
    x &&
    typeof x === "object" &&
    "raw" in x &&
    typeof (x as { raw: unknown }).raw === "number" &&
    Number.isFinite((x as { raw: number }).raw)
  ) {
    return (x as { raw: number }).raw;
  }
  return null;
}

function unwrap(analyst: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!analyst) return null;
  const d = analyst.derived_json;
  return d && typeof d === "object"
    ? (d as Record<string, unknown>)
    : analyst;
}

/** Weighted revision momentum from the derived analyst row; null-safe. */
export function revisionMomentum(derived: Record<string, unknown> | null): {
  momentum: number | null;
  rev7: number | null;
  rev30: number | null;
  rev90: number | null;
  analysts: number | null;
} {
  const rt = derived?.revisionTrend as Record<string, unknown> | null | undefined;
  const rev7 = num(rt?.epsRev7dPct);
  const rev30 = num(rt?.epsRev30dPct);
  const rev90 = num(rt?.epsRev90dPct);
  const analysts =
    num(rt?.epsEstimate ? (rt.epsEstimate as Record<string, unknown>).numberOfAnalysts : undefined) ??
    num(derived?.numberOfAnalystOpinions);

  const parts: Array<[number, number]> = [];
  if (rev30 !== null) parts.push([rev30, W_30D]);
  if (rev90 !== null) parts.push([rev90, W_90D]);
  const wsum = parts.reduce((a, [, w]) => a + w, 0);
  const momentum =
    wsum > 0 ? parts.reduce((a, [v, w]) => a + v * w, 0) / wsum : null;

  return { momentum, rev7, rev30, rev90, analysts };
}

interface Dist {
  ranks: Map<string, number | null>;
  rows: Map<
    string,
    { momentum: number | null; rev7: number | null; rev30: number | null; rev90: number | null; analysts: number | null }
  >;
  valid: boolean;
}

const cache = new WeakMap<StrategyContext, Promise<Dist>>();
const pending = new Map<StrategyContext, Promise<Dist>>();

async function loadDistribution(
  ctx: StrategyContext,
  universe: "nifty50" | "nifty500",
  day: number
): Promise<Dist> {
  void day;
  const symbols = ctx.getUniverse ? ctx.getUniverse(universe) ?? [] : [];
  const rows = new Map<
    string,
    { momentum: number | null; rev7: number | null; rev30: number | null; rev90: number | null; analysts: number | null }
  >();

  for (let start = 0; start < symbols.length; start += CONCURRENCY) {
    const chunk = symbols.slice(start, start + CONCURRENCY);
    await Promise.all(
      chunk.map(async (symbol) => {
        try {
          const row = ctx.getAnalyst ? await ctx.getAnalyst(symbol) : null;
          const flat = unwrap(row as Record<string, unknown> | null);
          rows.set(symbol, revisionMomentum(flat));
        } catch {
          rows.set(symbol, { momentum: null, rev7: null, rev30: null, rev90: null, analysts: null });
        }
      })
    );
  }

  // Cross-sectional percentile rank over computable momenta.
  const ids: string[] = [];
  const values: number[] = [];
  for (const [symbol, r] of rows) {
    if (r.momentum !== null) {
      ids.push(symbol);
      values.push(r.momentum);
    }
  }
  const prs = values.length >= MIN_SAMPLES ? pctRank(values) : (null as unknown as (number | null)[]);
  const ranks = new Map<string, number | null>();
  ids.forEach((s, i) => ranks.set(s, prs ? (prs[i] ?? null) : null));

  const dist: Dist = { ranks, rows, valid: values.length >= MIN_SAMPLES };
  cache.set(ctx, Promise.resolve(dist));
  pending.delete(ctx);
  return dist;
}

const meta: StrategyMeta = {
  id: "S105",
  name: "Analyst Revision Drift",
  category: "analyst",
  juryRank: 11,
  edgeScore: 8.17,
  universe: "nifty50",
  inputs: [`w30=${W_30D}`, `w90=${W_90D}`, `minSamples=${MIN_SAMPLES}`],
  description:
    "Analyst Revision Drift: consensus EPS revisions predict continued drift (Chan-Jegadeesh-Lakonishok 1996). Revision momentum = 0.6·(30d consensus change %) + 0.4·(90d consensus change %) from analyst_data.revisionTrend, percentile-ranked cross-sectionally to 0-100. Null without analyst coverage.",
};

export const s105Strategy: Strategy = {
  meta,
  async compute(ctx: StrategyContext, symbol: string): Promise<Signal | null> {
    let distP = cache.get(ctx);
    if (!distP) {
      const existing = pending.get(ctx);
      if (existing) distP = existing;
      else {
        distP = loadDistribution(ctx, meta.universe, 0);
        pending.set(ctx, distP);
      }
    }
    const dist = await distP;
    const score = dist.ranks.get(symbol);
    if (score === undefined || score === null) return null;

    const r = dist.rows.get(symbol)!;
    return {
      symbol,
      score: Math.round(score * 100) / 100,
      rank: 0,
      components: {
        momentum: r.momentum !== null ? Math.round(r.momentum * 100) / 100 : null,
        rev7d: r.rev7 !== null ? Math.round(r.rev7 * 100) / 100 : null,
        rev30d: r.rev30 !== null ? Math.round(r.rev30 * 100) / 100 : null,
        rev90d: r.rev90 !== null ? Math.round(r.rev90 * 100) / 100 : null,
        analysts: r.analysts,
        sampleSize: dist.ranks.size,
      },
    };
  },
};

/* Self-registering: importing this module makes S105 available to runners
 * (registry.register overwrites same-id entries, so double imports are safe). */
register(s105Strategy);
