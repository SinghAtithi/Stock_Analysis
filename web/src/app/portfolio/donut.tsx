"use client";

/* TASK-1378 — dependency-free SVG donut for concentration charts.
   Token-driven neutral ramp (ink at stepped opacities + muted/faint/line),
   no gradients, no hardcoded hex. The visible legend beside it carries the
   real numbers; the svg itself is a labelled summary for assistive tech. */

export interface DonutSlice {
  label: string;
  /** Share of the whole, 0..1. */
  pct: number;
  value: number;
}

interface Props {
  slices: DonutSlice[];
  /** aria-label summary, e.g. "Sector allocation: Energy 41%, Finance 22%" */
  label: string;
  /** Center-top text (e.g. largest share "41%"). */
  centerTop?: string;
  /** Center-sub text (e.g. "top sector"). */
  centerSub?: string;
  size?: number;
}

const STROKE = 18;
const ROTATE = -90;

interface SegStyle {
  color: string;
  opacity: number;
}

/* Quiet categorical ramp built from design tokens — ink stepped by opacity,
   with muted/faint/line-strong for the tail. */
const PALETTE: SegStyle[] = [
  { color: "var(--color-accent)", opacity: 1 },
  { color: "var(--color-accent)", opacity: 0.62 },
  { color: "var(--color-muted)", opacity: 1 },
  { color: "var(--color-accent)", opacity: 0.38 },
  { color: "var(--color-line-strong)", opacity: 1 },
  { color: "var(--color-faint)", opacity: 1 },
  { color: "var(--color-accent)", opacity: 0.2 },
];

export default function Donut({ slices, label, centerTop, centerSub, size = 168 }: Props) {
  const visible = slices.filter((s) => s.pct > 0);
  const R = (size - STROKE) / 2 - 2;
  const C = 2 * Math.PI * R;
  const cxy = size / 2;

  let acc = 0;
  const arcs = visible.map((s, i) => {
    const frac = s.pct;
    const start = acc;
    acc += frac;
    const style = PALETTE[i % PALETTE.length];
    return {
      key: i,
      dash: `${Math.max(frac * C - 1.75, 0.5)} ${C}`,
      offset: start * C,
      color: style.color,
      opacity: style.opacity,
    };
  });

  const summary = visible
    .slice(0, 6)
    .map((s) => `${s.label} ${(s.pct * 100).toFixed(0)}%`)
    .join(", ");

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={visible.length ? `${label}: ${summary}` : `${label}: no data`}
      className="block shrink-0"
    >
      <g>
        {visible.length === 0 ? (
          <circle
            cx={cxy}
            cy={cxy}
            r={R}
            fill="none"
            stroke="var(--color-line-strong)"
            strokeWidth={STROKE}
          />
        ) : (
          arcs.map((a) => (
            <circle
              key={a.key}
              cx={cxy}
              cy={cxy}
              r={R}
              fill="none"
              stroke={a.color}
              strokeOpacity={a.opacity}
              strokeWidth={STROKE}
              strokeDasharray={a.dash}
              strokeDashoffset={-a.offset}
              transform={`rotate(${ROTATE} ${cxy} ${cxy})`}
            />
          ))
        )}
        {centerTop && (
          <text
            x={cxy}
            y={cxy - 4}
            textAnchor="middle"
            fontSize="20"
            fontWeight="600"
            fontFamily="var(--font-mono)"
            fill="var(--color-paper)"
          >
            {centerTop}
          </text>
        )}
        {centerSub && (
          <text
            x={cxy}
            y={cxy + 12}
            textAnchor="middle"
            fontSize="9"
            fontFamily="var(--font-mono)"
            fill="var(--color-muted)"
          >
            {centerSub}
          </text>
        )}
      </g>
    </svg>
  );
}