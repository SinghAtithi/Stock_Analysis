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

let mergedThisSession = false;
let pushTimer: ReturnType<typeof setTimeout> | null = null;

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
  }
}

/** One merge-on-read per session + debounced best-effort push on change. */
export function useWatchlistMirror(): void {
  useEffect(() => {
    if (!mergedThisSession) {
      mergedThisSession = true;
      void pullAndMerge();
    }
    return subscribeWatchlist(schedulePush);
  }, []);
}
