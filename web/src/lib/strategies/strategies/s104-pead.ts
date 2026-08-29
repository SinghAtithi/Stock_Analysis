import type { Candle } from "../../types";
import type { Signal, Strategy, StrategyContext, StrategyMeta } from "../types";
import { register } from "../store";
import { safeDiv } from "../indicators";
import { evalNow } from "../pointInTime";

/**
 * S104 — PEAD / SUE (Post-Earnings-Announcement Drift), jury rank 2.
 *
 * SUE = (actual EPS − consensus estimate) / std of estimates. Prices keep
 * drifting in the surprise direction for 60–90 days after the announcement
 * (Ball & Brown 1968; Bernard & Thomas 1989) because investors underreact.
 *
 * Data contract (documented for the runner; both getters are optional):
 * - ctx.getFundamentals(symbol): fundamentals.module_json (raw quoteSummary
 *   result[0], which carries the earningsHistory module as fetched by
 *   ingest-fundamentals.mjs). If the runner passes metrics_json (flat, no
 *   earnings keys) or the DB row wrapper {module_json, metrics_json}, both
 *   are tolerated and yield null when no earnings history is present.
 * - ctx.getAnalyst(symbol): analyst_data.derived_json as produced by
 *   ingest-analyst.mjs flattenDerived() (revisionTrend.epsEstimate
 *   {avg, low, high}). The std of estimates is not reported by Yahoo, so it
 *   is approximated from the cross-analyst range: std ≈ (high − low) / 4
 *   (range spans ≈ ±2σ under normality).
 *
 * Fallback when no SUE is computable (estimates/std missing): YoY EPS
 * surprise = (actual − prior-year actual) / |prior-year actual| · 100, taken
 * from the earningsHistory entry whose quarter-end date is ~1 year earlier.
 *
 * Score transform (documented): SUE is clamped to [−3, +3] (the ≈99.7th
 * percentile band of a standard normal, hence percentile-ish) and mapped
 * linearly: score = 50 + 50·(SUE_clamped / 3) → +3σ ⇒ 100, −3σ ⇒ 0, 0 ⇒ 50.
 * The fallback uses surprisePct mapped over ±100 % the same way. When the
 * event is inside the 60-day drift window and post-event returns are known,
 * the drift direction confirms the signal: score = 0.8·base + 0.2·confirm
 * (confirm = 100 up / 0 down). Events older than the window are faded to
 * 0.6·base (the drift has mostly played out).
 *
 * Null policy: null when no earnings data (no history, no analyst consensus,
 * no year-ago comparator), never throws.
 */

