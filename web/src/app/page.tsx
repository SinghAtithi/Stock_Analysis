"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Search from "@/components/Search";
import ChartPanel from "@/components/ChartPanel";
import StatsRail from "@/components/StatsRail";
import TickerTape from "@/components/TickerTape";
import Odometer from "@/components/Odometer";
import Watchlist from "@/components/Watchlist";
import StarToggle from "@/components/StarToggle";
import MarketStatus from "@/components/MarketStatus";
import type { ChartData, SearchResult, RangeKey, TickerItem } from "@/lib/types";
import { RANGES } from "@/lib/types";
import { timeAgo } from "@/lib/format";
import {
  addToWatchlist,
  getServerWatchlistSnapshot,
  getWatchlistSnapshot,
  removeFromWatchlist,
  subscribeWatchlist,
} from "@/lib/watchlist";

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

const chartUrl = (
  r: { symbol: string; exchange: string; type: string },
  rangeKey: RangeKey
): string => {
  const cfg = RANGES.find((x) => x.range === rangeKey) ?? RANGES[5];
  return `/api/chart?symbol=${encodeURIComponent(r.symbol)}&exchange=${encodeURIComponent(
    r.exchange
  )}&type=${encodeURIComponent(r.type)}&range=${cfg.range}&interval=${cfg.interval}`;
};

const errorMessage = (res: Response, json: { error?: string }): string => {
  if (!res.ok || json.error) {
    return json.error === "not_found"
      ? "symbol not found"
      : json.error ?? "upstream failure";
  }
  return "";
};

