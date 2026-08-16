/* Yahoo 429 backoff: min(60s * 2^n, 15min) + jitter 0-15s.
   n = consecutive 429 failures so far for a host (0-based).
   Pure so it can be unit-tested. */

export const YAHOO_BACKOFF_BASE_MS = 60_000;
export const YAHOO_BACKOFF_MAX_MS = 15 * 60_000;
export const YAHOO_BACKOFF_JITTER_MS = 15_000;

export function nextBackoff(n: number): number {
  const consecutive = Math.max(0, Math.floor(n));
  const exp = Math.min(
    YAHOO_BACKOFF_BASE_MS * 2 ** consecutive,
    YAHOO_BACKOFF_MAX_MS
  );
  return exp + Math.floor(Math.random() * YAHOO_BACKOFF_JITTER_MS);
}
