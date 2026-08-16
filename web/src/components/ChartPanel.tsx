"use client";

import { useEffect, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  ColorType,
  CrosshairMode,
  PriceScaleMode,
  type IChartApi,
  type ISeriesApi,
} from "lightweight-charts";
import type { ChartData, Candle, RangeKey } from "@/lib/types";
import { RANGES } from "@/lib/types";

const UP = "#c6f534";
const DOWN = "#ff5032";

interface Legend {
  t: number | null;
  o: number | null;
  h: number | null;
  l: number | null;
  c: number | null;
  v: number | null;
}

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
  const [legend, setLegend] = useState<Legend>({
    t: null,
    o: null,
    h: null,
    l: null,
    c: null,
    v: null,
  });
  const [logScale, setLogScale] = useState(false);

  /* L toggles log scale */
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
    chartRef.current?.timeScale().fitContent();
  }, [logScale]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    /* double-click re-fits the visible range (terminal convention) */
    const onDblClick = () => {
      chartRef.current?.timeScale().fitContent();
    };
    el.addEventListener("dblclick", onDblClick);

    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#8a8a84",
        fontSize: 11,
        fontFamily: "'JetBrains Mono', monospace",
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.045)" },
        horzLines: { color: "rgba(255,255,255,0.045)" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: "rgba(244,244,241,0.35)",
          width: 1,
          style: 3,
          labelBackgroundColor: "#131316",
        },
        horzLine: {
          color: "rgba(244,244,241,0.35)",
          width: 1,
          style: 3,
          labelBackgroundColor: "#131316",
        },
      },
      rightPriceScale: {
        borderColor: "rgba(255,255,255,0.09)",
      },
      timeScale: {
        borderColor: "rgba(255,255,255,0.09)",
        timeVisible: false,
        secondsVisible: false,
      },
    });

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
      borderVisible: false,
      priceLineVisible: true,
      priceLineStyle: 2,
      priceLineWidth: 1,
      priceLineColor: "rgba(244,244,241,0.22)",
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
        setLegend({
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
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volRef.current = null;
    };
  }, []);

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
    volRef.current.setData(
      data.candles.map((c: Candle) => ({
        time: c.time as never,
        value: c.volume,
        color:
          c.close >= c.open ? "rgba(198,245,52,0.22)" : "rgba(255,80,50,0.22)",
      })),
    );

    /* slim candles: adapt bar spacing to candle count so bars never blob */
    const width = containerRef.current?.clientWidth ?? 800;
    const count = Math.max(data.candles.length, 1);
    const spacing = Math.min(Math.max(width / count, 1.5), 9);

    chartRef.current.timeScale().applyOptions({
      timeVisible: isIntraday,
      secondsVisible: false,
      barSpacing: spacing,
    });
    chartRef.current.timeScale().fitContent();
    setLegend({ t: null, o: null, h: null, l: null, c: null, v: null });
  }, [data]);

  const lc =
    legend.c !== null && legend.o !== null
      ? legend.c >= legend.o
        ? "text-up"
        : "text-down"
      : "text-paper";

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {data && (
        <p className="sr-only">
          {data.symbol} chart, {data.range} range, {data.candles.length} candles
          from {data.source}. Last close{" "}
          {data.candles[data.candles.length - 1]?.close ?? "—"}.
        </p>
      )}
      <div className="mb-3 flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto pb-1">
          {RANGES.map((r, i) => (
            <button
              key={r.range}
              onClick={() => onRange(r.range as RangeKey)}
              title={`Press ${i + 1}`}
              aria-pressed={range === r.range}
              className={`relative shrink-0 px-2 py-1.5 font-mono text-[11px] tracking-widest transition-colors duration-100 sm:px-2.5 ${
                range === r.range
                  ? "text-paper after:absolute after:inset-x-2 after:-bottom-[3px] after:h-[2px] after:bg-up"
                  : "text-faint hover:text-muted"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        {data && (
          <span className="flex shrink-0 items-center gap-2 font-mono text-[10px] tracking-widest text-faint">
            <span className="hidden md:inline">
              {data.candles.length} BARS · {data.source.toUpperCase()} ·{" "}
              {data.interval.toUpperCase()}
            </span>
            <span className="md:hidden">
              {data.candles.length}B · {data.source.toUpperCase()}
            </span>
            {data.degraded === "daily" && (
              <span className="border border-hairline px-1.5 py-px text-faint">
                DAILY
              </span>
            )}
            {data.stale && (
              <span
                className="border border-hairline-strong bg-panel px-1.5 py-px text-muted"
                title="Serving cached data — upstream unavailable. Press R to retry."
              >
                STALE
              </span>
            )}
            <button
              onClick={() => setLogScale((v) => !v)}
              aria-pressed={logScale}
              title="Toggle log scale (L)"
              className={`border px-1.5 py-px transition-colors duration-100 ${
                logScale
                  ? "border-up/40 bg-up/10 text-up"
                  : "border-hairline text-faint hover:text-paper"
              }`}
            >
              {logScale ? "LOG" : "LIN"}
            </button>
            <button
              onClick={() => chartRef.current?.timeScale().fitContent()}
              title="Fit all candles (double-click)"
              className="border border-hairline px-1.5 py-px text-faint transition-colors duration-100 hover:text-paper"
            >
              FIT
            </button>
          </span>
        )}
      </div>

      <div
        id="chart"
        className="relative min-h-[320px] flex-1 overflow-hidden border border-hairline bg-panel"
      >
        <div
          ref={containerRef}
          className="absolute inset-0"
          aria-label="Price chart"
        />

        {/* crosshair OHLC legend */}
        {legend.c !== null && !loading && (
          <div className="pointer-events-none absolute left-3 top-3 flex gap-4 bg-ink/90 px-3 py-2 font-mono text-[11px] tracking-wider">
            {legend.t != null && (
              <span className="hidden text-up sm:inline tabular-nums">
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
            <span className="text-muted">
              O{" "}
              <span className="text-paper tabular-nums">
                {legend.o?.toFixed(2)}
              </span>
            </span>
            <span className="text-muted">
              H{" "}
              <span className="text-paper tabular-nums">
                {legend.h?.toFixed(2)}
              </span>
            </span>
            <span className="text-muted">
              L{" "}
              <span className="text-paper tabular-nums">
                {legend.l?.toFixed(2)}
              </span>
            </span>
            <span className="text-muted">
              C{" "}
              <span className={`tabular-nums ${lc}`}>
                {legend.c?.toFixed(2)}
              </span>
            </span>
            <span className="hidden md:inline text-muted">
              V{" "}
              <span className="text-paper tabular-nums">
                {legend.v != null ? compactVol(legend.v) : "—"}
              </span>
            </span>
          </div>
        )}

        {/* reveal sweep on data change */}
        <div
          key={`${data?.symbol}-${data?.range}`}
          className="pointer-events-none absolute inset-0 z-10 bg-ink chart-reveal"
        />

        {/* CRT scanlines */}
        <div className="scanlines absolute inset-0 z-[5]" />

        {loading && (
          <div
            className="absolute inset-0 z-20 flex flex-col bg-ink/60"
            aria-live="polite"
          >
            {/* skeleton bars — deterministic pseudo-random heights */}
            <div className="absolute inset-x-0 bottom-0 top-[20%] flex items-end gap-[3px] px-4 pb-2">
              {Array.from({ length: 34 }, (_, i) => {
                const h =
                  0.35 +
                  ((0.55 * Math.abs(Math.sin(i * 12.9898 + 7.7) * 43758.5453)) %
                    1);
                return (
                  <span
                    key={i}
                    className="flex-1 bg-panel-2 animate-pulse"
                    style={{
                      height: `${Math.round(h * 100)}%`,
                      animationDelay: `${(i % 10) * 90}ms`,
                    }}
                  />
                );
              })}
            </div>
            <span className="mx-auto mt-6 font-mono text-[12px] tracking-[0.3em] text-muted">
              &gt; LOADING<span className="cursor-blink text-up">_</span>
            </span>
          </div>
        )}
        {!data && !loading && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3">
            <p className="font-mono text-[12px] tracking-[0.25em] text-faint">
              &gt; ENTER SYMBOL TO BEGIN<span className="cursor-blink">_</span>
            </p>
            <p className="font-mono text-[10px] tracking-[0.25em] text-faint">
              PRESS{" "}
              <kbd className="border border-hairline px-1.5 py-0.5 text-paper">
                /
              </kbd>{" "}
              TO SEARCH
            </p>
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
