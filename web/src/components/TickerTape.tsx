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
  const loop = [...items, ...items];
  const duration = Math.max(60, loop.length * 1.4);

  return (
    <div className="tape-wrap relative overflow-hidden border-b border-hairline bg-panel">
      <div
        className="tape-track items-center gap-0 py-1.5 font-mono text-[12px]"
        style={{ "--tape-duration": `${duration}s` } as React.CSSProperties}
      >
        {loop.map((t, i) => {
          const up = (t.changePct ?? 0) >= 0;
          return (
            <button
              key={i}
              tabIndex={-1}
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
              title={`${t.name} · open chart`}
              className="inline-flex cursor-pointer items-center transition-colors duration-100 hover:bg-ink"
            >
              <span className="px-5 font-semibold tracking-wider text-paper">
                {t.symbol}
              </span>
              <span className="text-muted tabular-nums">
                {t.price != null
                  ? t.price.toLocaleString("en-IN", {
                      maximumFractionDigits: 2,
                    })
                  : "—"}
              </span>
              <span
                className={`ml-2 tabular-nums ${up ? "text-up" : "text-down"}`}
              >
                {t.changePct != null
                  ? `${up ? "+" : ""}${t.changePct.toFixed(2)}%`
                  : "—"}
              </span>
              <span className="px-5 text-faint">▌</span>
            </button>
          );
        })}
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-ink to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-ink to-transparent" />
    </div>
  );
}
