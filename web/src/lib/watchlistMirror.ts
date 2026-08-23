"use client";

import { useEffect } from "react";
import { getDeviceId } from "@/lib/device";
import {
  getWatchlistSnapshot,
  mergeIntoWatchlist,
  subscribeWatchlist,
  type WatchlistEntry,
} from "@/lib/watchlist";

/* Optional cloud mirror of the localStorage watchlist (TASK-62). localStorage
   stays the source of truth: pushes are fire-and-forget, pulls union-only
   (localStorage wins conflicts), every network failure is silent. */

const PULL_INTERVAL_MS = 90_000;

let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pullInFlight = false;

async function pushMirror(): Promise<void> {
  try {
    await fetch("/api/watchlist", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceId: getDeviceId(),
        symbols: getWatchlistSnapshot(),
      }),
    });
  } catch {
    /* offline / db down — mirror is optional by design */
  }
}

function schedulePush(): void {
  if (typeof window === "undefined") return;
  if (pushTimer !== null) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void pushMirror();
  }, 1500);
}

async function pullAndMerge(): Promise<void> {
  /* hidden tabs skip polling; in-flight guard stops overlapping pulls */
  if (pullInFlight || document.hidden) return;
  pullInFlight = true;
  try {
    const res = await fetch(
      `/api/watchlist?deviceId=${encodeURIComponent(getDeviceId())}`,
    );
    if (!res.ok) return;
    const json = (await res.json()) as { entries?: WatchlistEntry[] };
    if (!Array.isArray(json.entries)) return;
    if (mergeIntoWatchlist(json.entries) > 0) schedulePush();
  } catch {
    /* silent — localStorage remains authoritative */
  } finally {
    pullInFlight = false;
  }
}

/** Pull on mount, on tab refocus, and every 90s while visible
 *  (TASK-210) + debounced best-effort push on change. */
export function useWatchlistMirror(): void {
  useEffect(() => {
    void pullAndMerge();
    const onVisibility = () => {
      if (!document.hidden) void pullAndMerge();
    };
    document.addEventListener("visibilitychange", onVisibility);
    const pullInterval = setInterval(() => void pullAndMerge(), PULL_INTERVAL_MS);
    const unsubscribe = subscribeWatchlist(schedulePush);
    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisibility);
      clearInterval(pullInterval);
    };
  }, []);
}
