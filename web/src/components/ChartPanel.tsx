"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  createSeriesMarkers,
  CandlestickSeries,
  HistogramSeries,
  ColorType,
  CrosshairMode,
  PriceScaleMode,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type Time,
} from "lightweight-charts";
import type { ChartData, Candle, RangeKey } from "@/lib/types";
import { RANGES } from "@/lib/types";
import {
  actionsInWindow,
  fetchCorporateActions,
  toMarkers,
  type NormalizedAction,
} from "@/lib/corporateActions";

const UP_LIGHT = "#0e7a3a";
const UP_DARK = "#8ec9a8";
const DOWN_LIGHT = "#c4362b";
const DOWN_DARK = "#e8a09a";

const BAR_SPACING = 4;

function isDarkMode(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains("dark");
}

interface Legend {
  t: number | null;
  o: number | null;
  h: number | null;
  l: number | null;
  c: number | null;
  v: number | null;
}

const EMPTY_LEGEND: Legend = {
  t: null,
  o: null,
  h: null,
  l: null,
  c: null,
  v: null,
};

export default function ChartPanel({
  data,
  range,
  onRange,
  loading,
}: {
  data: ChartData | null;
  range: RangeKey;
  onRange: (r: RangeKey) => void;
  loading: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const [legend, setLegend] = useState<Legend>(EMPTY_LEGEND);
  const [logScale, setLogScale] = useState(false);
  const [actions, setActions] = useState<NormalizedAction[]>([]);
  const [actionsFor, setActionsFor] = useState<string | null>(null);

  const pendingLegend = useRef<Legend | null>(null);
  const legendRaf = useRef<number | null>(null);
  const queueLegend = useCallback((next: Legend) => {
    pendingLegend.current = next;
    if (legendRaf.current !== null) return;
    legendRaf.current = requestAnimationFrame(() => {
      legendRaf.current = null;
      const v = pendingLegend.current;
      pendingLegend.current = null;
      if (v) setLegend(v);
    });
  }, []);
  const cancelPendingLegend = useCallback(() => {
    if (legendRaf.current !== null) {
      cancelAnimationFrame(legendRaf.current);
      legendRaf.current = null;
    }
    pendingLegend.current = null;
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName ?? "").toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      if (e.key === "l" || e.key === "L") setLogScale((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const scale = chartRef.current?.priceScale("right");
    if (!scale) return;
    scale.applyOptions({
      mode: logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
    });
  }, [logScale]);

  /* TASK-360: corporate-action history for the current symbol. Best-effort —
     unknown symbols / failures resolve to [] and the chart stays clean.
     No symbol ⇒ no chart, and the actionsFor guard below keeps stale
     actions off a different symbol's canvas, so no reset state is needed. */
  useEffect(() => {
    const symbol = data?.symbol;
    if (!symbol) return;
    const ctrl = new AbortController();
    fetchCorporateActions(symbol, ctrl.signal).then((items) => {
      setActions(items);
      setActionsFor(symbol);
    });
    return () => ctrl.abort();
  }, [data?.symbol]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onDblClick = () => {
      chartRef.current?.timeScale().fitContent();
    };
    el.addEventListener("dblclick", onDblClick);

    /* TASK-82: touch equivalent of dblclick — two quick single-finger taps
       re-fit. Drag/pinch movements disqualify a tap so pinch-zoom never
       triggers it. fitContent() is instant, so reduced-motion is respected
       by construction. */
    let lastTapAt = 0;
    let lastTapX = 0;
    let lastTapY = 0;
    let startX = 0;
    let startY = 0;
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        lastTapAt = 0;
        return;
      }
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.changedTouches.length !== 1 || e.touches.length > 0) return;
      const t = e.changedTouches[0];
      if (Math.hypot(t.clientX - startX, t.clientY - startY) > 10) {
        lastTapAt = 0;
        return;
      }
      const now = performance.now();
      if (
        now - lastTapAt < 320 &&
        Math.hypot(t.clientX - lastTapX, t.clientY - lastTapY) < 28
      ) {
        chartRef.current?.timeScale().fitContent();
        lastTapAt = 0;
        return;
      }
      lastTapAt = now;
      lastTapX = t.clientX;
      lastTapY = t.clientY;
    };
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true });

    const dark = isDarkMode();
    /* TASK-193: read theme colors from the CSS tokens so a token edit flows
       into the chart; the fallbacks are the current token values verbatim */
    const token = (name: string, fallback: string): string =>
      getComputedStyle(document.documentElement).getPropertyValue(name).trim() ||
      fallback;
    const bg = token("--color-surface", dark ? "#141518" : "#ffffff");
    const text = token("--color-muted", dark ? "#858b91" : "#6b7280");
    const gridLine = dark ? "rgba(255,255,255,0.06)" : "rgba(17,18,20,0.06)";
    const cross = dark ? "rgba(236,235,232,0.14)" : "rgba(17,18,20,0.18)";
    const border = dark ? "rgba(255,255,255,0.07)" : "rgba(17,18,20,0.08)";
    const up = token("--color-up", dark ? UP_DARK : UP_LIGHT);
    const down = token("--color-down", dark ? DOWN_DARK : DOWN_LIGHT);

    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: bg },
        textColor: text,
        fontSize: 11,
        fontFamily: "'Inter', system-ui, sans-serif",
      },
      grid: {
        vertLines: { color: gridLine },
        horzLines: { color: gridLine },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: cross,
          width: 1,
          style: 2,
          labelBackgroundColor: dark ? "#25272b" : "#111214",
        },
        horzLine: {
          color: cross,
          width: 1,
          style: 2,
          labelBackgroundColor: dark ? "#25272b" : "#111214",
        },
      },
      rightPriceScale: {
        borderColor: border,
      },
      timeScale: {
        borderColor: border,
        timeVisible: false,
        secondsVisible: false,
      },
    });

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: up,
      downColor: down,
      wickUpColor: up,
      wickDownColor: down,
      borderVisible: false,
      priceLineVisible: true,
      priceLineStyle: 2,
      priceLineWidth: 1,
      priceLineColor: "rgba(17,18,20,0.22)",
      lastValueVisible: true,
      priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    });
    const vol = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
    });
    chart.priceScale("vol").applyOptions({
      scaleMargins: { top: 0.86, bottom: 0 },
    });

    /* TASK-360: markers for dividends/splits/bonuses; fed by the sync effect */
    markersRef.current = createSeriesMarkers(candles, []);

    chart.subscribeCrosshairMove((param) => {
      const d = param.seriesData.get(candles) as
        | {
            open: number;
            high: number;
            low: number;
            close: number;
            volume?: number;
          }
        | undefined;
      if (d) {
        queueLegend({
          t: param.time as number | null,
          o: d.open,
          h: d.high,
          l: d.low,
          c: d.close,
          v: d.volume ?? null,
        });
      }
    });
    chartRef.current = chart;
    candleRef.current = candles;
    volRef.current = vol;

    return () => {
      el.removeEventListener("dblclick", onDblClick);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchend", onTouchEnd);
      cancelPendingLegend();
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volRef.current = null;
      markersRef.current = null;
    };
  }, [queueLegend, cancelPendingLegend]);

