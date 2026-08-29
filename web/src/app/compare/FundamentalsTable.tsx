"use client";

/* TASK-1418 — side-by-side fundamentals for /compare: one row per metric,
   the better value tinted (up-soft) per direction-aware rules from
   lib/compare (lower = better for valuation/leverage, higher = better for
   returns/margins/yields, neutral = no tint). Rows stack vertically on
   mobile; desktop gets three columns with a symbol header row. */

import {
  FUND_METRICS,
  betterSide,
  metricValue,
  type FundMetrics,
  type FundPayload,
} from "@/lib/compare";

export interface FundSide {
  symbol: string;
  isIndex: boolean;
  payload: FundPayload | null;
  loading: boolean;
  failed: boolean;
}

interface Props {
  a: FundSide;
  b: FundSide;
}

const fmtCell = (
  m: FundMetrics | null,
  key: (typeof FUND_METRICS)[number]["key"],
  fmt: (v: number) => string,
): string => {
  const v = metricValue(m, key);
  return v === null ? "—" : fmt(v);
};

const asOfLabel = (iso: string | null): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
  }).format(d);
};

export default function FundamentalsTable({ a, b }: Props) {
  const eitherIndex = a.isIndex || b.isIndex;
  const anyLoaded =
    (a.payload?.metrics ?? null) !== null || (b.payload?.metrics ?? null) !== null;
  const bothEmpty =
    !a.loading && !b.loading && !a.failed && !b.failed && !anyLoaded;
  const bothFailed = a.failed && b.failed;

  const ma = eitherIndex && a.isIndex ? null : (a.payload?.metrics ?? null);
  const mb = eitherIndex && b.isIndex ? null : (b.payload?.metrics ?? null);

  const asOf = asOfLabel(a.payload?.meta.as_of ?? null) ?? asOfLabel(b.payload?.meta.as_of ?? null);
  const source = a.payload?.meta.source ?? b.payload?.meta.source ?? null;

  const rows = FUND_METRICS.filter(
    (def) => metricValue(ma, def.key) !== null || metricValue(mb, def.key) !== null,
  );

  const header = "grid grid-cols-1 md:grid-cols-[11rem_1fr_1fr] md:gap-x-3";
  const headCols = "grid grid-cols-[11rem_1fr_1fr] gap-x-3";

  return (
    <section
      aria-label="Fundamentals comparison"
      className="rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold tracking-tight text-paper">Fundamentals</h2>
        {(asOf || source) && (
          <span className="font-mono text-[11px] tabular-nums text-faint">
            {asOf ? `as of ${asOf} IST` : null}
            {asOf && source ? " · " : ""}
            {source ?? ""}
          </span>
        )}
      </div>

      {bothFailed && (
        <p className="mt-3 text-sm text-muted">Fundamentals unavailable right now.</p>
      )}

      {bothEmpty && !bothFailed && (
        <p className="mt-3 text-sm text-muted">
          No fundamentals on file for either symbol.
        </p>
      )}

      {(a.loading || b.loading) && (
        <div className="mt-4 space-y-3">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              aria-hidden
              className="block h-4 w-2/3 animate-pulse rounded bg-panel-2"
            />
          ))}
        </div>
      )}

      {!a.loading && !b.loading && !bothFailed && !bothEmpty && rows.length > 0 && (
        <>
          <p className="mt-1 text-xs text-faint">
            {eitherIndex
              ? "Fundamentals don&apos;t apply to index symbols — the equity side shows alone. "
              : ""}
            Tinted cell = better value: lower for valuation and leverage, higher for
            returns, margins and yields.
          </p>

          <div className={`mt-3 hidden border-b border-line pb-2 md:grid ${headCols}`}>
            <span className="text-[11px] font-medium tracking-wide text-faint">Metric</span>
            <span className="font-mono text-[11px] tracking-wide text-muted">{a.symbol}</span>
            <span className="font-mono text-[11px] tracking-wide text-muted">{b.symbol}</span>
          </div>

          <div className="mt-2">
            {rows.map((def, i) => {
              const va = metricValue(ma, def.key);
              const vb = metricValue(mb, def.key);
              const winner = betterSide(va, vb, def.direction);
              const cellCls = (side: "a" | "b") =>
                `rounded-lg px-2.5 py-1.5 font-mono text-sm tabular-nums ${
                  winner === side ? "bg-up-soft text-paper" : "text-paper"
                }`;
              const missCls =
                "rounded-lg px-2.5 py-1.5 font-mono text-sm tabular-nums text-faint";
              return (
                <div
                  key={def.key}
                  className={`${header} ${i > 0 ? "border-t border-line" : ""} py-2.5`}
                >
                  <p className="text-xs font-medium tracking-wide text-muted">
                    {def.label}
                  </p>
                  <p className={va === null ? missCls : cellCls("a")}>
                    <span className="mr-2 font-sans text-[11px] font-normal text-faint md:hidden">
                      {a.symbol}
                    </span>
                    {a.isIndex || a.failed
                      ? a.isIndex
                        ? "—"
                        : "Unavailable"
                      : fmtCell(ma, def.key, def.fmt)}
                  </p>
                  <p className={vb === null ? missCls : cellCls("b")}>
                    <span className="mr-2 font-sans text-[11px] font-normal text-faint md:hidden">
                      {b.symbol}
                    </span>
                    {b.isIndex || b.failed
                      ? b.isIndex
                        ? "—"
                        : "Unavailable"
                      : fmtCell(mb, def.key, def.fmt)}
                  </p>
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}