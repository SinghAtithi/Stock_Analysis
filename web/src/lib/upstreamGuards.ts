/* Upstream-proxy GET guards (TASK-1403): per-IP token bucket + 60s
 * micro-cache for routes that fan out to Yahoo/Moneycontrol/Groww.
 *
 * Pure functions + injectable clock, mirroring tiers.ts/boardGuards.ts.
 * State is in-process — multi-instance deployments need a shared store
 * before these caps are load-bearing. Budget math: a full bucket allows a
 * 30-request burst and refills 0.5 req/s, so sustained abuse sheds long
 * before the marketData circuit breakers open. */

const BUCKET_CAP = 30;
const REFILL_PER_MS = 30 / 60_000; /* ~30 req/min per IP */

interface Bucket {
  tokens: number;
  lastRefill: number;
}

const buckets = new Map<string, Bucket>();

/** True when this request should be shed (429). Takes one token otherwise. */
export function takeToken(
  key: string,
  now = Date.now(),
  capacity = BUCKET_CAP,
  refillPerMs = REFILL_PER_MS
): boolean {
  const b = buckets.get(key) ?? { tokens: capacity, lastRefill: now };
  b.tokens = Math.min(capacity, b.tokens + (now - b.lastRefill) * refillPerMs);
  b.lastRefill = now;
  if (b.tokens < 1) {
    buckets.set(key, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(key, b);
  /* bounded store — unique-IP floods can't grow it unbounded */
  if (buckets.size > 5000) buckets.clear();
  return true;
}

/** Seconds until the bucket refills one token (for Retry-After). */
export function retryAfterSec(refillPerMs = REFILL_PER_MS): number {
  return Math.max(1, Math.ceil(1 / refillPerMs / 1000));
}

/* ---- 60s micro-cache ---- */

const CACHE_TTL_MS = 60_000;
const cacheStore = new Map<string, { data: unknown; expires: number }>();

export function cacheGet(key: string, now = Date.now()): unknown | null {
  const hit = cacheStore.get(key);
  if (hit && hit.expires > now) {
    /* refresh recency so hot keys survive the size cap */
    cacheStore.delete(key);
    cacheStore.set(key, hit);
    return hit.data;
  }
  if (hit) cacheStore.delete(key);
  return null;
}

export function cacheSet(key: string, data: unknown, now = Date.now()): void {
  if (cacheStore.size >= 200) {
    const oldest = cacheStore.keys().next().value;
    if (oldest !== undefined) cacheStore.delete(oldest);
  }
  cacheStore.set(key, { data, expires: now + CACHE_TTL_MS });
}

/** Test seam. */
export function resetUpstreamGuards(): void {
  buckets.clear();
  cacheStore.clear();
}
