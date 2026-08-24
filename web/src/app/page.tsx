"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Search from "@/components/Search";
// heavyweight (lightweight-charts + indicators): keep out of the initial bundle
const ChartPanel = dynamic(() => import("@/components/ChartPanel"), { ssr: false });
import StatsRail from "@/components/StatsRail";
import FundamentalsPanel from "@/components/FundamentalsPanel";
import TickerTape from "@/components/TickerTape";
import Odometer from "@/components/Odometer";
import Watchlist, { type WatchQuote } from "@/components/Watchlist";
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
import { istSessionOpen } from "@/lib/session";
import {
  addToWatchlist,
  DEFAULT_WATCHLIST,
  getServerWatchlistSnapshot,
  getWatchlistSnapshot,
  insertWatchlistAt,
  removeFromWatchlist,
  subscribeWatchlist,
  WATCHLIST_EVENT,
  WATCHLIST_KEY,
} from "@/lib/watchlist";
import { useWatchlistMirror } from "@/lib/watchlistMirror";
import { stripExchangeSuffix } from "@/lib/instruments";

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

const resolveTarget = async (
  params: URLSearchParams,
): Promise<WatchlistEntry | null> => {
  /* TASK-866: normalize case up front so ?s=reliance and ?s=RELIANCE
     resolve identically — watchlist snapshot and API both match exact */
  const raw = (params.get("s") ?? "").trim().toUpperCase();
  if (!raw) return null;
  /* TASK-358: exchange-suffixed links (?s=RELIANCE.NS / .BO) resolve to the
     bare symbol; the suffix pins the exchange when the URL carries none */
  const stripped = stripExchangeSuffix(raw);
  const s = stripped.symbol;
  const e =
    params.get("e")?.trim().toUpperCase() || stripped.impliedExchange || null;
  const hit = getWatchlistSnapshot().find(
    (x) => x.symbol === s && (!e || x.exchange === e),
  );
  if (hit) return hit;
  /* Server-side resolution (TASK-51): the instruments index no longer ships
     to the client; deep-links resolve through /api/instruments. */
  try {
    const res = await fetch(
      `/api/instruments?s=${encodeURIComponent(s)}${e ? `&e=${encodeURIComponent(e)}` : ""}`,
    );
    if (!res.ok) return null;
    const json = await res.json();
    const found = json.instrument as WatchlistEntry | null;
    return found ?? null;
  } catch {
    return null;
  }
};

/* Fallback for cold-start / empty-watchlist — AC1+AC3: never render
   "Choose a symbol" with no chart. Marquee index so a first-time or
   wiped visitor lands on a real chart; deep-links still win via resolveTarget. */
const FALLBACK_ENTRY: SearchResult = {
  symbol: "NIFTY 50",
  name: "NIFTY 50",
  shortName: "NIFTY 50",
  exchange: "NSE",
  type: "Index",
  sector: "",
};

