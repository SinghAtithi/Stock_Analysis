"use client";

import type { EquityPoint } from "@/lib/paperBook";

interface Props {
  curve: EquityPoint[];
  bookPct: number | null;
  niftyPct: number | null;
  firstTradeAt: number | null;
}

const W = 720;
const H = 210;
const PAD = 8;

const fmtPct = (v: number): string => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;

function shortDate(t: number): string {
  return new Date(t).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });
}

export default function BenchmarkChart({
  curve,
  bookPct,
  niftyPct,
  firstTradeAt,
}: Props) {
  if (!firstTradeAt) {
    return (
      <p className="py-8 text-center text-sm text-muted">
        The benchmark curve starts after your first paper trade — buy or sell
        something above and come back on the next refresh.
      </p>
    );
  }

  const points = curve;
  const last = points[points.length - 1];
  const bookNow = last?.bookPct ?? bookPct;
  const niftyNow = last?.niftyPct ?? niftyPct;

  if (points.length < 2 || bookNow == null || niftyNow == null) {
    return (
      <p className="py-8 text-center text-sm text-muted">
        {bookPct != null && niftyPct != null
          ? `Book ${fmtPct(bookPct)} vs Nifty 50 ${fmtPct(niftyPct)} — the curve fills in as prices refresh.`
          : "Fetching prices — the curve appears on the next refresh."}
      </p>
    );
  }

  let min = Math.min(0, ...points.map((p) => Math.min(p.bookPct, p.niftyPct)));
  let max = Math.max(0, ...points.map((p) => Math.max(p.bookPct, p.niftyPct)));
  if (max - min < 0.5) {
    const mid = (min + max) / 2;
    min = mid - 0.25;
    max = mid + 0.25;
  }
  const span = max - min;
  const pad = span * 0.08;

  const x = (i: number) => (i / (points.length - 1)) * W;
  const y = (v: number) =>
    PAD + (1 - (v - (min - pad)) / (span + pad * 2)) * (H - PAD * 2);

  const bookLine = points
    .map((p, i) => `${x(i).toFixed(1)},${y(p.bookPct).toFixed(1)}`)
    .join(" ");
  const niftyLine = points
    .map((p, i) => `${x(i).toFixed(1)},${y(p.niftyPct).toFixed(1)}`)
    .join(" ");
  const zeroY = y(0);

  const summary =
    `Book P&L ${fmtPct(bookNow)} versus Nifty 50 ${fmtPct(niftyNow)} since ` +
    `${shortDate(points[0].t)}, spanning ${points.length} observed checkpoints.`;

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={summary}
        className="block h-auto w-full"
      >
        <line
          x1={0}
          x2={W}
          y1={zeroY}
          y2={zeroY}
          stroke="var(--color-line-strong)"
          strokeWidth="1"
          strokeDasharray="4 4"
        />
        <polyline
          points={niftyLine}
          fill="none"
          stroke="var(--color-muted)"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
        <polyline
          points={bookLine}
          fill="none"
          stroke="var(--color-paper)"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <p className="sr-only">{summary}</p>
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
        <span className="inline-flex items-center gap-2 font-mono text-sm tabular-nums">
          <span className="h-2 w-4 rounded-full bg-paper" aria-hidden />
          <span className="text-muted">Book</span>
          <span className={bookNow >= 0 ? "text-up" : "text-down"}>
            {fmtPct(bookNow)}
          </span>
        </span>
        <span className="inline-flex items-center gap-2 font-mono text-sm tabular-nums">
          <span className="h-2 w-4 rounded-full bg-muted" aria-hidden />
          <span className="text-muted">Nifty 50</span>
          <span className={niftyNow >= 0 ? "text-up" : "text-down"}>
            {fmtPct(niftyNow)}
          </span>
        </span>
        <span className="ml-auto text-xs text-faint">
          {shortDate(points[0].t)} → {shortDate(points[points.length - 1].t)} ·{" "}
          {points.length} checks
        </span>
      </div>
    </div>
  );
}