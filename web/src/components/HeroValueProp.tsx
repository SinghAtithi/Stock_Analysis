"use client";

import { useEffect, useState } from "react";

/* TASK-242: compact landing value prop — plain-English positioning, stat
   chips (NSE & BSE · 190 strategies · breadth + backtest) and three proof
   pills. page.tsx renders it only while nothing is picked, so the
   search-first terminal stays clean once a symbol is chosen. Dismiss is
   persisted per device. */
const DISMISS_KEY = "nifty.heroDismissed";

export default function HeroValueProp() {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(DISMISS_KEY) === "1") {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate persisted dismiss
        setDismissed(true);
      }
    } catch {
      /* private mode — hero stays until a pick */
    }
  }, []);

  if (dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* private mode — in-memory dismiss only */
    }
  };

  return (
    <section
      aria-label="What NIFTY//TERM does"
      className="border-b border-line bg-panel-2/60 px-4 py-4 sm:px-6"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold tracking-tight text-paper sm:text-base">
            Every Indian market signal — one terminal
          </p>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
            NSE &amp; BSE quotes, fundamentals, and market depth in one place.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-paper px-2.5 py-1 font-mono text-xs font-medium text-ink">
              NSE &amp; BSE
            </span>
            <span className="rounded-full bg-paper px-2.5 py-1 font-mono text-xs font-medium text-ink">
              190 strategies
            </span>
            <span className="rounded-full bg-paper px-2.5 py-1 font-mono text-xs font-medium text-ink">
              Breadth + backtest
            </span>
            <span className="rounded-full border border-line bg-panel-2 px-2.5 py-1 text-muted">
              Jury-ranked · 6 independent models
            </span>
            <span className="rounded-full border border-line bg-panel-2 px-2.5 py-1 text-muted">
              Delayed 15m — exchange rule
            </span>
            <span className="rounded-full border border-line bg-panel-2 px-2.5 py-1 text-muted">
              No account · no card
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss intro"
          className="shrink-0 rounded-full border border-line bg-surface px-2 py-1 text-sm text-muted transition-colors hover:text-paper"
        >
          ✕
        </button>
      </div>
    </section>
  );
}