/* Tier limits + per-device cap enforcement for compute APIs (TASK-64).
 * Billing is NOT wired yet: "pro" is granted manually by listing device ids
 * in the ALLOW_PRO_DEVICES env var (comma-separated). Backtest counters are
 * in-process sliding windows keyed by device — multi-instance deployments
 * will need a shared store before these caps are load-bearing. */

export type Tier = "free" | "pro";
export type CapKind = "backtestRunsPerDay" | "activeAlertsMax";

export const TIER_LIMITS: Record<Tier, Record<CapKind, number>> = {
  free: { backtestRunsPerDay: 3, activeAlertsMax: 5 },
  pro: { backtestRunsPerDay: 100, activeAlertsMax: 50 },
};

export type CapVerdict =
  | { ok: true; tier: Tier }
  | {
      ok: false;
      tier: Tier;
      status: 402 | 429;
      reason: string;
      limit: number;
      retryAfterSec?: number;
    };

const DEVICE_RE = /^[a-zA-Z0-9_-]{8,64}$/;

export function isProDevice(deviceId: string): boolean {
  if (!deviceId) return false;
  const raw = process.env.ALLOW_PRO_DEVICES ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .includes(deviceId);
}

export function tierForDevice(deviceId: string | null | undefined): Tier {
  return deviceId && isProDevice(deviceId) ? "pro" : "free";
}

/* Stable enforcement key: real devices get their id, anonymous callers fall
   back to ip-keying so the cap never silently bypasses. */
export function deviceKeyFor(deviceId: string | null | undefined, fallbackKey: string): string {
  return deviceId && DEVICE_RE.test(deviceId) ? `dev:${deviceId}` : `ip:${fallbackKey}`;
}

/* Pure cap math — used by routes and tests. */
export function checkCap(tier: Tier, kind: CapKind, used: number): CapVerdict {
  const limit = TIER_LIMITS[tier][kind];
  if (used < limit) return { ok: true, tier };
  return {
    ok: false,
    tier,
    status: kind === "activeAlertsMax" ? 402 : 429,
    reason: kind === "activeAlertsMax" ? "alert_cap_reached" : "daily_cap_reached",
    limit,
  };
}

const DAY_MS = 86_400_000;
const runStamps = new Map<string, number[]>();

/**
 * TASK-1465: bound memory WITHOUT nuking honest users' windows on a
 * unique-key flood (the old `size > cap → clear()` let an attacker reset
 * everyone's counters at once). Fully-expired entries go first, then
 * oldest-touched down to `target` — call sites delete+set on access so
 * Map insertion order is true LRU: keys actively hitting the API survive,
 * one-shot/flood keys age out. Sweeps are amortized (cap→target headroom).
 */
export function evictOldest<T>(
  map: Map<string, T>,
  cap: number,
  target: number,
  isAlive: (v: T) => boolean
): void {
  if (map.size <= cap) return;
  for (const [k, v] of map) {
    if (!isAlive(v)) map.delete(k);
  }
  while (map.size > target) {
    const oldest = map.keys().next();
    if (oldest.done) break;
    map.delete(oldest.value);
  }
}

/* Gate + reserve one backtest run against the trailing-24h window.
   The slot is consumed even if the engine later fails (conservative anti-abuse:
   failures must not become free retries). */
export function gateBacktestRun(deviceKey: string, now = Date.now()): CapVerdict {
  const tier = tierForDevice(deviceKey.startsWith("ip:") ? undefined : deviceKey.slice(4));
  const list = (runStamps.get(deviceKey) ?? []).filter((t) => now - t < DAY_MS);
  const verdict = checkCap(tier, "backtestRunsPerDay", list.length);
  if (!verdict.ok) {
    runStamps.set(deviceKey, list);
    return { ...verdict, retryAfterSec: Math.max(1, Math.ceil((list[0] + DAY_MS - now) / 1000)) };
  }
  list.push(now);
  runStamps.delete(deviceKey); // refresh recency: delete+set makes eviction true-LRU
  runStamps.set(deviceKey, list);
  evictOldest(
    runStamps,
    5000,
    4000,
    (stamps) => stamps.some((t) => Date.now() - t < DAY_MS)
  );
  return verdict;
}

/** Test seam: clear in-process usage state. */
export function resetTierUsage(): void {
  runStamps.clear();
}