export default function Home() {
  useWatchlistMirror();
  const watchlist = useSyncExternalStore(
    subscribeWatchlist,
    getWatchlistSnapshot,
    getServerWatchlistSnapshot,
  );
  const [picked, setPicked] = useState<SearchResult | null>(null);
  const selected: SearchResult | WatchlistEntry = picked ?? watchlist[0] ?? FALLBACK_ENTRY;
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
  const [watchQuotes, setWatchQuotes] = useState<Map<string, WatchQuote>>(new Map());
  const reqId = useRef(0);
  /* TASK-83 undo slot — one pending removal, 5s window */
  const [pendingUndo, setPendingUndo] = useState<{ entry: WatchlistEntry; index: number } | null>(null);
  /* TASK-853: sr-only J/K step announcement */
  const [stepAnnounce, setStepAnnounce] = useState("");
  /* TASK-358 AC2: deep-linked symbol that resolved to nothing */
  const [missSymbol, setMissSymbol] = useState<string | null>(null);
  const undoTimer = useRef<number | null>(null);
  useEffect(() => {
    return () => {
      if (undoTimer.current !== null) window.clearTimeout(undoTimer.current);
    };
  }, []);

  const load = useCallback(
    async (
      r: { symbol: string; exchange: string; type: string },
      rangeKey: RangeKey,
    ) => {
      /* TASK-917: bounded auto-retry for TRANSIENT failures (network,
         5xx, index_unavailable). Spinner stays up until the schedule
         exhausts; permanent 4xx validation errors fail immediately.
         reqId guards every await — a newer request owns the UI. */
      const id = ++reqId.current;
      setLoading(true);
      setError(null);
      const MAX_ATTEMPTS = 3;
      for (let attempt = 1; ; attempt += 1) {
        let transient = true;
        try {
          const res = await fetch(chartUrl(r, rangeKey));
          const json = await res.json();
          if (id !== reqId.current) return;
          const err = errorMessage(res, json);
          if (!err && Array.isArray(json.candles)) {
            setData(json);
            setLoading(false);
            return;
          }
          transient =
            res.status >= 500 ||
            json.error === "index_unavailable" ||
            res.status === 0;
          setError(err || "Data unavailable");
        } catch {
          if (id !== reqId.current) return;
          setError("Network error");
        }
        if (!transient || attempt >= MAX_ATTEMPTS) {
          setLoading(false);
          return;
        }
        const wait = 1500 * 2 ** (attempt - 1);
        await new Promise((resolve) => window.setTimeout(resolve, wait));
        if (id !== reqId.current) return;
        /* AC: no wasted upstream when the tab is hidden */
        if (document.visibilityState !== "visible") {
          setLoading(false);
          return;
        }
      }
    },
    [],
  );

  const retry = useCallback(() => {
    setTickerNonce((n) => n + 1);
    load(selected, range);
  }, [selected, range, load]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const params = new URLSearchParams(location.search);
      const resolved = await resolveTarget(params);
      /* TASK-358: an explicit deep link that resolves to nothing gets a
         visible miss notice — never a silent NIFTY 50 substitution */
      const rawS = params.get("s")?.trim();
      if (!cancelled && rawS && !resolved) setMissSymbol(rawS.toUpperCase());
      const target = resolved ?? getWatchlistSnapshot()[0] ?? FALLBACK_ENTRY;
      if (cancelled) return;
      const rangeParam = params.get("r") as RangeKey | null;
      const startRange: RangeKey =
        rangeParam && RANGES.some((x) => x.range === rangeParam)
          ? rangeParam
          : "1y";
      setPicked(target);
      setRange(startRange);
      void load(target, startRange);
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    const fetchTape = async (force = false) => {
      /* TASK-53: interval ticks skip when the tab is hidden or the IST
         session is closed — overnight/holiday polls burn upstream quota
         for data that cannot change. The first mount fetch always runs
         (force) so the tape shows last session instead of staying empty. */
      if (!force && (document.hidden || !istSessionOpen())) return;
      try {
        const res = await fetch("/api/ticker");
        const json = await res.json();
        if (!cancelled) setTicker(json.items ?? []);
      } catch {
        /* silent */
      }
    };
    const reeval = () => {
      if (!document.hidden && istSessionOpen()) void fetchTape(true);
    };
    document.addEventListener("visibilitychange", reeval);
    void fetchTape(true);
    const t = setInterval(fetchTape, 90_000);
    return () => {
      cancelled = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", reeval);
    };
  }, [tickerNonce]);

  /* TASK-105 — batched live quotes + day sparks for watchlist rows. Re-fetches
     when the tape refreshes (same session-aware cadence) or the list changes;
     60s server cache keeps repeat polls free. */
  const watchKey = watchlist
    .map((w) => w.symbol.toUpperCase())
    .sort()
    .join(",");
  useEffect(() => {
    if (!watchKey) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear quotes when watchlist empties
      setWatchQuotes(new Map());
      return;
    }
    let cancelled = false;
    const fetchQuotes = async () => {
      try {
        const res = await fetch(`/api/watchlist-quotes?symbols=${encodeURIComponent(watchKey)}`);
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled && Array.isArray(json.quotes)) {
          setWatchQuotes(new Map(json.quotes.map((q: WatchQuote) => [q.symbol.toUpperCase(), q])));
        }
      } catch {
        /* keep previous quotes */
      }
    };
    void fetchQuotes();
    return () => {
      cancelled = true;
    };
  }, [watchKey, tickerNonce]);

  const pick = useCallback(
    (r: SearchResult) => {
      setPicked(r);
      setMissSymbol(null);
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
        /* TASK-853: deep-linked symbol not in the list (idx -1) used to wrap
           to a random entry — J now enters at the top, K from the bottom */
        let nextIdx: number;
        if (idx === -1) {
          nextIdx = step === 1 ? 0 : watchlist.length - 1;
        } else {
          nextIdx = (idx + step + watchlist.length) % watchlist.length;
        }
        const next = watchlist[nextIdx];
        /* TASK-98: say the wrap out loud instead of jumping silently */
        const wrapped =
          idx !== -1 &&
          (step === 1 ? idx + 1 >= watchlist.length : idx - 1 < 0);
        if (
          next &&
          !(
            selected &&
            next.symbol === selected.symbol &&
            next.exchange === selected.exchange
          )
        ) {
          pick(next);
          /* TASK-853 AC3: announce the step for screen readers */
          setStepAnnounce(
            `${wrapped ? "Wrapped to " : ""}${next.name}, ${next.symbol} ${next.exchange} — ${watchlist.indexOf(next) + 1} of ${watchlist.length}`,
          );
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
    /* TASK-83: stash the full entry + position for a 5s undo before the
       store drops it — both the desktop panel and mobile sheet funnel
       through here, so one chip serves both. */
    const idx = watchlist.findIndex(
      (x) => x.symbol === e.symbol && x.exchange === e.exchange,
    );
    const victim = idx >= 0 ? watchlist[idx] : null;
    removeFromWatchlist(e.symbol, e.exchange);
    if (victim) {
      if (undoTimer.current !== null) window.clearTimeout(undoTimer.current);
      setPendingUndo({ entry: victim, index: idx });
      undoTimer.current = window.setTimeout(() => {
        setPendingUndo(null);
        undoTimer.current = null;
      }, 5000);
    }
    /* displayed-symbol check must not require picked==null — after mount
       picked is always set, so derive from selected instead (TASK-763) */
    const displayed =
      selected != null &&
      selected.symbol === e.symbol &&
      selected.exchange === e.exchange;
    const wasPicked =
      picked != null &&
      picked.symbol === e.symbol &&
      picked.exchange === e.exchange;
    if (displayed) {
      if (wasPicked) setPicked(null);
      /* next head if any; on empty, re-derive to the fallback so chart,
         header and URL agree instead of showing the removed symbol (TASK-763) */
      const next = getWatchlistSnapshot().find(
        (x) => !(x.symbol === e.symbol && x.exchange === e.exchange),
      );
      if (next) load(next, "1y");
      else load(FALLBACK_ENTRY, range);
    }
  };

  const undoRemove = () => {
    if (!pendingUndo) return;
    insertWatchlistAt(pendingUndo.entry, pendingUndo.index);
    if (undoTimer.current !== null) window.clearTimeout(undoTimer.current);
    undoTimer.current = null;
    setPendingUndo(null);
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

  const hasChange = data?.change != null && data?.changePct != null;
  const isUp = hasChange && (data!.change as number) > 0;
  const isDown = hasChange && (data!.change as number) < 0;
  const isFlat = hasChange && (data!.change as number) === 0;
  const busy = loading;

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
        ? `${selected.symbol} · ${range.toUpperCase()} — NIFTY//TERM`
        : "NIFTY//TERM — Indian Market";
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
      void (async () => {
        const entry = await resolveTarget(params);
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
      })();
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
      {/* TASK-853: J/K step announcement for screen readers */}
      <div className="sr-only" role="status" aria-live="polite">
        {stepAnnounce}
      </div>

      {/* TASK-358 AC2: explicit deep link that matched nothing */}
      {missSymbol && (
        <div className="px-4 pt-3 sm:px-6">
          <p role="status" className="rounded-xl border border-line bg-panel-2 px-4 py-2.5 text-xs text-muted">
            Symbol “{missSymbol}” not found — showing NIFTY 50.{" "}
            <button
              type="button"
              onClick={() => setMissSymbol(null)}
              className="rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] text-paper transition-colors hover:border-line-strong"
            >
              Dismiss
            </button>
          </p>
        </div>
      )}

      <SiteHeader
        subtitle="Indian Market"
        sticky
        nav
        onHelp={() => setHelpOpen(true)}
        alerts={
          selected
            ? {
                symbol: selected.symbol,
                exchange: selected.exchange,
                price: data?.regularMarketPrice ?? null,
              }
            : null
        }
      />

      <TickerTape items={ticker} onSelect={pick} />

      <main id="main-content" tabIndex={-1} className="flex min-h-0 flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:flex-row lg:px-6">
        {/* sidebar desktop — viewport-bounded so long watchlists scroll internally (TASK-839) */}
        <aside className="hidden w-[320px] shrink-0 flex-col gap-4 lg:flex lg:sticky lg:top-24 lg:max-h-[calc(100dvh-7.5rem)] lg:self-start min-h-0">
          <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
            <p className="mb-3 text-xs font-medium tracking-wide text-muted">Search</p>
            <Search onSelect={pick} />
            <p className="mt-2 text-[11px] text-faint">Press <kbd className="rounded border border-line bg-panel-2 px-1 py-0.5 font-mono text-[10px]">/</kbd> to focus</p>
          </div>
          <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-line bg-surface p-4 shadow-sm">
            <Watchlist
              items={watchlist}
              selected={selected}
              onPick={pick}
              onRemove={removeEntry}
              quotes={watchQuotes}
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

          {/* onboarding hint — visible until first symbol is added */}
          {watchlist.length === 0 && (
            <div
              role="status"
              aria-live="polite"
              className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-panel-2 px-4 py-3 text-sm leading-relaxed"
            >
              <span className="text-paper">
                Your watchlist is empty — showing {DEFAULT_WATCHLIST[0].symbol}. Press{" "}
                <kbd className="rounded border border-line bg-surface px-1 py-0.5 font-mono text-xs">/</kbd> to search, star to save.
              </span>
              <button
                onClick={() => {
                  try {
                    window.localStorage.setItem(WATCHLIST_KEY, JSON.stringify(DEFAULT_WATCHLIST));
                    window.dispatchEvent(new CustomEvent(WATCHLIST_EVENT));
                  } catch {
                    /* quota */
                  }
                }}
                className="rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-paper hover:bg-paper hover:text-ink"
              >
                Restore defaults
              </button>
            </div>
          )}

          {/* instrument header */}
          <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <h1 className="truncate text-[22px] font-semibold tracking-tight text-paper sm:text-[28px]">
                  {(selected ?? (watchlist.length === 0 ? DEFAULT_WATCHLIST[0] : null))?.name ?? "Choose a symbol"}
                </h1>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-full bg-paper px-2.5 py-1 font-mono text-xs font-medium text-ink">
                    {(selected ?? (watchlist.length === 0 ? DEFAULT_WATCHLIST[0] : null))?.symbol ?? "—"}
                  </span>
                  <span className="rounded-full border border-line bg-panel-2 px-2.5 py-1 text-muted">
                    {(selected ?? (watchlist.length === 0 ? DEFAULT_WATCHLIST[0] : null))?.exchange ?? "NSE"}
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
                    /* TASK-193: token-driven (was tailwind amber) */
                    <span className="rounded-full border border-line bg-panel-2 px-2.5 py-1 text-muted" title="Cached data">
                      Cached data
                    </span>
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
              <span
                className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium tabular-nums border ${
                  isUp
                    ? "bg-up-soft text-up border-transparent"
                    : isDown
                      ? "bg-down-soft text-down border-transparent"
                      : isFlat
                        ? "bg-panel-2 text-muted border-line"
                        : "bg-surface text-faint border-line"
                }`}
              >
                {hasChange
                  ? isFlat
                    ? `0.00 · 0.00%`
                    : `${isUp ? "+" : ""}${(data!.change as number).toFixed(2)} · ${isUp ? "+" : ""}${(data!.changePct as number).toFixed(2)}%`
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

          {selected && (
            <FundamentalsPanel symbol={selected.symbol} isIndex={selected.type === "Index"} />
          )}

          <ChartPanel data={data} range={range} onRange={changeRange} loading={busy} />

          <footer className="flex flex-wrap items-center justify-between gap-3 text-xs text-faint">
            <span>Shortcuts: <kbd className="rounded border border-line bg-surface px-1 py-0.5 font-mono">/</kbd> search · <kbd className="rounded border border-line bg-surface px-1 py-0.5 font-mono">1–8</kbd> range · <kbd className="rounded border border-line bg-surface px-1 py-0.5 font-mono">J K</kbd> watchlist</span>
            <span className="flex items-center gap-3">
              <Link href="/screener" className="hover:text-paper">Screener</Link>
              <Link href="/breadth" className="hover:text-paper">Breadth</Link>
              <Link href="/help" className="hover:text-paper">Help</Link>
              <Link href="/pricing" className="hover:text-paper">Pricing</Link>
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
        <Watchlist items={watchlist} selected={selected} onPick={pickFromSheet} onRemove={removeEntry} bare quotes={watchQuotes} />
      </Modal>

      {/* TASK-83: undo chip floats above desktop panel and mobile sheet alike;
          the sr-only region announces removals for screen readers */}
      <p className="sr-only" role="status" aria-live="polite">
        {pendingUndo
          ? `Removed ${pendingUndo.entry.shortName || pendingUndo.entry.symbol} from watchlist. Undo available for 5 seconds.`
          : ""}
      </p>
      {pendingUndo && (
        <div className="pointer-events-none fixed inset-x-0 bottom-5 z-[60] flex justify-center px-4">
          <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-line bg-surface py-1.5 pl-4 pr-1.5 shadow-md text-sm">
            <span className="text-muted">
              Removed{" "}
              <span className="font-medium text-paper">
                {pendingUndo.entry.shortName || pendingUndo.entry.symbol}
              </span>
            </span>
            <button
              type="button"
              onClick={undoRemove}
              className="rounded-full bg-paper px-3 py-1 text-xs font-medium text-ink transition-colors hover:bg-accent"
            >
              Undo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
