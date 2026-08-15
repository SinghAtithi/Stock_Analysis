"use client";

import { useEffect, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
} from "lightweight-charts";
import type { ChartData, Candle, RangeKey } from "@/lib/types";
import { RANGES } from "@/lib/types";

const UP = "#c6f534";
const DOWN = "#ff5032";

interface Legend {
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
    o: null,
    h: null,
    l: null,
    c: null,
    v: null,
  });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#6f6f6a",
        fontSize: 11,
        fontFamily: "'JetBrains Mono', monospace",
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.045)" },
        horzLines: { color: "rgba(255,255,255,0.045)" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "rgba(244,244,241,0.35)", width: 1, style: 3, labelBackgroundColor: "#131316" },
        horzLine: { color: "rgba(244,244,241,0.35)", width: 1, style: 3, labelBackgroundColor: "#131316" },
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
        | { open: number; high: number; low: number; close: number; volume?: number }
        | undefined;
      if (d) {
        setLegend({
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
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!data || !chartRef.current || !candleRef.current || !volRef.current) return;
    const isIntraday = data.interval.endsWith("m") || data.interval.endsWith("h");

    candleRef.current.setData(
      data.candles.map((c: Candle) => ({
        time: c.time as never,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }))
    );
    volRef.current.setData(
      data.candles.map((c: Candle) => ({
        time: c.time as never,
        value: c.volume,
        color:
          c.close >= c.open ? "rgba(198,245,52,0.22)" : "rgba(255,80,50,0.22)",
      }))
    );

    chartRef.current.timeScale().applyOptions({
      timeVisible: isIntraday,
      secondsVisible: false,
    });
    chartRef.current.timeScale().fitContent();
    setLegend({ o: null, h: null, l: null, c: null, v: null });
  }, [data]);

  const lc = legend.c !== null && legend.o !== null ? (legend.c >= legend.o ? "text-up" : "text-down") : "text-paper";

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-1">
          {RANGES.map((r, i) => (
            <button
              key={r.range}
              onClick={() => onRange(r.range as RangeKey)}
              title={`Press ${i + 1}`}
              className={`relative px-2.5 py-1.5 font-mono text-[11px] tracking-widest transition-colors duration-100 ${
                range === r.range
                  ? "text-paper after:absolute after:inset-x-2 after:-bottom-[3px] after:h-[2px] after:bg-up"
                  : "text-faint hover:text-muted"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <span className="hidden sm:block font-mono text-[10px] tracking-widest text-faint">
          {data ? `${data.source.toUpperCase()} · ${data.interval}` : ""}
        </span>
      </div>

      <div className="relative min-h-[320px] flex-1 overflow-hidden border border-hairline bg-panel">
        <div ref={containerRef} className="absolute inset-0" />

        {/* crosshair OHLC legend */}
        {legend.c !== null && (
          <div className="pointer-events-none absolute left-3 top-3 flex gap-4 bg-ink/85 px-3 py-2 font-mono text-[11px] tracking-wider backdrop-blur-sm">
            <span className="text-muted">O <span className="text-paper tabular-nums">{legend.o?.toFixed(2)}</span></span>
            <span className="text-muted">H <span className="text-paper tabular-nums">{legend.h?.toFixed(2)}</span></span>
            <span className="text-muted">L <span className="text-paper tabular-nums">{legend.l?.toFixed(2)}</span></span>
            <span className="text-muted">C <span className={`tabular-nums ${lc}`}>{legend.c?.toFixed(2)}</span></span>
            <span className="hidden md:inline text-muted">V <span className="text-paper tabular-nums">{legend.v != null ? compactVol(legend.v) : "—"}</span></span>
          </div>
        )}

        {/* reveal sweep on data change */}
        <div key={`${data?.symbol}-${data?.range}`} className="pointer-events-none absolute inset-0 z-10 bg-ink chart-reveal" />

        {/* CRT scanlines */}
        <div className="scanlines absolute inset-0 z-[5]" />

        {loading && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-ink/60">
            <span className="font-mono text-[12px] tracking-[0.3em] text-muted animate-dot-pulse">
              LOADING
            </span>
          </div>
        )}
        {!data && !loading && (
          <div className="absolute inset-0 z-20 flex items-center justify-center">
            <p className="font-mono text-[12px] tracking-[0.25em] text-faint">
              &gt; ENTER SYMBOL TO BEGIN<span className="cursor-blink">_</span>
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
