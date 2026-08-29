"use client";

import { useState } from "react";
import type { PaperTrade } from "@/lib/paperBook";
import { NOTE_MAX } from "@/lib/paperBook";

interface Props {
  trades: PaperTrade[];
  onSaveNote: (id: string, note: string) => void;
}

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});

const fmtPct = (v: number): string => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(2)}%`;

function TradeRow({
  trade,
  onSaveNote,
}: {
  trade: PaperTrade;
  onSaveNote: (id: string, note: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(trade.note);

  const when = new Date(trade.time).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  const save = () => {
    onSaveNote(trade.id, draft.trim());
    setEditing(false);
  };

  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 border-t border-line px-4 py-3 first:border-t-0">
      <span className="row-span-3 mt-0.5 font-mono text-xs leading-relaxed tabular-nums text-faint">
        {when}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide ${
            trade.side === "buy"
              ? "bg-up-soft text-up"
              : "bg-down-soft text-down"
          }`}
        >
          {trade.side}
        </span>
        <span className="font-mono text-sm font-medium tabular-nums text-paper">
          {trade.symbol}
        </span>
        <span className="truncate text-xs text-faint">{trade.name}</span>
      </div>
      <p className="col-start-2 font-mono text-sm tabular-nums text-paper">
        {trade.qty} @ {inr.format(trade.fillPrice)}
        <span className="ml-2 text-xs text-faint">
          LTP {inr.format(trade.refPrice)} · {fmtPct(trade.slippagePct)} slip
        </span>
        {trade.realizedPnl != null && (
          <span
            className={`ml-2 text-xs ${
              trade.realizedPnl >= 0 ? "text-up" : "text-down"
            }`}
          >
            realized {inr.format(trade.realizedPnl)}
          </span>
        )}
      </p>
      <div className="col-start-2">
        {editing ? (
          <div className="mt-1 flex flex-col gap-2">
            <textarea
              rows={2}
              maxLength={NOTE_MAX}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-label={`Journal note for ${trade.symbol} ${trade.side}`}
              className="w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 text-sm leading-relaxed text-paper placeholder:text-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              placeholder="Why this trade?"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={save}
                className="rounded-full bg-paper px-3 py-1 text-xs font-medium text-ink transition-opacity hover:opacity-90"
              >
                Save note
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraft(trade.note);
                  setEditing(false);
                }}
                className="rounded-full border border-line bg-surface px-3 py-1 text-xs text-muted transition-colors hover:text-paper"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <p className="mt-1 text-xs leading-relaxed text-muted">
            {trade.note ? (
              trade.note
            ) : (
              <span className="text-faint italic">No journal note</span>
            )}{" "}
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="ml-1 font-medium text-faint underline decoration-line underline-offset-2 hover:text-muted"
            >
              {trade.note ? "Edit note" : "Add note"}
            </button>
          </p>
        )}
      </div>
    </li>
  );
}

export default function TradeHistory({ trades, onSaveNote }: Props) {
  if (trades.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted">
        No trades yet — every fill lands here with its journal note, so your
        decision trail stays in this browser only.
      </p>
    );
  }
  return (
    <section
      aria-labelledby="history-heading"
      className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm"
    >
      <h2
        id="history-heading"
        className="border-b border-line bg-panel-2 px-4 py-2.5 text-[11px] font-medium tracking-wide text-faint uppercase"
      >
        Trade history &amp; journal
      </h2>
      <ul>
        {[...trades]
          .sort((a, b) => b.time - a.time)
          .map((t) => (
            <TradeRow key={t.id} trade={t} onSaveNote={onSaveNote} />
          ))}
      </ul>
    </section>
  );
}