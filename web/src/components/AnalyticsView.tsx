"use client";

import { useEffect, useRef } from "react";
import { track, type AnalyticsEventKind } from "@/lib/analytics";

/* Mount-time analytics ping (TASK-1388): renders nothing, fires one event
   per view. The ref guard keeps dev StrictMode double-mounts from
   double-counting; a real remount (navigate away and back) re-fires. */
export default function AnalyticsView({ kind }: { kind: AnalyticsEventKind }) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    track(kind);
  }, [kind]);
  return null;
}