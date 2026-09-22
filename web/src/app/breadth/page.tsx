"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import Skeleton from "@/components/Skeleton";
import Sparkline from "@/components/Sparkline";
import { istSessionOpen } from "@/lib/session";

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

const shortDate = (d: string): string => {
  const t = new Date(d);
  return Number.isNaN(t.getTime())
    ? d
    : t.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};

function FlowBars({ label, dates, values }: { label: string; dates: string[]; values: (number | null)[] }) {
  const max = Math.max(...values.map((v) => Math.abs(v ?? 0)), 1);
  const entries = values.flatMap((v, i) =>
    v != null ? [{ v, date: dates[i] ?? "" }] : []
  );
  const pos = entries.filter((e) => e.v >= 0).length;
  const neg = entries.length - pos;
  const peak = entries.reduce<{ v: number; date: string } | null>(
    (best, e) => (!best || Math.abs(e.v) > Math.abs(best.v) ? e : best),
    null
  );
  const signed = (v: number): string => `${v >= 0 ? "+" : ""}${v.toFixed(0)}`;
  const summary =
    `${label} across last ${entries.length} sessions: ${pos} positive, ${neg} negative` +
    (peak ? `, strongest ${signed(peak.v)} cr on ${shortDate(peak.date)}` : "");
  return (
    <div>
      <div className="flex h-16 items-end gap-1">
        {values.map((v, i) => {
          const n = v ?? 0;
          const h = Math.max(3, Math.round((Math.abs(n) / max) * 52));
          return (
            <button
              key={i}
              type="button"
              tabIndex={-1}
              aria-label={`${dates[i] ? `${shortDate(dates[i])}: ` : ""}${signed(n)} crore`}
              title={n.toFixed(0)}
              className="group/bar relative flex h-full flex-1 items-end"
            >
              <span
                className="w-full rounded-full transition-opacity duration-150 group-hover/bar:opacity-100 group-focus/bar:opacity-100"
                style={{
                  height: `${h}px`,
                  background: n >= 0 ? "var(--color-up)" : "var(--color-down)",
                  opacity: 0.85,
                }}
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -top-1 left-1/2 z-10 hidden -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-full border border-line bg-surface px-1.5 py-0.5 font-mono text-[10px] font-medium tabular-nums text-paper shadow-sm group-hover/bar:block group-focus/bar:block"
              >
                {signed(n)}
              </span>
            </button>
          );
        })}
      </div>
      <p className="sr-only">{summary}</p>
    </div>
  );
}

