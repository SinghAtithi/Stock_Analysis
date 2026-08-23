"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Search from "@/components/Search";
import ChartPanel from "@/components/ChartPanel";
import StatsRail from "@/components/StatsRail";
import FundamentalsPanel from "@/components/FundamentalsPanel";
import TickerTape from "@/components/TickerTape";
import Odometer from "@/components/Odometer";
import Watchlist from "@/components/Watchlist";
import StarToggle from "@/components/StarToggle";
import SiteHeader from "@/components/SiteHeader";
import Modal from "@/components/Modal";
import type {
  ChartData,
  SearchResult,
  RangeKey,
  TickerItem,
} from "@/lib/types";
import type { WatchlistEntry } from "@/lib/watchlist";
import { RANGES } from "@/lib/types";
import { timeAgo } from "@/lib/format";
import { searchInstruments } from "@/lib/instruments";
import {
  addToWatchlist,
  getServerWatchlistSnapshot,
  getWatchlistSnapshot,
  removeFromWatchlist,
  subscribeWatchlist,
} from "@/lib/watchlist";

const chartUrl = (
  r: { symbol: string; exchange: string; type: string },
  rangeKey: RangeKey,
): string => {
  const cfg = RANGES.find((x) => x.range === rangeKey) ?? RANGES[5];
  return `/api/chart?symbol=${encodeURIComponent(r.symbol)}&exchange=${encodeURIComponent(
    r.exchange,
  )}&type=${encodeURIComponent(r.type)}&range=${cfg.range}&interval=${cfg.interval}`;
};

const errorMessage = (res: Response, json: { error?: string }): string => {
  if (!res.ok || json.error) {
    if (json.error === "not_found") return "Symbol not found";
    if (json.error === "index_unavailable")
      return "Index data unavailable — upstream throttled";
    return json.error ?? "Upstream failure";
  }
  return "";
};

const resolveTarget = (params: URLSearchParams): WatchlistEntry | null => {
  const s = params.get("s");
  if (!s) return null;
  const e = params.get("e");
  const hit = getWatchlistSnapshot().find(
    (x) => x.symbol === s && (!e || x.exchange === e),
  );
  if (hit) return hit;
  const found = searchInstruments(s, 1)[0];
  if (found && found.symbol.toUpperCase() === s.toUpperCase()) {
    return {
      symbol: found.symbol,
      name: found.name,
      shortName: found.symbol,
      exchange: found.exchange,
      type: found.isIndex ? "Index" : "Equity",
      sector: found.sector ?? "",
    };
  }
  return null;
};

