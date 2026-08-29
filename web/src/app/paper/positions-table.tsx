"use client";

import Skeleton from "@/components/Skeleton";
import type { PaperPosition } from "@/lib/paperBook";
import {
  positionUnrealized,
  positionUnrealizedPct,
} from "@/lib/paperBook";

export interface Quote {
  price: number | null;
  changePct: number | null;
}

interface Props {
  positions: PaperPosition[];
  quotes: Map<string, Quote>;
  loading: boolean;
  onSellQuick: (symbol: string) => void;
}

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});

const fmtPct = (v: number): string => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;

const pnlCls = (v: number): string =>
  v > 0.005 ? "text-up" : v < -0.005 ? "text-down" : "text-muted";

export default function PositionsTable({
  positions,
  quotes,
  loading,
  onSellQuick,
}: Props) {
  const initial = loading && quotes.size === 0 && positions.length > 0;

  if (positions.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted">
        No open positions — pick a symbol above and place your first paper
        trade. Nothing here involves real money.
      </p>
    );
  }

  const totals = positions.reduce(
    (a, p) => {
      const ltp = quotes.get(p.symbol)?.price ?? null;
      const px = ltp != null && ltp > 0 ? ltp : p.avgCost;
      a.invested += p.qty * p.avgCost;
      a.value += p.qty * px;
      a.unrealized += positionUnrealized(p, px);
      return a;
    },
    { invested: 0, value: 0, unrealized: 0 },
  );

  return (
    <section
      aria-labelledby="positions-heading"
      className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm"
    >
      <h2 id="positions-heading" className="sr-only">
        Open positions
      </h2>
      <div className="hidden grid-cols-[minmax(0,1.5fr)_4.5rem_6.5rem_7rem_5.5rem_9rem_auto] gap-3 border-b border-line bg-panel-2 px-4 py-2 text-[11px] font-medium tracking-wide text-faint uppercase sm:grid">
        <span>Position</span>
        <span className="text-right">Qty</span>
        <span className="text-right">Avg cost</span>
        <span className="text-right">LTP</span>
        <span className="text-right">Day %</span>
        <span className="text-right">Unrealized P&L</span>
        <span className="text-right">Sell</span>
      </div>
      {initial ? (
        <div className="space-y-3 p-4">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : (
        <ul>
          {positions.map((p, i) => {
            const q = quotes.get(p.symbol);
            const ltp = q?.price != null && q.price > 0 ? q.price : null;
            const px = ltp ?? p.avgCost;
            const unrealized = positionUnrealized(p, px);
            const dayPct = q?.changePct ?? null;
            return (
              <li
                key={p.symbol}
                className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-3 sm:grid-cols-[minmax(0,1.5fr)_4.5rem_6.5rem_7rem_5.5rem_9rem_auto] sm:gap-3 ${
                  i > 0 ? "border-t border-line" : ""
                }`}
              >
                <div className="min-w-0">
                  <span className="font-mono text-sm font-medium tabular-nums text-paper">
                    {p.symbol}
                  </span>
                  <p className="truncate text-xs text-faint">{p.name}</p>
                </div>
                <span className="justify-self-end font-mono text-sm tabular-nums text-paper sm:justify-self-auto sm:text-right">
                  {p.qty}
                </span>
                <span className="col-start-2 row-start-2 font-mono text-sm tabular-nums text-muted sm:col-auto sm:row-auto sm:text-right">
                  {inr.format(p.avgCost)}
                </span>
                <span className="col-start-2 row-start-3 font-mono text-sm tabular-nums text-paper sm:col-auto sm:row-auto sm:text-right">
                  {ltp != null ? inr.format(ltp) : "—"}
                </span>
                <span
                  className={`col-start-2 row-start-4 font-mono text-sm tabular-nums sm:col-auto sm:row-auto sm:text-right ${
                    dayPct == null ? "text-faint" : pnlCls(dayPct)
                  }`}
                >
                  {dayPct == null ? "—" : fmtPct(dayPct)}
                </span>
                <span
                  className={`col-start-2 row-start-5 font-mono text-sm tabular-nums sm:col-auto sm:row-auto sm:text-right ${pnlCls(
                    unrealized,
                  )}`}
                >
                  {inr.format(unrealized)}
                  <span className="ml-1 text-xs opacity-80">
                    {fmtPct(positionUnrealizedPct(p, px))}
                  </span>
                </span>
                <div className="col-start-2 row-start-6 flex justify-end sm:col-auto sm:row-auto">
                  <button
                    type="button"
                    onClick={() => onSellQuick(p.symbol)}
                    aria-label={`Sell ${p.symbol}`}
                    className="rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-muted transition-colors hover:border-line-strong hover:text-paper"
                  >
                    Sell
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="grid grid-cols-1 gap-x-6 gap-y-1 border-t border-line bg-panel-2 px-4 py-3 text-xs text-muted sm:grid-cols-3">
        <span>
          Invested ·{" "}
          <span className="font-mono tabular-nums text-paper">
            {inr.format(totals.invested)}
          </span>
        </span>
        <span>
          Current value ·{" "}
          <span className="font-mono tabular-nums text-paper">
            {inr.format(totals.value)}
          </span>
        </span>
        <span>
          Unrealized ·{" "}
          <span className={`font-mono tabular-nums ${pnlCls(totals.unrealized)}`}>
            {inr.format(totals.unrealized)}
          </span>
        </span>
      </div>
    </section>
  );
}