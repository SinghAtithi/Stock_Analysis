"use client";

import { useEffect, useState } from "react";
import {
  istNow,
  istWeekday,
  istMinutes,
  SESSION_OPEN_MIN,
  SESSION_CLOSE_MIN,
  type IstParts,
} from "@/lib/session";

const SESSION_OPEN = SESSION_OPEN_MIN;
const SESSION_CLOSE = SESSION_CLOSE_MIN;

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

  const dow = istWeekday(ist);
  const mins = istMinutes(ist);
  const isWeekday = dow >= 1 && dow <= 5;
  const isOpen = isWeekday && mins >= SESSION_OPEN && mins < SESSION_CLOSE;

  let countdown: string | null = null;
  if (isOpen) {
    const diff = SESSION_CLOSE - mins;
    const h = Math.floor(diff / 60);
    const m = diff % 60;
    countdown = h > 0 ? `closes in ${h}h ${String(m).padStart(2, "0")}m` : `closes in ${m}m`;
  } else {
    const now = mins;
    let diff: number;
    if (isWeekday && now < SESSION_OPEN) diff = SESSION_OPEN - now;
    else if (dow === 5) diff = 3 * 1440 - now + SESSION_OPEN;
    else if (dow === 6) diff = 2 * 1440 - now + SESSION_OPEN;
    else if (dow === 0) diff = 1440 - now + SESSION_OPEN;
    else diff = 1440 - now + SESSION_OPEN;
    const h = Math.floor(diff / 60);
    const m = diff % 60;
    countdown = h > 0 ? `in ${h}h ${String(m).padStart(2, "0")}m` : `in ${m}m`;
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${isOpen ? "border-up/20 bg-up-soft text-up" : "border-line bg-surface text-muted"}`}
      title={
        isOpen
          ? `Market open — closes ${HHMM(SESSION_CLOSE)} IST`
          : `Market closed — opens ${HHMM(SESSION_OPEN)} IST`
      }
    >
      <span className={`h-1.5 w-1.5 rounded-full ${isOpen ? "bg-up" : "bg-faint"}`} aria-hidden />
      {isOpen ? "Market open" : "Market closed"}
      {countdown && <span className="whitespace-nowrap font-normal tabular-nums text-faint">· {countdown}</span>}
    </span>
  );
}
