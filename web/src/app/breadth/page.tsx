"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import MarketStatus from "@/components/MarketStatus";
import ThemeToggle from "@/components/ThemeToggle";
import Sparkline from "@/components/Sparkline";

interface Day {
  date: string;
  vix: number | null;
  fii_equity: number | null;
  fii_debt: number | null;
  di_equity: number | null;
  di_debt: number | null;
  fii_total: number | null;
  di_total: number | null;
  adv: number | null;
  dec: number | null;
  unc: number | null;
  hi: number | null;
  lo: number | null;
}

interface Breadth {
  days: Day[];
  meta: {
    as_of: string | null;
    sources: { vix: string | null; fii: string | null; di: string | null; ad: string | null };
  };
}

function useISTClock() {
  const [time, setTime] = useState<string | null>(null);
  useEffect(() => {
    const fmt = () =>
      new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Kolkata",
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(new Date());
    const t = setInterval(() => setTime(fmt()), 1000);
    return () => clearInterval(t);
  }, []);
  return time;
}

function FlowBars({ values }: { values: (number | null)[] }) {
  const max = Math.max(...values.map((v) => Math.abs(v ?? 0)), 1);
  const isDark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  const up = isDark ? "#8ec9a8" : "#0e7a3a";
  const down = isDark ? "#e8a09a" : "#c4362b";
  return (
    <div className="flex h-16 items-end gap-1">
      {values.map((v, i) => {
        const n = v ?? 0;
        const h = Math.max(3, Math.round((Math.abs(n) / max) * 52));
        return (
          <span
            key={i}
            className="flex-1 rounded-full"
            title={n.toFixed(0)}
            style={{
              height: `${h}px`,
              background: n >= 0 ? up : down,
              opacity: isDark ? 0.9 : 0.85,
            }}
          />
        );
      })}
    </div>
  );
}

