"use client";

import { useId } from "react";

interface Props {
  values: number[];
  width?: number;
  height?: number;
  stroke?: string;
  fill?: boolean;
  label?: string;
}

export default function Sparkline({
  values,
  width = 120,
  height = 28,
  stroke = "var(--color-paper)",
  fill = true,
  label = "Trend",
}: Props) {
  const gid = useId();

  if (values.length === 0) {
    return (
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`${label}: no data`}
        className="block"
      />
    );
  }

  const finite = values.filter((v) => Number.isFinite(v));
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const span = max - min || 1;
  const pad = 1;

  const x = (i: number) => (i / (values.length - 1)) * width;
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - pad * 2);

  const pts = values
    .map((v, i) =>
      Number.isFinite(v) ? `${x(i).toFixed(1)},${y(v).toFixed(1)}` : null,
    )
    .filter((p): p is string => p !== null);

  const area =
    fill && pts.length > 1
      ? `M${pts[0].split(",")[0]},${height} L${pts.join(" L")} L${
          pts[pts.length - 1].split(",")[0]
        },${height} Z`
      : null;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${label}: min ${min.toFixed(2)}, max ${max.toFixed(2)}, last ${(
        values[values.length - 1] ?? 0
      ).toFixed(2)}`}
      className="block overflow-visible"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.25" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      {area && <path d={area} fill={`url(#${gid})`} />}
      <polyline
        points={pts.join(" ")}
        fill="none"
        stroke={stroke}
        strokeWidth="1.25"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
