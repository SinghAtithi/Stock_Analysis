"use client";

/* TASK-1418 — /compare?a=&b= — two symbols side by side: quote cards,
   direction-aware fundamentals diff, % since start chart overlay, and
   strategy score columns. URL params a=/b=/r= deep-link and sync via
   pushState (mirrors the home page's ?s=&e=&r= pattern); both slots default
   to RELIANCE vs TCS on a bare visit. */

import { useCallback, useEffect, useRef, useState } from "react";
import SiteHeader from "@/components/SiteHeader";
import Search from "@/components/Search";
import Overlay from "./Overlay";
import FundamentalsTable, { type FundSide } from "./FundamentalsTable";
import StrategyScores from "./StrategyScores";
import {
  chartUrl,
  resolveSlot,
  toSlot,
  type CompareSlot,
  type FundPayload,
} from "@/lib/compare";
import { RANGES, type ChartData, type RangeKey, type SearchResult } from "@/lib/types";

const DEFAULT_A: CompareSlot = {
  symbol: "RELIANCE",
  name: "Reliance Industries",
  shortName: "RELIANCE",
  exchange: "NSE",
  type: "Equity",
  sector: "Energy Minerals",
};

const DEFAULT_B: CompareSlot = {
  symbol: "TCS",
  name: "Tata Consultancy Services",
  shortName: "TCS",
  exchange: "NSE",
  type: "Equity",
  sector: "Technology Services",
};

const loadChart = async (slot: CompareSlot, rangeKey: RangeKey): Promise<ChartData> => {
  const res = await fetch(chartUrl(slot, rangeKey));
  const json = (await res.json()) as ChartData & { error?: string };
  if (!res.ok || !Array.isArray(json.candles)) {
    throw new Error(
      json.error === "not_found"
        ? "Symbol not found"
        : json.error === "index_unavailable"
          ? "Index data unavailable — upstream throttled"
          : json.error === "rate_limited"
            ? "Upstream rate limited — try again shortly"
            : json.error ?? "Data unavailable",
    );
  }
  return json;
};

