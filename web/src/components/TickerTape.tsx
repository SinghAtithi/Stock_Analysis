"use client";

import { useRef, useState } from "react";
import type { SearchResult, TickerItem } from "@/lib/types";

export default function TickerTape({
  items,
  onSelect,
}: {
  items: TickerItem[];
  onSelect: (r: SearchResult) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  /* TASK-102: the tape drifts slowly for glanceability but yields to the user —
     hovering, keyboard focus or any manual scroll pauses it */
  const [paused, setPaused] = useState(false);

  const nudge = (dx: number) => {
    setPaused(true);
    trackRef.current?.scrollBy({ left: dx, behavior: "smooth" });
  };

  /* one identical half of the tape; rendered twice so translateX(-50%) loops
     seamlessly. The clone half is hidden from the a11y tree and tab order —
     real symbols stay reachable via Tab/search without losing context */
  const half = (clone: boolean) => (
    <div
      aria-hidden={clone || undefined}
      className={`flex w-max shrink-0 items-center gap-2 pr-2`}
    >
      <span className="shrink-0 text-[10px] font-medium uppercase tracking-widest text-faint">
        Live
      </span>
      <div className="h-3 w-px shrink-0 bg-line-strong" aria-hidden />
      {items.map((t) => {
        const up = (t.changePct ?? 0) >= 0;
        return (
          <button
            key={`${clone ? "c-" : ""}${t.exchange}-${t.symbol}`}
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
            tabIndex={clone ? -1 : undefined}
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
  );

  return (
    <div
      role="region"
      aria-label="Market ticker"
      className="relative"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {/* keyboard-scrollable strip: focus it, then arrow keys / Home / End */}
      <div
        ref={trackRef}
        tabIndex={0}
        aria-label="Ticker symbols — use arrow keys to scroll"
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") {
            e.preventDefault();
            nudge(240);
          } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            nudge(-240);
          } else if (e.key === "Home") {
            e.preventDefault();
            setPaused(true);
            trackRef.current?.scrollTo({ left: 0 });
          } else if (e.key === "End") {
            e.preventDefault();
            setPaused(true);
            const el = trackRef.current;
            if (el) el.scrollTo({ left: el.scrollWidth });
          } else {
            setPaused(true);
          }
        }}
        onWheel={() => setPaused(true)}
        onTouchStart={() => setPaused(true)}
        className="tape-strip flex items-center overflow-x-auto px-4 py-2 sm:px-6 focus-visible:outline-2 focus-visible:outline-accent"
      >
        {/* TASK-946: nothing here — the fade overlays the region, see below */}
        <div
          className="tape-track flex w-max items-center"
          style={{ animationPlayState: paused ? "paused" : "running" }}
        >
          {half(false)}
          {half(true)}
        </div>
      </div>
      {/* TASK-946: right-edge fade — the tape visibly dissolves past the fold,
          signalling it scrolls; pointer-events-none keeps taps/drags native */}
      <div
        aria-hidden
        className="tape-fade absolute inset-y-0 right-0 w-12 sm:w-16"
      />
    </div>
  );
}
