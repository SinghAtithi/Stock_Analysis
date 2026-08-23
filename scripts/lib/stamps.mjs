/**
 * Evaluation-stamp helpers for signal backfills (TASK-34).
 * Kept side-effect-free so tests can import without executing the CLI.
 */

/**
 * UTC month-end epoch seconds, k months before the month containing endSec
 * (k=0 → the last instant of endSec's own month).
 *
 * Example (UTC): monthEndBefore(2026-08-23T10:00Z, 1) → 2026-07-31T23:59:59Z
 */
export function monthEndBefore(endSec, k) {
  const d = new Date(endSec * 1000);
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - k + 1, 0, 23, 59, 59);
  return Math.floor(t / 1000);
}

/**
 * Backfill stamps for a walk-forward sweep ending at `endSec`:
 * the last N-1 historical month-ends plus one final "current" stamp.
 */
export function backfillStamps(endSec, months) {
  const out = [];
  for (let k = months - 1; k >= 1; k--) out.push(monthEndBefore(endSec, k));
  out.push(endSec);
  return out;
}
