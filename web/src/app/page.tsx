"use client";

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
import TickerTape from "@/components/TickerTape";
import Odometer from "@/components/Odometer";
import Watchlist from "@/components/Watchlist";
import StarToggle from "@/components/StarToggle";
import MarketStatus from "@/components/MarketStatus";
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

function useISTClock() {
  const [time, setTime] = useState<{ hhmm: string; ss: string } | null>(null);
  useEffect(() => {
    const fmt = () => {
      const now = new Date();
      const p = new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Kolkata",
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).formatToParts(now);
      const get = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
      return { hhmm: `${get("hour")}:${get("minute")}`, ss: get("second") };
    };
    const t = setInterval(() => setTime(fmt()), 1000);
    return () => clearInterval(t);
  }, []);
  return time;
}

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
    if (json.error === "not_found") return "symbol not found";
    if (json.error === "index_unavailable")
      return "index data unavailable — upstream throttled";
    return json.error ?? "upstream failure";
  }
  return "";
};

/* resolve ?s=&e= against the persisted watchlist, falling back to the local
   instrument index (deep links to non-watchlist symbols) */
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
  /* persisted watchlist — hydration-safe external store */
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
  const clock = useISTClock();

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
        if (id === reqId.current) setError("network error");
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

  /* initial load — deep-link (URL ?s=&e=&r=) takes priority, else first
     persisted watchlist entry; errors surface in the badge */
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const target = resolveTarget(params) ?? getWatchlistSnapshot()[0] ?? null;
    if (!target) return;
    const rangeParam = params.get("r") as RangeKey | null;
    const startRange: RangeKey =
      rangeParam && RANGES.some((x) => x.range === rangeParam)
        ? rangeParam
        : "1y";
    let cancelled = false;
    const id = ++reqId.current;
    (async () => {
      setPicked(target);
      setRange(startRange);
      try {
        const res = await fetch(chartUrl(target, startRange));
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

  const pick = useCallback(
    (r: SearchResult) => {
      setPicked(r);
      setRange("1y");
      load(r, "1y");
    },
    [load],
  );

  /* number keys switch ranges, r retries, ? help, j/k step the watchlist */
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
    /* if the derived selection was the removed entry, advance to the new head */
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

  /* document title tracks the active instrument.
     React's metadata manager re-applies the layout <title> after hydration,
     so re-assert a few ticks to converge on the symbol title. */
  useEffect(() => {
    const apply = () => {
      document.title = selected
        ? `${selected.symbol} · ${range.toUpperCase()} — NIFTY//TERM`
        : "NIFTY//TERM — Indian Stock Terminal";
    };
    const timers = [0, 120, 400].map((d) => window.setTimeout(apply, d));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [selected, range]);

  /* keep URL in sync — user-driven changes only. Never on mount: the initial
     URL already carries the deep link, and a mount-time replaceState would
     race StrictMode's double effect pass and clobber it. */
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

  /* history back/forward restores symbol + range (stable refs — pick and
     changeRange are useCallback with [load], effectively constant) */
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
    <div className="flex min-h-screen flex-col bg-ink">
      <a
        href="#chart"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:border focus:border-up/40 focus:bg-ink focus:px-3 focus:py-2 focus:font-mono focus:text-[11px] focus:tracking-widest focus:text-up"
      >
        SKIP TO CHART
      </a>
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
          <span className="tabular-nums text-faint">
            {clock ? (
              <>
                {clock.hhmm}
                <span className="hidden min-[420px]:inline">:{clock.ss}</span>
                <span className="hidden min-[540px]:inline"> IST</span>
              </>
            ) : (
              "—:—"
            )}
          </span>
          <MarketStatus />
          <span className="hidden sm:flex items-center gap-2 text-paper">
            NSE·BSE
          </span>
        </div>
      </header>

      {/* ---------- ticker tape ---------- */}
      <TickerTape items={ticker} onSelect={pick} />

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
                WL
                <span className="text-up">
                  ·{String(watchlist.length).padStart(2, "0")}
                </span>
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
                      data.regularMarketTime * 1000,
                    ).toLocaleString("en-IN", {
                      timeZone: "Asia/Kolkata",
                    })} IST`}
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
                ) : loading ? (
                  <span
                    aria-hidden
                    className="inline-block h-[0.9em] w-[5.5em] animate-pulse bg-panel-2 align-baseline"
                  />
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
                  <span className="text-up">[!]</span> {error.toUpperCase()}
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
          <ChartPanel
            data={data}
            range={range}
            onRange={changeRange}
            loading={busy}
          />

          <footer className="flex items-center justify-between font-mono text-[10px] tracking-[0.2em] text-faint">
            <span>RANGE 1–8 · R RETRY · J/K STEP · L LOG · / SEARCH</span>
            <span className="hidden sm:block">
              NIFTY//TERM · {new Date().getFullYear()}
            </span>
          </footer>
        </section>
      </main>

      {/* ---------- keyboard help modal ---------- */}
      <Modal
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        label="Keyboard shortcuts"
      >
        <div className="mb-5 flex items-center justify-between">
          <span className="font-mono text-[10px] tracking-[0.3em] text-faint">
            NIFTY//TERM <span className="text-up">?</span> HELP
          </span>
          <button
            onClick={() => setHelpOpen(false)}
            aria-label="Close help"
            className="px-2 py-1 font-mono text-[12px] text-faint transition-colors duration-100 hover:text-paper"
          >
            ✕
          </button>
        </div>
        <ul className="flex flex-col gap-2.5 font-mono text-[12px] tracking-wider">
          {[
            ["/", "focus symbol search"],
            ["1–8", "switch timeframe"],
            ["J / K", "step watchlist"],
            ["R", "retry data"],
            ["L", "log / linear scale"],
            ["?", "toggle this panel"],
            ["ESC", "close panel / sheet"],
            ["TAPE", "click a ticker to open"],
          ].map(([k, label]) => (
            <li key={k} className="flex items-center justify-between gap-4">
              <span className="text-muted">{label}</span>
              <kbd className="border border-hairline-strong bg-panel px-2 py-0.5 text-[11px] text-paper">
                {k}
              </kbd>
            </li>
          ))}
        </ul>
        <p className="mt-5 border-t border-hairline pt-3 font-mono text-[9px] leading-relaxed tracking-widest text-faint">
          CROSSHAIR OVER CHART FOR OHLC ·
          <br />
          ALL DATA LIVE FROM NSE · BSE
        </p>
      </Modal>

      {/* ---------- mobile watchlist sheet ---------- */}
      <Modal
        open={wlOpen}
        onClose={() => setWlOpen(false)}
        label="Watchlist"
        sheet
        panelClassName="lg:hidden"
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
          bare
        />
      </Modal>
    </div>
  );
}
