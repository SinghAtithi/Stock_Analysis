"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Search from "@/components/Search";
import ChartPanel from "@/components/ChartPanel";
import StatsRail from "@/components/StatsRail";
import TickerTape from "@/components/TickerTape";
import Odometer from "@/components/Odometer";
import type { ChartData, SearchResult, RangeKey, TickerItem } from "@/lib/types";
import { RANGES } from "@/lib/types";

const QUICK_PICKS: SearchResult[] = [
  { symbol: "RELIANCE", name: "Reliance Industries", shortName: "RELIANCE", exchange: "NSE", type: "Equity", sector: "" },
  { symbol: "TCS", name: "Tata Consultancy Services", shortName: "TCS", exchange: "NSE", type: "Equity", sector: "" },
  { symbol: "HDFCBANK", name: "HDFC Bank", shortName: "HDFCBANK", exchange: "NSE", type: "Equity", sector: "" },
  { symbol: "INFY", name: "Infosys", shortName: "INFY", exchange: "NSE", type: "Equity", sector: "" },
  { symbol: "TATAMOTORS", name: "Tata Motors", shortName: "TATAMOTORS", exchange: "NSE", type: "Equity", sector: "" },
  { symbol: "NIFTY 50", name: "NIFTY 50", shortName: "NIFTY 50", exchange: "NSE", type: "Index", sector: "" },
  { symbol: "SENSEX", name: "S&P BSE Sensex", shortName: "SENSEX", exchange: "BSE", type: "Index", sector: "" },
];

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

export default function Home() {
  const [selected, setSelected] = useState<SearchResult | null>(QUICK_PICKS[0]);
  const [data, setData] = useState<ChartData | null>(null);
  const [range, setRange] = useState<RangeKey>("1y");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ticker, setTicker] = useState<TickerItem[]>([]);
  const reqId = useRef(0);
  const clock = useISTClock();

  const load = useCallback(
    async (r: { symbol: string; exchange: string; type: string }, rangeKey: RangeKey) => {
      const cfg = RANGES.find((x) => x.range === rangeKey) ?? RANGES[5];
      const id = ++reqId.current;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/chart?symbol=${encodeURIComponent(r.symbol)}&exchange=${encodeURIComponent(
            r.exchange
          )}&type=${encodeURIComponent(r.type)}&range=${cfg.range}&interval=${cfg.interval}`
        );
        const json = await res.json();
        if (id !== reqId.current) return;
        if (!res.ok || json.error) {
          setError(
            json.error === "not_found"
              ? "symbol not found"
              : json.error ?? "upstream failure"
          );
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

  /* initial load */
  useEffect(() => {
    let cancelled = false;
    const cfg = RANGES[5];
    (async () => {
      try {
        const res = await fetch(
          `/api/chart?symbol=${encodeURIComponent(
            QUICK_PICKS[0].symbol
          )}&exchange=${QUICK_PICKS[0].exchange}&type=${QUICK_PICKS[0].type}&range=${cfg.range}&interval=${cfg.interval}`
        );
        const json = await res.json();
        if (!cancelled) {
          setData(res.ok && !json.error ? json : null);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
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
  }, []);

  /* number keys switch ranges */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName ?? "").toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      const n = Number(e.key);
      if (n >= 1 && n <= RANGES.length) {
        setRange(RANGES[n - 1].range);
        if (selected) load(selected, RANGES[n - 1].range);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, load]);

  const pick = (r: SearchResult) => {
    setSelected(r);
    setRange("1y");
    load(r, "1y");
  };

  const changeRange = (r: RangeKey) => {
    setRange(r);
    if (selected) load(selected, r);
  };

  const up = (data?.change ?? 0) >= 0;

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
          {ticker.length >= 2 && (
            <span className="hidden md:flex items-center gap-4">
              {ticker.slice(0, 2).map((t) => (
                <span key={t.symbol} className="flex items-center gap-2">
                  <span className="text-faint">{t.symbol}</span>
                  <span className="tabular-nums text-paper">
                    {t.price?.toLocaleString("en-IN", { maximumFractionDigits: 1 })}
                  </span>
                  <span className={`tabular-nums ${(t.changePct ?? 0) >= 0 ? "text-up" : "text-down"}`}>
                    {(t.changePct ?? 0) >= 0 ? "+" : ""}
                    {t.changePct?.toFixed(2)}%
                  </span>
                </span>
              ))}
            </span>
          )}
          <span className="tabular-nums text-faint">{clock ? `${clock} IST` : "—:—:— IST"}</span>
          <span className="flex items-center gap-2 text-paper">
            <span className="h-1.5 w-1.5 rounded-full bg-up animate-dot-pulse" />
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
          <p className="mt-6 mb-2 px-1 font-mono text-[9px] tracking-[0.3em] text-faint">
            WATCHLIST
          </p>
          <ul className="flex flex-col">
            {QUICK_PICKS.map((q) => (
              <li key={q.symbol}>
                <button
                  onClick={() => pick(q)}
                  className={`group flex w-full items-center justify-between px-2 py-2 font-mono text-[12px] transition-colors duration-100 ${
                    selected?.symbol === q.symbol
                      ? "bg-up text-ink"
                      : "text-muted hover:bg-panel hover:text-paper"
                  }`}
                >
                  <span className="tracking-wider">{q.symbol}</span>
                  <span
                    className={`text-[9px] tracking-[0.2em] ${
                      selected?.symbol === q.symbol
                        ? "text-ink/60"
                        : "text-faint group-hover:text-muted"
                    }`}
                  >
                    {q.type === "Index" ? "IDX" : q.exchange}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-auto pt-8">
            <p className="font-mono text-[9px] leading-relaxed tracking-wider text-faint">
              DATA · YAHOO FINANCE / NSE / BSE
              <br />
              KEYS · 1–8 RANGE · / SEARCH
              <br />
              NOT INVESTMENT ADVICE
            </p>
          </div>
        </aside>

        {/* main */}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-5 p-4 sm:p-6 lg:p-8">
          <div className="lg:hidden">
            <Search onSelect={pick} />
          </div>

          {/* name + price */}
          <div className="animate-fade-up">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
              <h1 className="font-display text-[28px] font-extrabold uppercase leading-none tracking-tight text-paper sm:text-[36px]">
                {selected?.name}
              </h1>
              <div className="flex items-center gap-2 font-mono text-[10px] tracking-widest">
                <span className="border border-hairline-strong bg-panel px-2 py-1 text-muted">
                  {selected?.symbol}
                </span>
                <span className="border border-hairline px-2 py-1 text-faint">
                  {selected?.exchange}
                </span>
                <span className="border border-hairline px-2 py-1 text-faint">
                  {data?.currency ?? "INR"}
                </span>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-end gap-x-5 gap-y-2">
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
                <span className="mb-2 font-mono text-[11px] tracking-widest text-down">
                  ⚠ {error.toUpperCase()}
                </span>
              )}
            </div>
          </div>

          {/* stats strip */}
          {data && <StatsRail data={data} />}

          {/* chart */}
          <ChartPanel data={data} range={range} onRange={changeRange} loading={loading} />

          <footer className="flex items-center justify-between font-mono text-[9px] tracking-[0.2em] text-faint">
            <span>RANGE KEYS 1–8 · CROSSHAIR FOR OHLC</span>
            <span>NIFTY//TERM · {new Date().getFullYear()}</span>
          </footer>
        </section>
      </main>
    </div>
  );
}
