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
  runStamps.set(deviceKey, list);
  if (runStamps.size > 5000) runStamps.clear();
  return verdict;
}

/** Test seam: clear in-process usage state. */
export function resetTierUsage(): void {
  runStamps.clear();
}
