"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import Skeleton from "@/components/Skeleton";
import { getDeviceId } from "@/lib/device";
import { buildIcs, downloadIcs } from "@/lib/ics";
import {
  getServerWatchlistSnapshot,
  getWatchlistSnapshot,
  subscribeWatchlist,
} from "@/lib/watchlist";
import { useWatchlistMirror } from "@/lib/watchlistMirror";
import type { EarningsEvent } from "@/lib/earningsCalendar";
import instruments from "@/data/instruments.json" with { type: "json" };

type Tab = "watchlist" | "nifty50" | "nifty500";

const TABS: { id: Tab; label: string }[] = [
  { id: "watchlist", label: "Watchlist" },
  { id: "nifty50", label: "Nifty 50" },
  { id: "nifty500", label: "Nifty 500" },
];

interface CalendarMeta {
  source: string;
  asOf: string;
  stale: boolean;
  staleDays: number;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/* parse "YYYY-MM-DD" as a local calendar date (no timezone shifting) */
const parseDate = (iso: string): Date => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};

const dayLabel = (iso: string): string => {
  const d = parseDate(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
};

/* Monday-start week key ("YYYY-MM-DD" of the Monday) + label */
const weekOf = (iso: string): { key: string; label: string } => {
  const d = parseDate(iso);
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return {
    key: monday.toISOString().slice(0, 10),
    label: `Week of ${dayLabel(monday.toISOString().slice(0, 10))}`,
  };
};

interface QuoteRow {
  symbol: string;
  price: number | null;
}

type AlertState =
  | { status: "idle" }
  | { status: "busy" }
  | { status: "ok" }
  | { status: "error"; message: string };

export default function CalendarPage() {
  useWatchlistMirror();
  const watchlist = useSyncExternalStore(
    subscribeWatchlist,
    getWatchlistSnapshot,
    getServerWatchlistSnapshot,
  );
  const watchSymbols = useMemo(
    () => new Set(watchlist.map((e) => e.symbol)),
    [watchlist],
  );

  const [events, setEvents] = useState<EarningsEvent[]>([]);
  const [meta, setMeta] = useState<CalendarMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<Tab>("watchlist");
  const [prices, setPrices] = useState<Map<string, number>>(new Map());
  const [alerts, setAlerts] = useState<Map<string, AlertState>>(new Map());

  const nifty50 = useMemo(
    () => new Set(instruments.filter((i) => i.idx?.includes("NIFTY 50")).map((i) => i.s)),
    [],
  );
  const nifty500 = useMemo(
    () => new Set(instruments.filter((i) => i.idx?.includes("NIFTY 500")).map((i) => i.s)),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/calendar");
        if (!res.ok) throw new Error("calendar_failed");
        const json = (await res.json()) as {
          events: EarningsEvent[];
          meta: CalendarMeta;
        };
        if (!cancelled) {
          setEvents(json.events ?? []);
          setMeta(json.meta ?? null);
          setError(false);
        }
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = useMemo(() => {
    switch (tab) {
      case "nifty50":
        return events.filter((e) => nifty50.has(e.symbol));
      case "nifty500":
        return events.filter((e) => nifty500.has(e.symbol));
      default:
        return events.filter((e) => watchSymbols.has(e.symbol));
    }
  }, [events, tab, nifty50, nifty500, watchSymbols]);

  /* last-close prices for the visible rows (tape-first, bounded) */
  useEffect(() => {
    if (visible.length === 0) return;
    let cancelled = false;
    const wanted = [...new Set(visible.map((e) => e.symbol))];
    const load = async () => {
      const found = new Map<string, number>();
      for (let i = 0; i < wanted.length; i += 30) {
        const chunk = wanted.slice(i, i + 30);
        try {
          const res = await fetch(
            `/api/watchlist-quotes?symbols=${encodeURIComponent(chunk.join(","))}`,
          );
          if (!res.ok) continue;
          const json = (await res.json()) as { quotes?: QuoteRow[] };
          for (const q of json.quotes ?? []) {
            if (q.price != null && Number.isFinite(q.price) && q.price > 0) {
              found.set(q.symbol.toUpperCase(), q.price);
            }
          }
        } catch {
          /* offline — prices stay unknown, alert button degrades */
        }
      }
      if (!cancelled) setPrices(found);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [visible]);

  const setAlertFor = (e: EarningsEvent, next: AlertState) => {
    setAlerts((prev) => new Map(prev).set(e.symbol, next));
  };

  const alertOnResult = async (e: EarningsEvent) => {
    const price = prices.get(e.symbol);
    if (price == null) {
      setAlertFor(e, {
        status: "error",
        message: "No recent price known — open the company page to set a target.",
      });
      return;
    }
    setAlertFor(e, { status: "busy" });
    try {
      const res = await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId: getDeviceId(),
          symbol: e.symbol,
          exchange: "NSE",
          type: "price_above",
          price: Math.round(price * 100) / 100,
        }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string; limit?: number };
        const message =
          json.error === "alert_cap_reached"
            ? `Free plan allows ${typeof json.limit === "number" ? json.limit : 5} active alerts — remove one or upgrade.`
            : json.error === "db_unavailable"
              ? "Alert service unavailable — try again shortly."
              : "Could not create alert.";
        setAlertFor(e, { status: "error", message });
        return;
      }
      setAlertFor(e, { status: "ok" });
      window.setTimeout(() => setAlertFor(e, { status: "idle" }), 4000);
    } catch {
      setAlertFor(e, { status: "error", message: "Network error — try again." });
    }
  };

  const icsFor = (e: EarningsEvent) => {
    downloadIcs(
      `results-${e.symbol.toLowerCase()}-${e.date.replace(/-/g, "")}.ics`,
      buildIcs([
        {
          uid: `niftyterm-${e.symbol}-${e.date.replace(/-/g, "")}@niftyterm.in`,
          summary: `${e.name} — quarterly results`,
          description: `Sector: ${e.sector}\nExpected: ${e.time}\nFiling: ${e.filing}`,
          dtStart: e.date,
        },
      ]),
    );
  };

  const weeks = useMemo(() => {
    const groups = new Map<string, EarningsEvent[]>();
    for (const e of visible) {
      const w = weekOf(e.date);
      const list = groups.get(w.key) ?? [];
      list.push(e);
      groups.set(w.key, list);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [visible]);

  const alertStateOf = (e: EarningsEvent): AlertState => alerts.get(e.symbol) ?? { status: "idle" };
  const alertAnnouncement = [...alerts.entries()]
    .filter(([, s]) => s.status === "ok" || s.status === "error")
    .map(([sym, s]) =>
      s.status === "ok"
        ? `${sym}: alert set`
        : s.status === "error"
          ? `${sym}: ${s.message}`
          : "",
    )
    .filter(Boolean)
    .join("; ");

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <SiteHeader subtitle="Earnings calendar" subtitleClassName="font-normal text-muted" />

      <main id="main-content" tabIndex={-1} className="mx-auto flex w-full max-w-[1280px] flex-1 flex-col gap-4 p-4 sm:p-6">
        <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm sm:p-6">
          <h1 className="text-xl font-semibold tracking-tight text-paper sm:text-2xl">Earnings calendar</h1>
          <p className="mt-1 text-sm text-muted">
            Upcoming quarterly results for your watchlist and the NIFTY universe. Dates are as confirmed by companies.
          </p>
          <p className="mt-3 inline-flex min-h-[1.65rem] items-center gap-2 rounded-full border border-line bg-panel-2 px-3 py-1 text-xs text-muted">
            {loading ? (
              <Skeleton className="h-3 w-48" />
            ) : meta ? (
              <>
                <span>{meta.source} · as of {meta.asOf}</span>
                {meta.stale && (
                  <span className="rounded-full bg-panel-2 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-faint">
                    stale
                  </span>
                )}
              </>
            ) : (
              <span>Schedule unavailable</span>
            )}
          </p>
        </div>

        {error && (
          <p role="alert" className="rounded-xl border border-down/20 bg-down-soft px-4 py-3 text-sm text-down">
            Calendar feed unreachable — showing last known schedule, if any.
          </p>
        )}

        <div role="group" aria-label="Universe" className="flex flex-wrap items-center gap-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-pressed={tab === t.id}
              className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
                tab === t.id
                  ? "border-paper bg-paper text-ink shadow-sm"
                  : "border-line bg-surface text-muted hover:border-line-strong hover:text-paper"
              }`}
            >
              {t.label}
            </button>
          ))}
          <span className="ml-1 rounded-full border border-line bg-surface px-3 py-1 font-mono text-xs tabular-nums text-faint">
            {loading ? "…" : `${visible.length} scheduled`}
          </span>
        </div>

        <div role="status" aria-live="polite" className="sr-only">
          {alertAnnouncement}
        </div>

        {loading ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-40 w-full rounded-2xl" />
          </div>
        ) : visible.length === 0 ? (
          <section className="rounded-2xl border border-dashed border-line bg-surface px-5 py-12 text-center">
            <p className="text-sm font-medium text-paper">
              {tab === "watchlist" && watchSymbols.size === 0
                ? "Your watchlist is empty"
                : `No scheduled results known${tab === "watchlist" ? " for your watchlist" : ""}`}
            </p>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted">
              {tab === "watchlist"
                ? "Add stocks to your watchlist to see their upcoming results here. Dates appear as companies confirm filings."
                : "No dates are known for this universe yet — the schedule updates as companies confirm filings."}
            </p>
            {tab === "watchlist" && (
              <Link
                href="/?s=RELIANCE"
                className="mt-4 inline-block rounded-full bg-paper px-4 py-1.5 text-sm font-medium text-ink shadow-sm transition-opacity hover:opacity-90"
              >
                Open the watchlist
              </Link>
            )}
          </section>
        ) : (
          weeks.map(([key, list]) => (
            <section key={key} aria-label={weeks.length > 1 ? undefined : "Scheduled results"}>
              <h2 className="mb-2 px-1 text-xs font-medium tracking-wide text-muted uppercase">{weekOf(list[0].date).label}</h2>
              <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
                <div className="hidden grid-cols-[5.5rem_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-3 border-b border-line bg-panel-2 px-4 py-2 text-[11px] font-medium tracking-wide text-faint uppercase sm:grid">
                  <span>Date</span>
                  <span>Symbol</span>
                  <span>Expected time</span>
                  <span>Sector</span>
                  <span className="text-right">Actions</span>
                </div>
                <ul>
                  {list.map((e, i) => {
                    const a = alertStateOf(e);
                    return (
                      <li
                        key={e.symbol}
                        className={`grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 px-4 py-3 sm:grid-cols-[5.5rem_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto] ${
                          i > 0 ? "border-t border-line" : ""
                        }`}
                      >
                        <span className="font-mono text-sm tabular-nums text-paper">{dayLabel(e.date)}</span>
                        <span className="sr-only">, </span>
                        <div className="min-w-0">
                          <Link
                            href={`/company/${e.symbol}.NS`}
                            className="font-mono text-sm font-medium tabular-nums text-paper hover:text-muted focus-visible:outline-2 focus-visible:outline-accent"
                          >
                            {e.symbol}
                          </Link>
                          <p className="truncate text-xs text-faint">{e.name}</p>
                        </div>
                        <span className="col-start-2 row-start-2 text-xs text-muted sm:col-auto sm:row-auto">
                          {e.time}
                          <span className="ml-1.5 rounded-full border border-line bg-panel-2 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-faint">
                            {e.filing}
                          </span>
                        </span>
                        <span className="col-start-2 row-start-3 text-xs text-muted sm:col-auto sm:row-auto">
                          {e.sector}
                        </span>
                        <div className="col-start-2 row-start-4 flex flex-wrap items-center justify-end gap-1.5 sm:col-auto sm:row-auto">
                          <button
                            type="button"
                            onClick={() => void alertOnResult(e)}
                            disabled={a.status === "busy"}
                            aria-label={`Alert on result for ${e.symbol}`}
                            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                              a.status === "ok"
                                ? "border-up bg-up-soft text-up"
                                : "border-line bg-surface text-muted hover:border-line-strong hover:text-paper"
                            }`}
                          >
                            {a.status === "busy" ? "Setting…" : a.status === "ok" ? "Alert set" : "Alert on result"}
                          </button>
                          <button
                            type="button"
                            onClick={() => icsFor(e)}
                            aria-label={`Download .ics for ${e.symbol} result`}
                            title="Add to calendar (.ics)"
                            className="rounded-full border border-line bg-surface px-3 py-1 font-mono text-xs tabular-nums text-muted transition-colors hover:border-line-strong hover:text-paper"
                          >
                            ICS
                          </button>
                        </div>
                        {a.status === "error" && (
                          <p role="alert" className="col-span-2 col-start-1 row-start-5 text-xs text-down sm:col-span-3 sm:col-start-2">
                            {a.message}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </section>
          ))
        )}

        <footer className="flex flex-wrap items-center justify-between gap-2 pt-2 text-xs text-faint">
          <span>
            Sources · {meta?.source ?? "Static filing calendar"} · NSE/BSE filings
            {meta?.asOf ? ` · as of ${meta.asOf}` : ""}
          </span>
          <Link href="/disclaimer" className="underline decoration-line underline-offset-2 hover:text-muted">
            Not investment advice
          </Link>
        </footer>
      </main>
    </div>
  );
}