"use client";

import { useEffect, useState } from "react";

const SESSION_OPEN = 9 * 60 + 15;
const SESSION_CLOSE = 15 * 60 + 30;

interface Ist {
  y: number;
  mo: number;
  da: number;
  h: number;
  m: number;
  s: number;
}

function istNow(): Ist {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return {
    y: get("year"),
    mo: get("month"),
    da: get("day"),
    h: get("hour"),
    m: get("minute"),
    s: get("second"),
  };
}

function weekday(ist: Ist): number {
  return new Date(ist.y, ist.mo - 1, ist.da).getDay();
}

function minutesOfDay(ist: Ist): number {
  return ist.h * 60 + ist.m;
}

const HHMM = (mins: number) =>
  `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;

export default function MarketStatus() {
  const [ist, setIst] = useState<Ist | null>(null);

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

  const dow = weekday(ist);
  const mins = minutesOfDay(ist);
  const isWeekday = dow >= 1 && dow <= 5;
  const isOpen = isWeekday && mins >= SESSION_OPEN && mins < SESSION_CLOSE;

  let countdown: string | null = null;
  if (!isOpen) {
    const now = mins;
    let diff: number;
    if (isWeekday && now < SESSION_OPEN) diff = SESSION_OPEN - now;
    else if (dow === 5) diff = 3 * 1440 - now + SESSION_OPEN;
    else if (dow === 6) diff = 2 * 1440 - now + SESSION_OPEN;
    else if (dow === 0) diff = 1440 - now + SESSION_OPEN;
    else diff = 1440 - now + SESSION_OPEN;
    const h = Math.floor(diff / 60);
    const m = diff % 60;
    countdown = h > 0 ? `in ${h}h ${String(m).padStart(2, "0")}m` : `in ${String(m).padStart(2, "0")}m`;
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
      {countdown && <span className="hidden font-normal tabular-nums text-faint sm:inline">· {countdown}</span>}
    </span>
  );
}