const fetchFundamentals = async (symbol: string): Promise<FundPayload> => {
  const res = await fetch(`/api/fundamentals?symbol=${encodeURIComponent(symbol)}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as FundPayload;
};

export default function ComparePage() {
  const [slotA, setSlotA] = useState<CompareSlot | null>(null);
  const [slotB, setSlotB] = useState<CompareSlot | null>(null);
  const [missA, setMissA] = useState<string | null>(null);
  const [missB, setMissB] = useState<string | null>(null);
  const [range, setRange] = useState<RangeKey>("1y");

  const [dataA, setDataA] = useState<ChartData | null>(null);
  const [dataB, setDataB] = useState<ChartData | null>(null);
  const [loadingA, setLoadingA] = useState(true);
  const [loadingB, setLoadingB] = useState(true);
  const [errA, setErrA] = useState<string | null>(null);
  const [errB, setErrB] = useState<string | null>(null);
  const [fundA, setFundA] = useState<FundPayload | null>(null);
  const [fundB, setFundB] = useState<FundPayload | null>(null);
  const [fundFailA, setFundFailA] = useState(false);
  const [fundFailB, setFundFailB] = useState(false);

  const reqA = useRef(0);
  const reqB = useRef(0);

  /* ---- chart loads (bounded retry, reqId guards a newer request) ------ */

  const loadA = useCallback(async (slot: CompareSlot, rangeKey: RangeKey) => {
    const id = ++reqA.current;
    setLoadingA(true);
    setErrA(null);
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const json = await loadChart(slot, rangeKey);
        if (id !== reqA.current) return;
        setDataA(json);
        setLoadingA(false);
        return;
      } catch (e) {
        if (id !== reqA.current) return;
        setErrA(e instanceof Error ? e.message : "Network error");
        if (attempt < 3) {
          await new Promise((r) => window.setTimeout(r, 1200 * attempt));
          if (id !== reqA.current) return;
        }
      }
    }
    setLoadingA(false);
  }, []);

  const loadB = useCallback(async (slot: CompareSlot, rangeKey: RangeKey) => {
    const id = ++reqB.current;
    setLoadingB(true);
    setErrB(null);
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const json = await loadChart(slot, rangeKey);
        if (id !== reqB.current) return;
        setDataB(json);
        setLoadingB(false);
        return;
      } catch (e) {
        if (id !== reqB.current) return;
        setErrB(e instanceof Error ? e.message : "Network error");
        if (attempt < 3) {
          await new Promise((r) => window.setTimeout(r, 1200 * attempt));
          if (id !== reqB.current) return;
        }
      }
    }
    setLoadingB(false);
  }, []);

  useEffect(() => {
    if (!slotA) return;
    void (async () => {
      await loadA(slotA, range);
    })();
  }, [slotA, range, loadA]);

  useEffect(() => {
    if (!slotB) return;
    void (async () => {
      await loadB(slotB, range);
    })();
  }, [slotB, range, loadB]);

  /* ---- fundamentals (quiet, no retry — panel shows honest states) ------ */

  useEffect(() => {
    if (!slotA) return;
    let cancelled = false;
    fetchFundamentals(slotA.symbol)
      .then((p) => {
        if (!cancelled) setFundA(p);
      })
      .catch(() => {
        if (!cancelled) setFundFailA(true);
      });
    return () => {
      cancelled = true;
    };
  }, [slotA]);

  useEffect(() => {
    if (!slotB) return;
    let cancelled = false;
    fetchFundamentals(slotB.symbol)
      .then((p) => {
        if (!cancelled) setFundB(p);
      })
      .catch(() => {
        if (!cancelled) setFundFailB(true);
      });
    return () => {
      cancelled = true;
    };
  }, [slotB]);

  /* ---- URL deep-link bootstrap + pushState sync (home page pattern) ---- */

  const applyParams = useCallback(async (params: URLSearchParams) => {
    const rawA = params.get("a");
    const rawB = params.get("b");
    const resolvedA = await resolveSlot(rawA);
    const resolvedB = await resolveSlot(rawB);
    setSlotA(resolvedA ?? null);
    setSlotB(resolvedB ?? null);
    setMissA(rawA && !resolvedA ? rawA.toUpperCase() : null);
    setMissB(rawB && !resolvedB ? rawB.toUpperCase() : null);
    setFundA(null);
    setFundB(null);
    setFundFailA(false);
    setFundFailB(false);
    const rangeParam = params.get("r") as RangeKey | null;
    setRange(
      rangeParam && RANGES.some((x) => x.range === rangeParam) ? rangeParam : "1y",
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const params = new URLSearchParams(location.search);
      const has = params.has("a") || params.has("b");
      if (has) {
        await applyParams(params);
        if (cancelled) return;
      } else {
        /* bare visit: the canonical pair, no URL rewrite needed */
        setSlotA(DEFAULT_A);
        setSlotB(DEFAULT_B);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyParams]);

  const urlInited = useRef(false);
  useEffect(() => {
    if (!urlInited.current) {
      urlInited.current = true;
      return;
    }
    const q = new URLSearchParams();
    const aParam = slotA?.symbol ?? missA;
    const bParam = slotB?.symbol ?? missB;
    if (aParam) q.set("a", aParam);
    if (bParam) q.set("b", bParam);
    q.set("r", range);
    history.pushState(null, "", `/compare?${q}`);
  }, [slotA, slotB, missA, missB, range]);

  useEffect(() => {
    const onPop = () => {
      void applyParams(new URLSearchParams(location.search));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [applyParams]);

  useEffect(() => {
    const apply = () => {
      document.title = slotA && slotB
        ? `Compare ${slotA.symbol} vs ${slotB.symbol} — NIFTY//TERM`
        : "Compare — NIFTY//TERM";
    };
    const timers = [0, 120, 400].map((d) => window.setTimeout(apply, d));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [slotA, slotB]);

  /* ---- picks ----------------------------------------------------------- */

  const pickA = (r: SearchResult) => {
    setSlotA(toSlot(r));
    setMissA(null);
    setFundA(null);
    setFundFailA(false);
  };
  const pickB = (r: SearchResult) => {
    setSlotB(toSlot(r));
    setMissB(null);
    setFundB(null);
    setFundFailB(false);
  };

  const fundSide = (slot: CompareSlot | null, payload: FundPayload | null, failed: boolean): FundSide => ({
    symbol: slot?.symbol ?? "",
    isIndex: slot?.type === "Index",
    payload,
    loading: slot !== null && payload === null && !failed,
    failed,
  });

  const bars = Math.max(
    dataA?.candles.length ?? 0,
    dataB?.candles.length ?? 0,
  );

  return (
    <div className="min-h-screen bg-canvas">
      <SiteHeader subtitle="Compare" />
      <main id="main-content" className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:px-6">
        <h1 className="text-xl font-semibold tracking-tight text-paper">
          Compare two symbols
        </h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
          Quotes, fundamentals, performance since start and strategy scores —
          side by side. Pick a symbol in either search box.
        </p>

        <section aria-label="Compare pickers" className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <p className="mb-1.5 text-xs font-medium tracking-wide text-faint">
              First symbol
            </p>
            <Search onSelect={pickA} />
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium tracking-wide text-faint">
              Second symbol
            </p>
            <Search onSelect={pickB} />
          </div>
        </section>

        <section aria-label="Quotes" className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          <QuoteCard
            slot={slotA}
            miss={missA}
            data={dataA}
            loading={loadingA}
            error={errA}
            onRetry={() => slotA && void loadA(slotA, range)}
          />
          <QuoteCard
            slot={slotB}
            miss={missB}
            data={dataB}
            loading={loadingB}
            error={errB}
            onRetry={() => slotB && void loadB(slotB, range)}
          />
        </section>

        <section aria-label="Performance since start" className="mt-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold tracking-tight text-paper">
              Performance since start
            </h2>
            <div
              role="group"
              aria-label="Overlay range"
              className="flex items-center gap-1 overflow-x-auto rounded-full bg-panel-2 p-1"
            >
              {RANGES.map((r, i) => (
                <button
                  key={r.range}
                  onClick={() => setRange(r.range)}
                  title={`Press ${i + 1}`}
                  aria-pressed={range === r.range}
                  className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    range === r.range
                      ? "bg-paper text-ink shadow-sm"
                      : "text-muted hover:text-paper"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          {slotA && slotB && (
            <Overlay
              a={{ symbol: slotA.symbol, name: slotA.name, candles: dataA?.candles ?? [] }}
              b={{ symbol: slotB.symbol, name: slotB.name, candles: dataB?.candles ?? [] }}
              bars={bars}
            />
          )}
          {(loadingA || loadingB) && !dataA && !dataB && (
            <div className="flex h-64 items-center justify-center rounded-2xl border border-line bg-surface text-sm text-faint shadow-sm">
              Loading performance…
            </div>
          )}
          {!loadingA && !loadingB && !dataA && !dataB && (errA || errB) && (
            <div className="flex h-64 items-center justify-center rounded-2xl border border-line bg-surface px-4 text-center text-sm text-muted shadow-sm">
              Performance unavailable — {errA ?? errB}
            </div>
          )}
        </section>

        <div className="mt-6 space-y-6">
          <FundamentalsTable a={fundSide(slotA, fundA, fundFailA)} b={fundSide(slotB, fundB, fundFailB)} />
          {slotA && slotB && (
            <StrategyScores
              key={`${slotA.symbol}|${slotB.symbol}`}
              symbolA={slotA.symbol}
              symbolB={slotB.symbol}
            />
          )}
        </div>
      </main>
    </div>
  );
}

function QuoteCard({
  slot,
  miss,
  data,
  loading,
  error,
  onRetry,
}: {
  slot: CompareSlot | null;
  miss: string | null;
  data: ChartData | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const price = data?.regularMarketPrice ?? null;
  const change = data?.change ?? null;
  const changePct = data?.changePct ?? null;
  const dir = change !== null && change > 0 ? "up" : change !== null && change < 0 ? "down" : "flat";

  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-5">
      {!slot && miss && (
        <>
          <p className="font-mono text-sm tabular-nums text-paper">{miss}</p>
          <p className="mt-1 text-sm text-muted">
            Symbol not found — pick another from the search above.
          </p>
        </>
      )}
      {!slot && !miss && (
        <span
          aria-hidden
          className="inline-block h-5 w-40 animate-pulse rounded bg-panel-2"
        />
      )}
      {slot && (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 className="min-w-0 truncate text-base font-semibold tracking-tight text-paper">
              {slot.name}
            </h2>
            <span className="shrink-0 rounded-full border border-line bg-surface px-2 py-0.5 font-mono text-[10px] leading-none text-faint">
              {slot.exchange} · {slot.type}
            </span>
          </div>

          {loading && (
            <div className="mt-3 space-y-2">
              <span aria-hidden className="block h-7 w-28 animate-pulse rounded bg-panel-2" />
              <span aria-hidden className="block h-4 w-20 animate-pulse rounded bg-panel-2" />
            </div>
          )}

          {!loading && error && (
            <div className="mt-3">
              <p className="text-sm text-muted">{error}</p>
              <button
                type="button"
                onClick={onRetry}
                className="mt-2 rounded-full border border-line bg-surface px-3 py-1 text-xs text-muted transition-colors hover:text-paper"
              >
                Retry
              </button>
            </div>
          )}

          {!loading && !error && data && (
            <div className="mt-3">
              <p
                className={`font-mono text-3xl font-semibold tabular-nums tracking-tight ${
                  dir === "flat" ? "text-paper" : dir === "up" ? "text-up" : "text-down"
                }`}
              >
                {price !== null ? `₹${price.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}` : "—"}
              </p>
              <p className="mt-1 font-mono text-sm tabular-nums">
                {change !== null ? `${change >= 0 ? "+" : ""}${change.toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "—"}
                <span className={`ml-1.5 ${dir === "flat" ? "text-muted" : dir === "up" ? "text-up" : "text-down"}`}>
                  {changePct !== null ? `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%` : ""}
                </span>
              </p>
              <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] tabular-nums text-faint">
                {data.stale && (
                  <span className="rounded-full border border-warn/40 bg-warn-soft px-2 py-0.5 text-[10px] text-warn">
                    STALE
                  </span>
                )}
                <span>
                  {data.candles.length} bars · {data.source.toUpperCase()} · {data.interval.toUpperCase()}
                </span>
              </p>
            </div>
          )}

          {!loading && !error && !data && (
            <p className="mt-3 text-sm text-muted">No data for this symbol.</p>
          )}
        </>
      )}
    </div>
  );
}