export default function Home() {
  /* persisted watchlist — hydration-safe external store */
  const watchlist = useSyncExternalStore(
    subscribeWatchlist,
    getWatchlistSnapshot,
    getServerWatchlistSnapshot
  );
  const [picked, setPicked] = useState<SearchResult | null>(null);
  const selected = picked ?? watchlist[0] ?? null;
  const [wlOpen, setWlOpen] = useState(false);
  const [data, setData] = useState<ChartData | null>(null);
  const [range, setRange] = useState<RangeKey>("1y");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ticker, setTicker] = useState<TickerItem[]>([]);
  const [tickerNonce, setTickerNonce] = useState(0);
  const reqId = useRef(0);
  const clock = useISTClock();

  const load = useCallback(
    async (r: { symbol: string; exchange: string; type: string }, rangeKey: RangeKey) => {
      const id = ++reqId.current;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(chartUrl(r, rangeKey));
        const json = await res.json();
        if (id !== reqId.current) return;
        const err = errorMessage(res, json);
        if (err) {
          setError(err);
          return;
        }
        setData(json);
      } catch {
        if (id === reqId.current) setError("network error");
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    },
    []
  );

  const retry = useCallback(() => {
    setTickerNonce((n) => n + 1);
    if (selected) load(selected, range);
  }, [selected, range, load]);

  /* initial load — first persisted watchlist entry; errors surface in the badge */
  useEffect(() => {
    const first = getWatchlistSnapshot()[0];
    if (!first) return;
    let cancelled = false;
    const id = ++reqId.current;
    (async () => {
      try {
        const res = await fetch(chartUrl(first, "1y"));
        const json = await res.json();
        if (cancelled || id !== reqId.current) return;
        const err = errorMessage(res, json);
        if (err) {
          setError(err);
          return;
        }
        setData(json);
      } catch {
        if (!cancelled && id === reqId.current) setError("network error");
      } finally {
        if (!cancelled && id === reqId.current) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* ticker tape */
  useEffect(() => {
    let cancelled = false;
    const fetchTape = async () => {
      try {
        const res = await fetch("/api/ticker");
        const json = await res.json();
        if (!cancelled) setTicker(json.items ?? []);
      } catch {
        /* silent */
      }
    };
    fetchTape();
    const t = setInterval(fetchTape, 90_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [tickerNonce]);

  /* number keys switch ranges, r retries */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName ?? "").toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      if ((e.key === "r" || e.key === "R") && !e.ctrlKey && !e.metaKey && !e.altKey) {
        retry();
        return;
      }
      const n = Number(e.key);
      if (n >= 1 && n <= RANGES.length) {
        setRange(RANGES[n - 1].range);
        if (selected) load(selected, RANGES[n - 1].range);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, load, retry]);

  const pick = (r: SearchResult) => {
    setPicked(r);
    setRange("1y");
    load(r, "1y");
  };

  const removeEntry = (e: { symbol: string; exchange: string }) => {
    /* if the derived selection was the removed entry, advance to the new head */
    const wasDerivedHead =
      picked == null &&
      selected != null &&
      selected.symbol === e.symbol &&
      selected.exchange === e.exchange;
    removeFromWatchlist(e.symbol, e.exchange);
    if (wasDerivedHead) {
      const next = getWatchlistSnapshot().find(
        (x) => !(x.symbol === e.symbol && x.exchange === e.exchange)
      );
      if (next) load(next, "1y");
    }
  };

  const changeRange = (r: RangeKey) => {
    setRange(r);
    if (selected) load(selected, r);
  };

  const starred =
    selected != null &&
    watchlist.some(
      (e) => e.symbol === selected.symbol && e.exchange === selected.exchange
    );

  const toggleStar = () => {
    if (!selected) return;
    if (starred) {
      removeFromWatchlist(selected.symbol, selected.exchange);
    } else {
      addToWatchlist({
        symbol: selected.symbol,
        name: selected.name,
        shortName: selected.shortName,
        exchange: selected.exchange,
        type: selected.type,
        sector: selected.sector,
      });
    }
  };

  const up = (data?.change ?? 0) >= 0;
  /* loading overlay only applies while a symbol is selected */
  const busy = loading && selected != null;

  /* close the mobile watchlist sheet on Escape; lock body scroll while open */
  useEffect(() => {
    if (!wlOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setWlOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [wlOpen]);

  const pickFromSheet = (r: SearchResult) => {
    setWlOpen(false);
    pick(r);
  };

  return (
    <div className="flex min-h-screen flex-col bg-ink">
      {/* ---------- top bar ---------- */}
      <header className="flex items-center justify-between border-b border-hairline px-4 sm:px-6 py-3">
        <div className="flex items-center gap-3">
          <span className="inline-block h-2.5 w-2.5 bg-up" aria-hidden />
          <span className="font-mono text-[13px] font-bold tracking-[0.3em] text-paper">
            NIFTY<span className="text-faint">{"//"}</span>TERM
            <span className="cursor-blink text-up">_</span>
          </span>
        </div>
        <div className="flex items-center gap-4 sm:gap-6 font-mono text-[11px] tracking-widest text-muted">
          <span className="tabular-nums text-faint">{clock ? `${clock} IST` : "—:—:— IST"}</span>
          <MarketStatus />
          <span className="hidden sm:flex items-center gap-2 text-paper">
            NSE·BSE
          </span>
        </div>
      </header>

      {/* ---------- ticker tape ---------- */}
      <TickerTape items={ticker} />

      {/* ---------- body ---------- */}
      <main className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* sidebar */}
        <aside className="hidden w-[300px] shrink-0 flex-col border-r border-hairline p-5 lg:flex">
          <Search onSelect={pick} />
          <Watchlist
            items={watchlist}
            selected={selected}
            onPick={pick}
            onRemove={removeEntry}
          />
        </aside>

        {/* main */}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-5 p-4 sm:p-6 lg:p-8">
          <div className="lg:hidden">
            <div className="flex items-stretch gap-3">
              <div className="min-w-0 flex-1">
                <Search onSelect={pick} />
              </div>
              <button
                onClick={() => setWlOpen(true)}
                aria-expanded={wlOpen}
                aria-haspopup="dialog"
                className="shrink-0 border border-hairline-strong bg-panel px-3 font-mono text-[11px] tracking-widest text-muted transition-colors duration-100 hover:text-paper"
              >
                WL<span className="text-up">·{String(watchlist.length).padStart(2, "0")}</span>
              </button>
            </div>
          </div>

          {/* name + price */}
          <div className="animate-fade-up">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
              <h1 className="font-display text-[28px] font-extrabold uppercase leading-none tracking-tight text-paper sm:text-[36px]">
                {selected?.name ?? "—"}
              </h1>
              <div className="flex items-center gap-2 font-mono text-[10px] tracking-widest">
                <StarToggle inList={starred} onToggle={toggleStar} />
                <span className="border border-hairline-strong bg-panel px-2 py-1 text-muted">
                  {selected?.symbol ?? "—"}
                </span>
                <span className="border border-hairline px-2 py-1 text-faint">
                  {selected?.exchange ?? "—"}
                </span>
                <span className="border border-hairline px-2 py-1 text-faint">
                  {data?.currency ?? "INR"}
                </span>
                {data?.regularMarketTime != null && (
                  <span
                    className="border border-hairline px-2 py-1 text-faint"
                    title={`Quoted ${new Date(
                      data.regularMarketTime * 1000
                    ).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST`}
                  >
                    {timeAgo(data.regularMarketTime)}
                  </span>
                )}
              </div>
            </div>

            <div
              className="mt-3 flex flex-wrap items-end gap-x-5 gap-y-2"
              aria-live="polite"
              aria-busy={busy}
            >
              <span className="font-mono text-[44px] font-bold leading-none tracking-tight text-paper sm:text-[64px]">
                {data?.regularMarketPrice != null ? (
                  <Odometer value={data.regularMarketPrice} />
                ) : (
                  "—"
                )}
              </span>
              <span
                className={`mb-2 inline-flex items-center border px-2.5 py-1 font-mono text-[13px] font-bold tracking-wider ${
                  up
                    ? "border-up/40 bg-up/10 text-up"
                    : "border-down/40 bg-down/10 text-down"
                }`}
              >
                {data?.change != null && data?.changePct != null
                  ? `${up ? "+" : ""}${data.change.toFixed(2)}  ${up ? "+" : ""}${data.changePct.toFixed(2)}%`
                  : "—"}
              </span>
              {error && (
                <span
                  className="mb-2 flex flex-wrap items-center gap-3 font-mono text-[11px] tracking-widest text-down"
                  aria-live="polite"
                >
                  <span>⚠ {error.toUpperCase()}</span>
                  <button
                    onClick={retry}
                    className="border border-hairline px-2 py-1 font-mono text-[11px] tracking-widest text-paper transition-colors duration-100 hover:bg-panel"
                  >
                    RETRY
                  </button>
                </span>
              )}
            </div>
          </div>

          {/* stats strip */}
          {data && <StatsRail data={data} />}

          {/* chart */}
          <ChartPanel data={data} range={range} onRange={changeRange} loading={busy} />

          <footer className="flex items-center justify-between font-mono text-[10px] tracking-[0.2em] text-faint">
            <span>RANGE KEYS 1–8 · R RETRY · CROSSHAIR FOR OHLC · / SEARCH</span>
            <span className="hidden sm:block">NIFTY//TERM · {new Date().getFullYear()}</span>
          </footer>
        </section>
      </main>

      {/* ---------- mobile watchlist sheet ---------- */}
      {wlOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            aria-label="Close watchlist"
            className="absolute inset-0 w-full h-full bg-ink/70"
            onClick={() => setWlOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Watchlist"
            className="animate-sheet-up absolute inset-x-0 bottom-0 max-h-[75vh] overflow-y-auto border-t border-hairline-strong bg-ink p-5 shadow-[0_-24px_48px_-12px_rgba(0,0,0,0.8)]"
          >
            <div className="mb-4 flex items-center justify-between border-b border-hairline pb-3">
              <span className="font-mono text-[10px] tracking-[0.3em] text-faint">
                WATCHLIST
              </span>
              <button
                onClick={() => setWlOpen(false)}
                aria-label="Close watchlist"
                className="px-2 py-1 font-mono text-[12px] text-faint transition-colors duration-100 hover:text-paper"
              >
                ✕
              </button>
            </div>
            <Watchlist
              items={watchlist}
              selected={selected}
              onPick={pickFromSheet}
              onRemove={removeEntry}
            />
          </div>
        </div>
      )}
    </div>
  );
}
