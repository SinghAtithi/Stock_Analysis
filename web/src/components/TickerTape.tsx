"use client";

import type { SearchResult, TickerItem } from "@/lib/types";

export default function TickerTape({
  items,
  onSelect,
}: {
  items: TickerItem[];
  onSelect: (r: SearchResult) => void;
}) {
  if (!items.length) return null;

  return (
    <div className="border-y border-line bg-panel overflow-x-auto scrollbar-none">
      <div className="flex items-center gap-2 px-4 py-2 sm:px-6">
        <span className="shrink-0 text-[10px] font-medium tracking-widest text-faint uppercase">Live</span>
        <div className="h-3 w-px shrink-0 bg-line-strong" aria-hidden />
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
          {items.map((t) => {
            const up = (t.changePct ?? 0) >= 0;
            return (
              <button
                key={`${t.exchange}-${t.symbol}`}
                onClick={() =>
                  onSelect({
                    symbol: t.symbol,
                    name: t.name,
                    shortName: t.symbol,
                    exchange: t.exchange,
                    type: t.type,
                    sector: "",
                  })
                }
                title={`${t.name} — open chart`}
                className="inline-flex shrink-0 items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs transition-colors hover:border-line-strong hover:bg-panel-2"
              >
                <span className="font-medium tracking-wide text-paper">{t.symbol}</span>
                <span className="font-mono text-[11px] tabular-nums text-muted">
                  {t.price != null ? t.price.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—"}
                </span>
                <span
                  className={`rounded-full px-1.5 py-0.5 font-mono text-[10px] font-medium tabular-nums ${up ? "bg-up-soft text-up" : "bg-down-soft text-down"}`}
                >
                  {t.changePct != null ? `${up ? "+" : ""}${t.changePct.toFixed(2)}%` : "—"}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
