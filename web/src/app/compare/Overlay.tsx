"use client";

import type { Candle } from "@/lib/types";

/* TASK-1418 — dependency-free SVG overlay for /compare: both series
   normalized to % since range start (the TASK-272 compare-pill approach,
   extended beyond index-only), drawn on one grid. viewBox units are
   percentages with preserveAspectRatio="none", so lines scale to any
   container while non-scaling-stroke keeps a crisp 2px; y-axis labels are
   HTML (absolutely positioned) so text never distorts. */

export interface OverlaySeries {
  symbol: string;
  name: string;
  candles: Candle[];
}

interface Props {
  a: OverlaySeries;
  b: OverlaySeries;
  bars: number;
}

/* plot area in % of the viewBox: x from 16% (y labels) to 100%, y 6%–94% */
const PLOT_X0 = 16;
const PLOT_Y0 = 6;
const PLOT_H = 88;

const toPct = (candles: Candle[]): number[] => {
  const closes = candles.map((c) => c.close).filter((v) => Number.isFinite(v));
  const first = closes[0];
  if (closes.length < 2 || first === undefined || first === 0) return [];
  return closes.map((c) => ((c - first) / first) * 100);
};

const lastFinite = (xs: number[]): number | null => {
  for (let i = xs.length - 1; i >= 0; i -= 1) {
    if (Number.isFinite(xs[i])) return xs[i];
  }
  return null;
};

const fmtPct = (v: number): string =>
  `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

function LegendItem({
  color,
  symbol,
  pct,
}: {
  color: string;
  symbol: string;
  pct: number | null;
}) {
  return (
    <span className="flex items-center gap-1.5 text-xs">
      <span
        aria-hidden
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span className="font-medium text-paper">{symbol}</span>
      {pct !== null ? (
        <span className={`font-mono text-[11px] tabular-nums ${pct >= 0 ? "text-up" : "text-down"}`}>
          {fmtPct(pct)}
        </span>
      ) : (
        <span className="font-mono text-[11px] text-faint">no data</span>
      )}
    </span>
  );
}

export default function Overlay({ a, b, bars }: Props) {
  const pa = toPct(a.candles);
  const pb = toPct(b.candles);

  const lastA = lastFinite(pa);
  const lastB = lastFinite(pb);

  const all = [...pa, ...pb].filter((v) => Number.isFinite(v));
  if (all.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-2xl border border-line bg-surface px-4 text-sm text-muted shadow-sm">
        No chart data for this range — try a different range.
      </div>
    );
  }

  let min = Math.min(...all);
  let max = Math.max(...all);
  const pad = (max - min) * 0.08 || 1;
  min -= pad;
  max += pad;
  const span = max - min || 1;

  const x = (i: number, n: number): number =>
    PLOT_X0 + (n === 1 ? 0.5 : i / (n - 1)) * (100 - PLOT_X0);
  const y = (v: number): number => PLOT_Y0 + (1 - (v - min) / span) * PLOT_H;

  const pts = (xs: number[]): string =>
    xs
      .map((v, i) => (Number.isFinite(v) ? `${x(i, xs.length).toFixed(2)},${y(v).toFixed(2)}` : null))
      .filter((p): p is string => p !== null)
      .join(" ");

  const zeroVisible = min <= 0 && max >= 0;
  const mid = (min + max) / 2;
  const grid: { v: number; dashed?: boolean }[] = [
    { v: min },
    { v: mid },
    ...(zeroVisible ? [{ v: 0, dashed: true }] : []),
    { v: max },
  ];

  const yLabel = (v: number): string =>
    v === 0 ? "0%" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

  return (
    <div className="rounded-2xl border border-line bg-surface p-3 shadow-sm sm:p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <LegendItem color="var(--color-accent)" symbol={a.symbol} pct={lastA} />
          <LegendItem color="var(--color-up)" symbol={b.symbol} pct={lastB} />
        </div>
        <span className="font-mono text-[11px] tabular-nums text-faint">
          % since start · {bars} bars
        </span>
      </div>

      <p className="sr-only">
        Performance since start, overlaid: {a.name} {lastA !== null ? fmtPct(lastA) : "no data"},
        {b.name} {lastB !== null ? fmtPct(lastB) : "no data"}. First point of each series is 0%.
      </p>

      <div className="relative h-64 w-full">
        <svg
          aria-hidden
          className="absolute inset-0 h-full w-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          {grid.map((g) => (
            <line
              key={g.v}
              x1={PLOT_X0}
              y1={y(g.v)}
              x2={100}
              y2={y(g.v)}
              stroke={g.dashed ? "var(--color-line-strong)" : "var(--color-line)"}
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
              strokeDasharray={g.dashed ? "4 4" : undefined}
            />
          ))}
          {pa.length > 1 && (
            <polyline
              points={pts(pa)}
              fill="none"
              stroke="var(--color-accent)"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {pb.length > 1 && (
            <polyline
              points={pts(pb)}
              fill="none"
              stroke="var(--color-up)"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>

        {grid.map((g) => (
          <span
            key={`label-${g.v}`}
            aria-hidden
            className="absolute -translate-y-1/2 pr-1.5 text-right font-mono text-[10px] tabular-nums text-faint"
            style={{ right: "calc(100% - 16%)", top: `${y(g.v)}%` }}
          >
            {yLabel(g.v)}
          </span>
        ))}
      </div>
    </div>
  );
}