export default function BreadthPage() {
  const [data, setData] = useState<Breadth | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const clock = useISTClock();

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/breadth", { cache: "no-store" });
        const json = await res.json();
        if (!cancelled) {
          setData(json);
          setError(false);
        }
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    tick();
    const t = setInterval(tick, 5 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const days = data?.days ?? [];
  const latest = days[0];
  const adSeries = [...days]
    .reverse()
    .map((d) =>
      d.adv != null && d.dec != null && d.adv + d.dec > 0
        ? (d.adv / (d.adv + d.dec)) * 100
        : null
    )
    .filter((v): v is number => v != null);
  const vixSeries = [...days].reverse().map((d) => d.vix).filter((v): v is number => v != null);
  const fiiSeries = [...days].map((d) => d.fii_total);
  const diSeries = [...days].map((d) => d.di_total);

  const num = (v: number | null | undefined, f = 0) =>
    v == null ? "—" : v.toLocaleString("en-IN", { maximumFractionDigits: f });

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-paper text-[11px] font-bold tracking-widest text-ink">N</span>
          <span className="text-sm font-semibold tracking-tight text-paper">NIFTY <span className="font-normal text-muted">Breadth</span></span>
        </Link>
        <div className="flex items-center gap-3 sm:gap-4">
          <span className="hidden font-mono text-xs tabular-nums text-faint sm:inline">{clock ? `${clock} IST` : "—"}</span>
          <MarketStatus />
          <ThemeToggle />
          <Link href="/board" className="rounded-full bg-paper px-3 py-1.5 text-sm font-medium text-ink shadow-sm">
            Board
          </Link>
          <Link href="/" className="rounded-full border border-line bg-surface px-3 py-1.5 text-sm font-medium text-paper hover:bg-panel-2">
            ← Terminal
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1280px] flex-1 flex-col gap-4 p-4 sm:p-6">
        <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm sm:p-6">
          <h1 className="text-xl font-semibold tracking-tight text-paper sm:text-2xl">Market breadth</h1>
          <p className="mt-1 text-sm text-muted">Advance/decline, VIX and FII/DII flows. Updated every few minutes.</p>
          <p className="mt-3 inline-flex rounded-full border border-line bg-panel-2 px-3 py-1 text-xs text-muted">As of {data?.meta.as_of ?? "—"} · {days.length} sessions</p>
        </div>

        {error && (
          <p className="rounded-xl border border-down/20 bg-down-soft px-4 py-3 text-sm text-down">Breadth feed unreachable — showing last cached data.</p>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <section className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
            <p className="text-xs font-medium tracking-wide text-faint uppercase">India VIX</p>
            <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-paper">{num(latest?.vix, 2)}</p>
            <div className="mt-3">
              <Sparkline values={vixSeries} stroke="var(--color-up)" label="VIX" />
            </div>
            {!data?.meta.sources.vix && <p className="mt-2 text-xs text-faint">No data — source blocked</p>}
          </section>

          <section className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
            <p className="text-xs font-medium tracking-wide text-faint uppercase">Advance / Decline</p>
            <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-paper">
              {latest?.adv != null && latest?.dec != null && latest.adv + latest.dec > 0
                ? `${((latest.adv / (latest.adv + latest.dec)) * 100).toFixed(1)}%`
                : "—"}
            </p>
            <div className="mt-2 flex gap-2 text-xs">
              <span className="rounded-full bg-up-soft px-2 py-0.5 font-medium text-up">A {num(latest?.adv, 0)}</span>
              <span className="rounded-full bg-down-soft px-2 py-0.5 font-medium text-down">D {num(latest?.dec, 0)}</span>
              <span className="rounded-full bg-panel-2 px-2 py-0.5 text-muted">U {num(latest?.unc, 0)}</span>
            </div>
            <div className="mt-3">
              <Sparkline values={adSeries} label="Advance ratio" />
            </div>
            {!data?.meta.sources.ad && <p className="mt-2 text-xs text-faint">No data — source blocked</p>}
          </section>

          <section className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
            <p className="text-xs font-medium tracking-wide text-faint uppercase">FII flows (₹ cr)</p>
            <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-paper">{num(latest?.fii_total, 0)}</p>
            <div className="mt-2 flex gap-2 text-xs text-muted">
              <span>EQ {num(latest?.fii_equity, 0)}</span>
              <span>DEBT {num(latest?.fii_debt, 0)}</span>
            </div>
            <div className="mt-3">
              <FlowBars values={fiiSeries} />
            </div>
            {!data?.meta.sources.fii && <p className="mt-2 text-xs text-faint">No data — source blocked</p>}
          </section>

          <section className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
            <p className="text-xs font-medium tracking-wide text-faint uppercase">DII flows (₹ cr)</p>
            <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-paper">{num(latest?.di_total, 0)}</p>
            <div className="mt-2 flex gap-2 text-xs text-muted">
              <span>EQ {num(latest?.di_equity, 0)}</span>
              <span>DEBT {num(latest?.di_debt, 0)}</span>
            </div>
            <div className="mt-3">
              <FlowBars values={diSeries} />
            </div>
            {!data?.meta.sources.di &&
              (data?.meta.sources.fii ? (
                <p className="mt-2 text-xs text-faint">FII present — DII missing from feed</p>
              ) : (
                <p className="mt-2 text-xs text-faint">No data — source blocked</p>
              ))}
          </section>
        </div>

        <section className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
          <p className="text-xs font-medium tracking-wide text-faint uppercase">52-week highs / lows</p>
          <div className="mt-3 flex flex-wrap items-baseline gap-6">
            <span className="rounded-full bg-up-soft px-3 py-1 font-mono text-sm font-medium tabular-nums text-up">{num(latest?.hi, 0)} highs</span>
            <span className="rounded-full bg-down-soft px-3 py-1 font-mono text-sm font-medium tabular-nums text-down">{num(latest?.lo, 0)} lows</span>
            <span className="text-sm tabular-nums text-paper">
              {latest?.hi != null && latest?.lo != null && latest.hi + latest.lo > 0
                ? `${((latest.hi / (latest.hi + latest.lo)) * 100).toFixed(0)}% hi weight`
                : "—"}
            </span>
          </div>
        </section>

        {loading && !data && <p className="py-6 text-center text-sm text-muted">Loading breadth…</p>}
        {!loading && days.length === 0 && !error && <p className="py-6 text-center text-sm text-faint">No sessions in the series yet — the pipeline is warming up.</p>}

        <footer className="flex items-center justify-between pt-2 text-xs text-faint">
          <span>Sources · NSE · Google · EOD store</span>
          <Link href="/disclaimer" className="underline decoration-line underline-offset-2 hover:text-muted">Not investment advice</Link>
        </footer>
      </main>
    </div>
  );
}
