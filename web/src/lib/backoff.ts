/* Yahoo 429 backoff: min(60s * 2^n, 15min) + jitter 0-15s.
   n = consecutive 429 failures so far for a host (0-based).
   Pure so it can be unit-tested. */

export const YAHOO_BACKOFF_BASE_MS = 60_000;
export const YAHOO_BACKOFF_MAX_MS = 15 * 60_000;
export const YAHOO_BACKOFF_JITTER_MS = 15_000;

export function nextBackoff(n: number): number {
  // NaN would poison the whole computation (Math.max(0, NaN) is NaN, and
  // setTimeout(NaN) fires immediately — turning backoff into a hot retry
  // loop). Only NaN resets to a fresh streak; +Infinity still saturates at
  // the cap via Math.min below.
  const raw = typeof n === "number" && !Number.isNaN(n) ? n : 0;
  const consecutive = Math.max(0, Math.floor(raw));
  const exp = Math.min(
    YAHOO_BACKOFF_BASE_MS * 2 ** consecutive,
    YAHOO_BACKOFF_MAX_MS
  );
  return exp + Math.floor(Math.random() * YAHOO_BACKOFF_JITTER_MS);
}