/* TASK-360: snap corporate actions to the visible candle window (pure
     derivation — ex-date epochs are IST-midnight while candle epochs are
     UTC-midnight, so exact matches never line up; snap within snapDays). */
  const inViewActions = useMemo(() => {
    if (!data) return [] as NormalizedAction[];
    if (actionsFor !== data.symbol) return [] as NormalizedAction[];
    const iv = data.interval;
    const snapDays =
      iv.endsWith("m") || iv.endsWith("h")
        ? 0
        : iv === "1wk"
          ? 12
          : iv === "1mo"
            ? 28
            : 5;
    return actionsInWindow(actions, data.candles, snapDays);
  }, [data, actions, actionsFor]);

  /* apply the derived markers to the canvas (external system) */
  useEffect(() => {
    if (!data || !markersRef.current) return;
    const warn =
      getComputedStyle(document.documentElement)
        .getPropertyValue("--color-warn")
        .trim() || (isDarkMode() ? "#fbbf24" : "#92400e");
    markersRef.current.setMarkers(
      toMarkers(inViewActions, warn) as never,
    );
  }, [data, inViewActions]);

  useEffect(() => {
    if (!data || !chartRef.current || !candleRef.current || !volRef.current)
      return;
    const isIntraday =
      data.interval.endsWith("m") || data.interval.endsWith("h");

    candleRef.current.setData(
      data.candles.map((c: Candle) => ({
        time: c.time as never,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );
    const darkVol = isDarkMode();
    volRef.current.setData(
      data.candles.map((c: Candle) => ({
        time: c.time as never,
        value: c.volume,
        color: c.close >= c.open
          ? darkVol
            ? "rgba(142,201,168,0.18)"
            : "rgba(14,122,58,0.14)"
          : darkVol
            ? "rgba(232,160,154,0.18)"
            : "rgba(196,54,43,0.14)",
      })),
    );

    chartRef.current.timeScale().applyOptions({
      timeVisible: isIntraday,
      secondsVisible: false,
      barSpacing: BAR_SPACING,
      rightOffset: 2,
    });
    cancelPendingLegend();
    setLegend(EMPTY_LEGEND);
  }, [data, cancelPendingLegend]);

  const lc =
    legend.c !== null && legend.o !== null
      ? legend.c >= legend.o
        ? "text-up"
        : "text-down"
      : "text-paper";

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-line bg-surface p-3 shadow-sm sm:p-4">
      {data && (
        <p className="sr-only">
          {data.symbol} chart, {data.range} range, {data.candles.length} candles
          from {data.source}. Last close{" "}
          {data.candles[data.candles.length - 1]?.close ?? "—"}.
        </p>
      )}
      {inViewActions.length > 0 && (
        <p className="sr-only">
          {inViewActions.length} price-adjusted corporate action
          {inViewActions.length === 1 ? "" : "s"} on this chart:{" "}
          {inViewActions
            .map(
              (a) =>
                `${new Date(a.ts * 1000).toISOString().slice(0, 10)} ${a.plain}`,
            )
            .join("; ")}.
        </p>
      )}
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto rounded-full bg-panel-2 p-1">
          {RANGES.map((r, i) => (
            <button
              key={r.range}
              onClick={() => onRange(r.range as RangeKey)}
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
        {data && (
          <span className="flex shrink-0 items-center gap-1.5">
            <span className="hidden rounded-full border border-line bg-surface px-2.5 py-1 font-mono text-[11px] text-muted md:inline">
              {data.candles.length} bars · {data.source.toUpperCase()} · {data.interval.toUpperCase()}
            </span>
            <span className="rounded-full border border-line bg-surface px-2.5 py-1 font-mono text-[11px] text-muted md:hidden">
              {data.candles.length} · {data.source.toUpperCase()}
            </span>
            <button
              onClick={() => setLogScale((v) => !v)}
              aria-pressed={logScale}
              title="Toggle log scale (L)"
              className={`rounded-full border px-2.5 py-1 font-mono text-[11px] font-medium transition-colors ${logScale ? "border-paper bg-paper text-ink" : "border-line bg-surface text-muted hover:text-paper"}`}
            >
              {logScale ? "LOG" : "LIN"}
            </button>
            <button
              onClick={() => chartRef.current?.timeScale().fitContent()}
              aria-label="Fit all candles"
              title="Fit all candles"
              className="relative rounded-full border border-line bg-surface px-2.5 py-1 font-mono text-[11px] text-muted transition-colors after:absolute after:-inset-2 after:content-[''] hover:text-paper"
            >
              Fit
            </button>
          </span>
        )}
      </div>

      {/* legend bar */}
      {legend.c !== null && !loading ? (
        <div className="mb-2 flex flex-wrap items-center gap-3 rounded-xl bg-panel-2 px-3 py-2 font-mono text-xs">
          {legend.t != null && (
            <span className="hidden font-medium text-paper sm:inline tabular-nums">
              {new Date((legend.t as number) * 1000).toLocaleString("en-IN", {
                timeZone: "Asia/Kolkata",
                day: "2-digit",
                month: "short",
                ...(data?.interval.endsWith("m") ||
                data?.interval.endsWith("h")
                  ? { hour: "2-digit", minute: "2-digit" }
                  : { year: "2-digit" }),
              })}
            </span>
          )}
          <span className="text-faint">O <span className="font-medium text-paper tabular-nums">{legend.o?.toFixed(2)}</span></span>
          <span className="text-faint">H <span className="font-medium text-paper tabular-nums">{legend.h?.toFixed(2)}</span></span>
          <span className="text-faint">L <span className="font-medium text-paper tabular-nums">{legend.l?.toFixed(2)}</span></span>
          <span className="text-faint">C <span className={`font-medium tabular-nums ${lc}`}>{legend.c?.toFixed(2)}</span></span>
          <span className="hidden text-faint md:inline">V <span className="font-medium text-paper tabular-nums">{legend.v != null ? compactVol(legend.v) : "—"}</span></span>
        </div>
      ) : (
        <div className="mb-2 h-[32px]" aria-hidden />
      )}

      {/* corporate-action legend — TASK-360: plain-English annotation for
          the amber markers; square = dividend, circle = split or bonus */}
      {inViewActions.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <span
            className="flex items-center gap-1.5 rounded-lg border border-line bg-panel-2 px-2.5 py-1 text-[11px] font-medium text-muted"
            title="Square marker = dividend · circle marker = split or bonus"
          >
            <span
              aria-hidden
              className="h-2 w-2 shrink-0 rounded-sm"
              style={{ backgroundColor: "var(--color-warn)" }}
            />
            Price-adjusted events — a drop here is not a crash
          </span>
          {inViewActions.map((a) => (
            <span
              key={`${a.ts}-${a.kind}`}
              title={a.subject ?? undefined}
              className="flex items-center gap-1.5 rounded-lg border border-line bg-panel-2 px-2.5 py-1 text-[11px] text-muted"
            >
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-sm"
                style={{ backgroundColor: "var(--color-warn)" }}
              />
              <span className="font-mono tabular-nums">
                {new Date(a.ts * 1000).toLocaleDateString("en-IN", {
                  day: "2-digit",
                  month: "short",
                  year: "2-digit",
                })}
              </span>
              <span className="text-paper">{a.plain}</span>
            </span>
          ))}
        </div>
      )}

      <div
        id="chart"
        tabIndex={-1}
        className="relative min-h-[320px] flex-1 overflow-hidden rounded-xl border border-line bg-surface"
      >
        <div
          ref={containerRef}
          className="absolute inset-0"
          aria-label="Price chart"
        />

        {loading && (
          <div
            className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-surface/70 backdrop-blur-[1px]"
            aria-live="polite"
          >
            <div className="flex items-end gap-[3px] px-6">
              {Array.from({ length: 24 }, (_, i) => {
                const h =
                  0.35 +
                  ((0.55 * Math.abs(Math.sin(i * 12.9898 + 7.7) * 43758.5453)) %
                    1);
                return (
                  <span
                    key={i}
                    className="w-2 rounded-full bg-panel-2 animate-pulse"
                    style={{
                      height: `${Math.round(h * 80)}px`,
                      animationDelay: `${(i % 10) * 60}ms`,
                    }}
                  />
                );
              })}
            </div>
            <span className="text-xs font-medium text-muted">Loading chart…</span>
          </div>
        )}
        {!data && !loading && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 p-6 text-center">
            <p className="text-sm font-medium text-paper">Search a symbol to start</p>
            <p className="text-xs text-muted">Press <kbd className="rounded border border-line bg-panel-2 px-1.5 py-0.5 font-mono text-[11px]">/</kbd> to search NSE & BSE</p>
          </div>
        )}
      </div>
    </div>
  );
}

function compactVol(v: number): string {
  if (v >= 1e7) return `${(v / 1e7).toFixed(1)}Cr`;
  if (v >= 1e5) return `${(v / 1e5).toFixed(1)}L`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return String(v);
}
