"use client";

import { useEffect, useState } from "react";
import {
  istNow,
  istMinutes,
  sessionOpenFor,
  minutesUntilOpen,
  SESSION_CLOSE_MIN,
  type IstParts,
} from "@/lib/session";

const HHMM = (mins: number) =>
  `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;

export default function MarketStatus() {
  const [ist, setIst] = useState<IstParts | null>(null);

  useEffect(() => {
    const tick = () => setIst(istNow());
    tick();
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, []);

  if (!ist)
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] text-faint">
        <span className="h-1.5 w-1.5 rounded-full bg-line-strong" aria-hidden />
        —
      </span>
    );

  /* TASK-462: shared holiday-aware logic — a weekday trading holiday now
     reads "Market closed" with a countdown to the real next open */
  const open = sessionOpenFor(ist);
  const mins = istMinutes(ist);

  let countdown: string | null = null;
  if (open) {
    const diff = SESSION_CLOSE_MIN - mins;
    const h = Math.floor(diff / 60);
    const m = diff % 60;
    countdown = h > 0 ? `closes in ${h}h ${String(m).padStart(2, "0")}m` : `closes in ${m}m`;
  } else {
    const untilOpen = minutesUntilOpen(new Date(), ist);
    if (untilOpen != null) {
      const h = Math.floor(untilOpen / 60);
      const m = untilOpen % 60;
      countdown = h > 0 ? `in ${h}h ${String(m).padStart(2, "0")}m` : `in ${m}m`;
    }
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${open ? "border-up/20 bg-up-soft text-up" : "border-line bg-surface text-muted"}`}
      title={
        open
          ? `Market open — closes ${HHMM(SESSION_CLOSE_MIN)} IST`
          : `Market closed — opens ${HHMM(9 * 60 + 15)} IST`
      }
    >
      <span className={`h-1.5 w-1.5 rounded-full ${open ? "bg-up" : "bg-faint"}`} aria-hidden />
      {open ? "Market open" : "Market closed"}
      {countdown && <span className="whitespace-nowrap font-normal tabular-nums text-faint">· {countdown}</span>}
    </span>
  );
}
