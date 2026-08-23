"use client";

import { useRef, useState } from "react";
import type { ChangeEvent } from "react";
import type { WatchlistEntry } from "@/lib/watchlist";
import { exportWatchlist, importWatchlist } from "@/lib/watchlist";
import Link from "next/link";

interface Props {
  items: WatchlistEntry[];
  selected: WatchlistEntry | null;
  onPick: (e: WatchlistEntry) => void;
  onRemove: (e: WatchlistEntry) => void;
  bare?: boolean;
}

export default function Watchlist({
  items,
  selected,
  onPick,
  onRemove,
  bare,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  const flash = (ok: boolean, text: string) => {
    setNotice({ ok, text });
    window.setTimeout(() => setNotice(null), 2600);
  };

  const download = () => {
    const blob = new Blob([exportWatchlist()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "nifty-watchlist.json";
    a.click();
    URL.revokeObjectURL(url);
    flash(true, "Exported");
  };

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const ok = importWatchlist(String(reader.result ?? ""));
      flash(ok, ok ? "Watchlist imported" : "Import failed — invalid file");
    };
    reader.readAsText(f);
    e.target.value = "";
  };

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-medium tracking-wide text-muted">
          Watchlist <span className="ml-1 rounded-full bg-panel-2 px-1.5 py-0.5 font-mono text-[11px] text-faint">{String(items.length).padStart(2, "0")}</span>
        </p>
        {notice && (
          <span role="status" aria-live="polite" className={`rounded-full px-2 py-0.5 text-xs ${notice.ok ? "bg-up-soft text-up" : "bg-down-soft text-down"}`}>
            {notice.text}
          </span>
        )}
      </div>

      {items.length === 0 && (
        <div className="rounded-xl border border-dashed border-line bg-canvas px-4 py-6 text-center">
          <p className="text-sm font-medium text-paper">No symbols yet</p>
          <p className="mt-1 text-xs leading-relaxed text-muted">Search above and press the star on any chart to add it here.</p>
        </div>
      )}

      <ul className="flex flex-col gap-1">
        {items.map((q) => {
          const isSel =
            selected?.symbol === q.symbol && selected?.exchange === q.exchange;
          return (
            <li key={`${q.exchange}-${q.symbol}`}>
              <div
                className={`group flex items-center rounded-xl border px-2 py-2 transition-colors ${
                  isSel ? "border-paper bg-paper text-ink" : "border-transparent hover:border-line hover:bg-canvas"
                }`}
              >
                <button
                  onClick={() => onPick(q)}
                  aria-current={isSel ? "true" : undefined}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${isSel ? "bg-ink/10 text-ink" : "bg-panel-2 text-muted"}`}>
                    {q.symbol.slice(0, 2)}
                  </span>
                  <span className="min-w-0">
                    <span className={`block truncate text-sm font-medium leading-none ${isSel ? "text-ink" : "text-paper"}`}>{q.symbol}</span>
                    <span className={`block truncate text-xs ${isSel ? "text-ink/70" : "text-faint"}`}>{q.type === "Index" ? "Index" : q.exchange} · {q.name.slice(0, 28)}</span>
                  </span>
                </button>
                <button
                  onClick={() => onRemove(q)}
                  aria-label={`Remove ${q.symbol}`}
                  title={`Remove ${q.symbol}`}
                  className={`relative ml-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm leading-none transition-colors after:absolute after:-inset-2 after:content-[''] ${isSel ? "text-ink/60 hover:bg-ink/10 hover:text-ink" : "text-faint hover:bg-surface hover:text-down"}`}
                >
                  ×
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-auto pt-6">
        <div className="flex items-center gap-2 border-t border-line pt-3">
          <button onClick={download} className="rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-muted hover:text-paper">
            Export
          </button>
          <button onClick={() => fileRef.current?.click()} className="rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-muted hover:text-paper">
            Import
          </button>
          <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={onFile} aria-label="Import watchlist JSON" />
        </div>
        {!bare && (
          <p className="pt-3 text-[11px] leading-relaxed text-faint">
            Data from Yahoo · Google · NSE/BSE<br />
            <Link href="/disclaimer" className="underline decoration-line underline-offset-2 hover:text-muted">
              Not investment advice
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