export default function Home() {
  const watchlist = useSyncExternalStore(
    subscribeWatchlist,
    getWatchlistSnapshot,
    getServerWatchlistSnapshot,
  );
  const [picked, setPicked] = useState<SearchResult | null>(null);
  const selected = picked ?? watchlist[0] ?? null;
  const selectedRef = useRef(selected);
  useEffect(() => {
    selectedRef.current = selected;
  });
  const [wlOpen, setWlOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [data, setData] = useState<ChartData | null>(null);
  const [range, setRange] = useState<RangeKey>("1y");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ticker, setTicker] = useState<TickerItem[]>([]);
  const [tickerNonce, setTickerNonce] = useState(0);
  const reqId = useRef(0);

  const load = useCallback(
    async (
      r: { symbol: string; exchange: string; type: string },
      rangeKey: RangeKey,
    ) => {
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
        if (id === reqId.current) setError("Network error");
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    },
    [],
  );

  const retry = useCallback(() => {
    setTickerNonce((n) => n + 1);
    if (selected) load(selected, range);
  }, [selected, range, load]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const target = resolveTarget(params) ?? getWatchlistSnapshot()[0] ?? null;
    if (!target) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- no symbol to load, clear initial loading
      setLoading(false);
      return;
    }
    const rangeParam = params.get("r") as RangeKey | null;
    const startRange: RangeKey =
      rangeParam && RANGES.some((x) => x.range === rangeParam)
        ? rangeParam
        : "1y";
    setPicked(target);
    setRange(startRange);
    void load(target, startRange);
  }, [load]);

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

  const pick = useCallback(
    (r: SearchResult) => {
      setPicked(r);
      setRange("1y");
      load(r, "1y");
    },
    [load],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName ?? "").toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      if (e.key === "?" || (e.key === "/" && e.shiftKey)) {
        setHelpOpen((v) => !v);
        return;
      }
      if (e.key === "Escape") {
        setHelpOpen(false);
        return;
      }
      if (
        (e.key === "r" || e.key === "R") &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        retry();
        return;
      }
      if (
        watchlist.length > 0 &&
        (e.key === "j" || e.key === "k" || e.key === "J" || e.key === "K")
      ) {
        const idx = watchlist.findIndex(
          (w) =>
            selected != null &&
            w.symbol === selected.symbol &&
            w.exchange === selected.exchange,
        );
        const step = e.key === "j" || e.key === "J" ? 1 : -1;
        const nextIdx = (idx + step + watchlist.length) % watchlist.length;
        const next = watchlist[nextIdx];
        if (
          next &&
          !(
            selected &&
            next.symbol === selected.symbol &&
            next.exchange === selected.exchange
          )
        ) {
          pick(next);
        }
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
  }, [selected, load, retry, watchlist, pick]);

  const removeEntry = (e: { symbol: string; exchange: string }) => {
    const wasDerivedHead =
      picked == null &&
      selected != null &&
      selected.symbol === e.symbol &&
      selected.exchange === e.exchange;
    removeFromWatchlist(e.symbol, e.exchange);
    if (wasDerivedHead) {
      const next = getWatchlistSnapshot().find(
        (x) => !(x.symbol === e.symbol && x.exchange === e.exchange),
      );
      if (next) load(next, "1y");
    }
  };

  const changeRange = useCallback(
    (r: RangeKey) => {
      setRange(r);
      if (selectedRef.current) load(selectedRef.current, r);
    },
    [load],
  );

  const starred =
    selected != null &&
    watchlist.some(
      (e) => e.symbol === selected.symbol && e.exchange === selected.exchange,
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
  const busy = loading && selected != null;

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

  useEffect(() => {
    const apply = () => {
      document.title = selected
        ? `${selected.symbol} · ${range.toUpperCase()} — NIFTY`
        : "NIFTY — Indian Market";
    };
    const timers = [0, 120, 400].map((d) => window.setTimeout(apply, d));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [selected, range]);

  const urlInited = useRef(false);
  useEffect(() => {
    if (!urlInited.current) {
      urlInited.current = true;
      return;
    }
    if (!selected) return;
    const q = new URLSearchParams({
      s: selected.symbol,
      e: selected.exchange,
      r: range,
    });
    history.pushState(null, "", `?${q}`);
  }, [selected, range]);

  const popPick = useRef(pick);
  const popRange = useRef(changeRange);
  useEffect(() => {
    popPick.current = pick;
    popRange.current = changeRange;
  });
  useEffect(() => {
    const onPop = () => {
      const params = new URLSearchParams(location.search);
      const s = params.get("s");
      if (!s) return;
      const entry = resolveTarget(params);
      if (!entry) return;
      const targetRange =
        (params.get("r") as RangeKey | null) &&
        RANGES.some((x) => x.range === params.get("r"))
          ? (params.get("r") as RangeKey)
          : "1y";
      const current = selectedRef.current;
      const symbolChanged =
        !current ||
        current.symbol !== entry.symbol ||
        current.exchange !== entry.exchange;
      if (symbolChanged) popPick.current(entry);
      else if (targetRange !== range) popRange.current(targetRange);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [range]);

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <a
        href="#chart"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-full focus:bg-paper focus:px-4 focus:py-2 focus:text-sm focus:text-ink"
      >
        Skip to chart
      </a>

      <SiteHeader
        subtitle="Indian Market"
        sticky
        nav
        onHelp={() => setHelpOpen(true)}
        alerts={
          selected ? { symbol: selected.symbol, exchange: selected.exchange } : null
        }
      />

      <TickerTape items={ticker} onSelect={pick} />

      <main className="flex min-h-0 flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:flex-row lg:px-6">
        {/* sidebar desktop */}
        <aside className="hidden w-[320px] shrink-0 flex-col gap-4 lg:flex">
          <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
            <p className="mb-3 text-xs font-medium tracking-wide text-muted">Search</p>
            <Search onSelect={pick} />
            <p className="mt-2 text-[11px] text-faint">Press <kbd className="rounded border border-line bg-panel-2 px-1 py-0.5 font-mono text-[10px]">/</kbd> to focus</p>
          </div>
          <div className="flex flex-1 flex-col rounded-2xl border border-line bg-surface p-4 shadow-sm">
            <Watchlist
              items={watchlist}
              selected={selected}
              onPick={pick}
              onRemove={removeEntry}
            />
          </div>
        </aside>

        {/* main */}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
          {/* mobile search */}
          <div className="flex items-stretch gap-3 lg:hidden">
            <div className="min-w-0 flex-1 rounded-2xl border border-line bg-surface p-3 shadow-sm">
              <Search onSelect={pick} />
            </div>
            <button
              onClick={() => setWlOpen(true)}
              aria-expanded={wlOpen}
              aria-haspopup="dialog"
              className="shrink-0 rounded-2xl border border-line bg-surface px-4 text-sm font-medium text-paper shadow-sm"
            >
              Watchlist <span className="ml-1 rounded-full bg-panel-2 px-1.5 py-0.5 font-mono text-xs text-muted">{String(watchlist.length).padStart(2, "0")}</span>
            </button>
          </div>

          {/* instrument header */}
          <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <h1 className="truncate text-[22px] font-semibold tracking-tight text-paper sm:text-[28px]">
                  {selected?.name ?? "Choose a symbol"}
                </h1>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-full bg-paper px-2.5 py-1 font-mono text-xs font-medium text-ink">
                    {selected?.symbol ?? "—"}
                  </span>
                  <span className="rounded-full border border-line bg-panel-2 px-2.5 py-1 text-muted">
                    {selected?.exchange ?? "NSE"}
                  </span>
                  <span className="rounded-full border border-line px-2.5 py-1 text-faint">
                    {data?.currency ?? "INR"}
                  </span>
                  {data?.regularMarketTime != null && (
                    <span className="rounded-full border border-line px-2.5 py-1 text-faint" title={new Date(data.regularMarketTime * 1000).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}>
                      {timeAgo(data.regularMarketTime)}
                    </span>
                  )}
                  {data?.stale && (
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/50 dark:text-amber-300">Cached data</span>
                  )}
                  {data?.degraded === "daily" && (
                    <span className="rounded-full border border-line bg-surface px-2.5 py-1 text-faint">Daily</span>
                  )}
                </div>
              </div>
              <StarToggle inList={starred} onToggle={toggleStar} />
            </div>

            <div className="mt-5 flex flex-wrap items-baseline gap-3" aria-live="polite" aria-busy={busy}>
              <span className="font-mono text-[36px] font-semibold tracking-tight text-paper sm:text-[44px]">
                {data?.regularMarketPrice != null ? (
                  <Odometer value={data.regularMarketPrice} />
                ) : loading ? (
                  <span aria-hidden className="inline-block h-[0.9em] w-[5em] animate-pulse rounded bg-panel-2 align-baseline" />
                ) : (
                  "—"
                )}
              </span>
              <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium tabular-nums ${up ? "bg-up-soft text-up" : "bg-down-soft text-down"}`}>
                {data?.change != null && data?.changePct != null
                  ? `${up ? "+" : ""}${data.change.toFixed(2)} · ${up ? "+" : ""}${data.changePct.toFixed(2)}%`
                  : "—"}
              </span>
              {error && (
                <span className="inline-flex items-center gap-2 rounded-full border border-down/20 bg-down-soft px-3 py-1 text-xs text-down" aria-live="polite">
                  {error}
                  <button onClick={retry} className="rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-paper shadow-sm">Retry</button>
                </span>
              )}
            </div>
          </div>

          {data && <StatsRail data={data} />}

          {selected && <FundamentalsPanel symbol={selected.symbol} />}

          <ChartPanel data={data} range={range} onRange={changeRange} loading={busy} />

          <footer className="flex flex-wrap items-center justify-between gap-3 text-xs text-faint">
            <span>Shortcuts: <kbd className="rounded border border-line bg-surface px-1 py-0.5 font-mono">/</kbd> search · <kbd className="rounded border border-line bg-surface px-1 py-0.5 font-mono">1–8</kbd> range · <kbd className="rounded border border-line bg-surface px-1 py-0.5 font-mono">J K</kbd> watchlist</span>
            <span className="flex items-center gap-3">
              <Link href="/screener" className="hover:text-paper">Screener</Link>
              <Link href="/breadth" className="hover:text-paper">Breadth</Link>
              <Link href="/board" className="rounded-full bg-paper px-2.5 py-1 font-medium text-ink">Board</Link>
              <span className="hidden sm:inline">NIFTY · {new Date().getFullYear()}</span>
            </span>
          </footer>
        </section>
      </main>

      <Modal open={helpOpen} onClose={() => setHelpOpen(false)} label="Keyboard shortcuts">
        <div className="mb-4 flex items-center justify-between">
          <span className="text-sm font-semibold text-paper">Keyboard shortcuts</span>
          <button onClick={() => setHelpOpen(false)} aria-label="Close help" className="rounded-full border border-line bg-surface px-2 py-1 text-sm text-muted hover:text-paper">✕</button>
        </div>
        <ul className="flex flex-col gap-2 text-sm">
          {[
            ["/", "Focus search"],
            ["1–8", "Switch timeframe"],
            ["J / K", "Step watchlist"],
            ["R", "Retry data"],
            ["L", "Log / linear scale"],
            ["?", "Toggle this panel"],
            ["ESC", "Close panel"],
          ].map(([k, label]) => (
            <li key={k} className="flex items-center justify-between gap-4 rounded-xl border border-line bg-panel-2 px-3 py-2">
              <span className="text-muted">{label}</span>
              <kbd className="rounded-full border border-line bg-surface px-2.5 py-1 font-mono text-xs font-medium text-paper">{k}</kbd>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs leading-relaxed text-faint">Hover the chart for OHLC · All data live from NSE & BSE</p>
      </Modal>

      <Modal open={wlOpen} onClose={() => setWlOpen(false)} label="Watchlist" sheet panelClassName="lg:hidden">
        <div className="mb-4 flex items-center justify-between border-b border-line pb-3">
          <span className="text-sm font-semibold text-paper">Watchlist</span>
          <button onClick={() => setWlOpen(false)} aria-label="Close watchlist" className="rounded-full border border-line bg-surface px-2 py-1 text-sm text-muted hover:text-paper">✕</button>
        </div>
        <Watchlist items={watchlist} selected={selected} onPick={pickFromSheet} onRemove={removeEntry} bare />
      </Modal>
    </div>
  );
}