export default function BreadthPage() {
  const [data, setData] = useState<Breadth | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const tick = async (force = false) => {
      /* TASK-53: interval ticks skip while closed/hidden — breadth cannot
         change then. First mount fetch always runs (force). */
      if (!force && (document.hidden || !istSessionOpen())) return;
      try {
        const res = await fetch("/api/breadth");
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
    const reeval = () => {
      if (!document.hidden && istSessionOpen()) void tick(true);
    };
    document.addEventListener("visibilitychange", reeval);
    void tick(true);
    const t = setInterval(tick, 5 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", reeval);
    };
  }, [reloadKey]);

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
  const sessionDates = [...days].reverse().map((d) => d.date);
  const fiiSeries = [...days].reverse().map((d) => d.fii_total);
  const diSeries = [...days].reverse().map((d) => d.di_total);

  const num = (v: number | null | undefined, f = 0) =>
    v == null ? "—" : v.toLocaleString("en-IN", { maximumFractionDigits: f });

  /* TASK-85: first-fetch skeleton state — card shells hold pulse blocks sized
     to the real content so values replace them without layout shift */
  const initial = loading && !data;

  /* TASK-257: human-readable data date — parse the ISO parts directly so
     timezone conversion can never shift the day */
  const asOfLabel = (() => {
    const a = data?.meta.as_of;
    if (!a) return null;
    const [y, m, d] = a.split("-").map(Number);
    if (!y || !m || !d) return a;
    return new Intl.DateTimeFormat("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(Date.UTC(y, m - 1, d)));
  })();

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <SiteHeader subtitle="Breadth" subtitleClassName="font-normal text-muted" />

      <main id="main-content" tabIndex={-1} className="mx-auto flex w-full max-w-[1280px] flex-1 flex-col gap-4 p-4 sm:p-6">
        <div className="rounded-lg border border-line bg-surface p-5 shadow-sm sm:p-6">
          <h1 className="text-xl font-semibold tracking-tight text-paper sm:text-2xl">Market breadth</h1>
          <p className="mt-1 text-sm text-muted">Advance/decline, VIX and FII/DII flows. Updated every few minutes.</p>
          <p className="mt-3 inline-flex min-h-[1.65rem] items-center rounded-full border border-line bg-panel-2 px-3 py-1 text-xs text-muted">
            {initial ? (
              <Skeleton className="h-3 w-44" />
            ) : (
              <>Data as of {asOfLabel ?? "—"} · {days.length} sessions</>
            )}
          </p>
        </div>

        {error && (
          <p role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-down/20 bg-down-soft px-4 py-3 text-sm text-down">
            <span className="flex-1">Breadth feed unreachable — showing last cached data.</span>
            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              className="rounded-full border border-line bg-surface px-3 py-1 text-xs text-muted transition-colors hover:bg-panel-2"
            >
              Retry
            </button>
          </p>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <section className="rounded-md border border-line bg-surface p-5 shadow-sm">
            <p className="text-xs font-medium text-faint">India VIX</p>
            {initial ? (
              <div className="mt-2"><Skeleton className="h-8 w-20" /></div>
            ) : (
              <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-paper">{num(latest?.vix, 2)}</p>
            )}
            <div className="mt-3">
              {initial ? <Skeleton className="h-5 w-full" /> : <Sparkline values={vixSeries} stroke="var(--color-up)" label="VIX" />}
            </div>
            {!data?.meta.sources.vix && <p className="mt-2 text-xs text-faint">No data — source blocked</p>}
          </section>

          <section className="rounded-md border border-line bg-surface p-5 shadow-sm">
            <p className="text-xs font-medium text-faint">Advance / decline</p>
            {initial ? (
              <div className="mt-2"><Skeleton className="h-8 w-24" /></div>
            ) : (
              <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-paper">
                {latest?.adv != null && latest?.dec != null && latest.adv + latest.dec > 0
                  ? `${((latest.adv / (latest.adv + latest.dec)) * 100).toFixed(1)}%`
                  : "—"}
              </p>
            )}
            <div className="mt-2 flex gap-2 text-xs">
              {initial ? (
                <Skeleton className="h-5 w-44 rounded-full" />
              ) : (
                <>
                  <span className="rounded-full bg-up-soft px-2 py-0.5 font-medium text-up">A {num(latest?.adv, 0)}</span>
                  <span className="rounded-full bg-down-soft px-2 py-0.5 font-medium text-down">D {num(latest?.dec, 0)}</span>
                  <span className="rounded-full bg-panel-2 px-2 py-0.5 text-muted">U {num(latest?.unc, 0)}</span>
                </>
              )}
            </div>
            <div className="mt-3">
              {initial ? <Skeleton className="h-5 w-full" /> : <Sparkline values={adSeries} label="Advance ratio" />}
            </div>
            {!data?.meta.sources.ad && <p className="mt-2 text-xs text-faint">No data — source blocked</p>}
          </section>

          <section className="rounded-md border border-line bg-surface p-5 shadow-sm">
            <p className="text-xs font-medium text-faint">FII flows (₹ cr)</p>
            {initial ? (
              <div className="mt-2"><Skeleton className="h-8 w-28" /></div>
            ) : (
              <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-paper">{num(latest?.fii_total, 0)}</p>
            )}
            <div className="mt-2 flex gap-2 text-xs text-muted">
              {initial ? (
                <Skeleton className="h-4 w-32" />
              ) : (
                <>
                  <span>EQ {num(latest?.fii_equity, 0)}</span>
                  <span>DEBT {num(latest?.fii_debt, 0)}</span>
                </>
              )}
            </div>
            <div className="mt-3">
              {initial ? <Skeleton className="h-16 w-full" /> : <FlowBars label="FII flows" dates={sessionDates} values={fiiSeries} />}
            </div>
            {!data?.meta.sources.fii && <p className="mt-2 text-xs text-faint">No data — source blocked</p>}
          </section>

          <section className="rounded-md border border-line bg-surface p-5 shadow-sm">
            <p className="text-xs font-medium text-faint">DII flows (₹ cr)</p>
            {initial ? (
              <div className="mt-2"><Skeleton className="h-8 w-28" /></div>
            ) : (
              <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-paper">{num(latest?.di_total, 0)}</p>
            )}
            <div className="mt-2 flex gap-2 text-xs text-muted">
              {initial ? (
                <Skeleton className="h-4 w-32" />
              ) : (
                <>
                  <span>EQ {num(latest?.di_equity, 0)}</span>
                  <span>DEBT {num(latest?.di_debt, 0)}</span>
                </>
              )}
            </div>
            <div className="mt-3">
              {initial ? <Skeleton className="h-16 w-full" /> : <FlowBars label="DII flows" dates={sessionDates} values={diSeries} />}
            </div>
            {!data?.meta.sources.di &&
              (data?.meta.sources.fii ? (
                <p className="mt-2 text-xs text-faint">FII present — DII missing from feed</p>
              ) : (
                <p className="mt-2 text-xs text-faint">No data — source blocked</p>
              ))}
          </section>
        </div>

        <section className="rounded-md border border-line bg-surface p-5 shadow-sm">
          <p className="text-xs font-medium text-faint">52-week highs / lows</p>
          <div className="mt-3 flex flex-wrap items-baseline gap-6">
            {initial ? (
              <>
                <Skeleton className="h-7 w-24 rounded-full" />
                <Skeleton className="h-7 w-20 rounded-full" />
                <Skeleton className="h-5 w-24" />
              </>
            ) : (
              <>
                <span className="rounded-full bg-up-soft px-3 py-1 font-mono text-sm font-medium tabular-nums text-up">{num(latest?.hi, 0)} highs</span>
                <span className="rounded-full bg-down-soft px-3 py-1 font-mono text-sm font-medium tabular-nums text-down">{num(latest?.lo, 0)} lows</span>
                <span className="text-sm tabular-nums text-paper">
                  {latest?.hi != null && latest?.lo != null && latest.hi + latest.lo > 0
                    ? `${((latest.hi / (latest.hi + latest.lo)) * 100).toFixed(0)}% hi weight`
                    : "—"}
                </span>
              </>
            )}
          </div>
        </section>

        {!loading && days.length === 0 && !error && <p className="py-6 text-center text-sm text-faint">No sessions in the series yet — the pipeline is warming up.</p>}

        <footer className="flex items-center justify-between pt-2 text-xs text-faint">
          <span>Sources · NSE · Google · EOD store</span>
          <Link href="/disclaimer" className="underline decoration-line underline-offset-2 hover:text-muted">Not investment advice</Link>
        </footer>
      </main>
    </div>
  );
}