const DRIFT_WINDOW_DAYS = 60;
const LOOKBACK_DAYS = 75;
const MIN_POST_EVENT_CANDLES = 2;
const STD_RANGE_DIVISOR = 4;
const SUE_CAP = 3;
const YOY_MIN_DAYS = 330;
const YOY_MAX_DAYS = 400;
const DAY_MS = 86_400_000;

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** Yahoo {raw, fmt} wrapper or plain number → finite number, else null. */
function rawNum(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value !== null && typeof value === "object") {
    const raw = (value as Record<string, unknown>).raw;
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    if (typeof raw === "string" && raw.trim() !== "") {
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}

/** Epoch seconds → ms (Yahoo reportDate/quarterEndDate raws are seconds). */
function toMs(ts: number): number {
  return ts < 1e12 ? ts * 1000 : ts;
}

/** earningsHistory entries from any tolerated fundamentals shape. */
function getEarningsHistory(
  fundamentals: Record<string, unknown> | null
): Record<string, unknown>[] {
  if (!fundamentals) return [];
  const maybeWrapped = fundamentals.module_json;
  const root =
    maybeWrapped && typeof maybeWrapped === "object"
      ? (maybeWrapped as Record<string, unknown>)
      : fundamentals;
  const eh = root.earningsHistory;
  if (Array.isArray(eh)) return eh as Record<string, unknown>[];
  if (eh !== null && typeof eh === "object") {
    const hist = (eh as Record<string, unknown>).history;
    if (Array.isArray(hist)) return hist as Record<string, unknown>[];
  }
  return [];
}

/** derived_json from analyst row wrapper, or the object passed as-is. */
function unwrapDerived(
  analyst: Record<string, unknown> | null
): Record<string, unknown> | null {
  if (!analyst) return null;
  const d = analyst.derived_json;
  return d !== null && typeof d === "object"
    ? (d as Record<string, unknown>)
    : analyst;
}

/** First entry whose quarter-end date is ~1 year before the reference. */
function findYearAgoEntry(
  history: Record<string, unknown>[],
  refDateMs: number
): Record<string, unknown> | null {
  for (const entry of history) {
    const date = rawNum(entry.quarterEndDate) ?? rawNum(entry.reportDate);
    if (date === null) continue;
    const gapDays = (refDateMs - toMs(date)) / DAY_MS;
    if (gapDays >= YOY_MIN_DAYS && gapDays <= YOY_MAX_DAYS) return entry;
  }
  return null;
}

/** Return % from the first close at/after the event to the latest close. */
function postEventReturn(
  candles: Candle[] | null,
  eventDateMs: number
): number | null {
  if (!candles || candles.length === 0) return null;
  const after = candles.filter((c) => c.time >= eventDateMs);
  if (after.length < MIN_POST_EVENT_CANDLES) return null;
  const first = after[0].close;
  const last = after[after.length - 1].close;
  const ret = safeDiv(last - first, first);
  return ret === null ? null : ret * 100;
}

const meta: StrategyMeta = {
  id: "S104",
  name: "PEAD / SUE",
  category: "event",
  juryRank: 2,
  edgeScore: 9.67,
  universe: "nifty50",
  inputs: [`driftWindowDays=${DRIFT_WINDOW_DAYS}`, `stdRangeDivisor=${STD_RANGE_DIVISOR}`],
  subtitle: "Prices keep drifting after earnings surprises",
  description:
    "Post-Earnings-Announcement Drift: SUE = (actual EPS − consensus) / estimate std (std from analyst low/high range ÷ 4), direction-signed 0-100 score, 60-day drift confirmation window. Falls back to YoY EPS surprise when estimates are missing.",
};

export const s104Strategy: Strategy = {
  meta,
  async compute(ctx: StrategyContext, symbol: string): Promise<Signal | null> {
    if (!ctx.getFundamentals && !ctx.getAnalyst) return null;

    const fundamentals = ctx.getFundamentals
      ? await ctx.getFundamentals(symbol)
      : null;
    const analyst = ctx.getAnalyst ? await ctx.getAnalyst(symbol) : null;

    const history = getEarningsHistory(
      fundamentals as Record<string, unknown> | null
    );
    if (history.length === 0) return null;

    const cur = history[0];
    const actual = rawNum(cur.epsActual);
    const quarterEstimate = rawNum(cur.epsEstimate);
    const eventDateMs = toMs(rawNum(cur.reportDate) ?? rawNum(cur.quarterEndDate) ?? NaN);
    if (actual === null || !Number.isFinite(eventDateMs)) return null;

    const derived = unwrapDerived(analyst as Record<string, unknown> | null);
    const revisionTrend = derived?.revisionTrend as Record<string, unknown> | undefined;
    const epsEst = revisionTrend?.epsEstimate as Record<string, unknown> | undefined;
    const low = rawNum(epsEst?.low);
    const high = rawNum(epsEst?.high);
    const avg = rawNum(epsEst?.avg);
    const std = low !== null && high !== null ? (high - low) / STD_RANGE_DIVISOR : null;

    const consensus = quarterEstimate ?? avg;

    let sue: number | null = null;
    let surprisePct: number | null = null;
    let mode: string;

    if (consensus !== null && consensus !== 0 && std !== null && std > 0) {
      sue = safeDiv(actual - consensus, std);
      surprisePct = safeDiv(actual - consensus, Math.abs(consensus));
      if (surprisePct !== null) surprisePct *= 100;
      mode = "sue";
    } else {
      const yearAgo = findYearAgoEntry(history, eventDateMs);
      const priorActual = yearAgo ? rawNum(yearAgo.epsActual) : null;
      if (priorActual === null || priorActual === 0) return null;
      surprisePct = safeDiv(actual - priorActual, Math.abs(priorActual));
      if (surprisePct === null) return null;
      surprisePct *= 100;
      mode = "yoy";
    }

    const base =
      sue !== null
        ? 50 + 50 * (clamp(sue, -SUE_CAP, SUE_CAP) / SUE_CAP)
        : 50 + 50 * clamp((surprisePct as number) / 100, -1, 1);

    // event age on the evaluation clock (point-in-time safe for backfills)
    const ageDays = (evalNow(ctx) - eventDateMs) / DAY_MS;
    const inWindow = ageDays >= 0 && ageDays <= DRIFT_WINDOW_DAYS;

    let drift60d: number | null = null;
    if (inWindow && ctx.getCandles) {
      try {
        const candles = await ctx.getCandles(symbol, LOOKBACK_DAYS);
        drift60d = postEventReturn(candles, eventDateMs);
      } catch {
        drift60d = null;
      }
    }

    let score = base;
    if (inWindow) {
      if (drift60d !== null && drift60d !== 0) {
        const confirm = drift60d > 0 ? 100 : 0;
        score = 0.8 * base + 0.2 * confirm;
      }
    } else {
      score = 0.6 * base;
    }

    const signal: Signal = {
      symbol,
      score: round2(clamp(score, 0, 100)),
      rank: 0,
      components: {
        sue: sue !== null ? round2(sue) : null,
        surprisePct: round2(surprisePct as number),
        eventDate: Math.round(eventDateMs / 1000),
        drift60d: drift60d !== null ? round2(drift60d) : null,
        mode,
      },
    };
    return signal;
  },
};

/* Self-registering: importing this module makes S104 available to runners
 * (registry.register overwrites same-id entries, so double imports are safe).
 * The T14 runner wires strategies/ modules; registry.ts stays untouched. */
register(s104Strategy);
