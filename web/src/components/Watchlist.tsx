"use client";

import { useRef, useState } from "react";
import type { ChangeEvent } from "react";
import type { WatchlistEntry } from "@/lib/watchlist";
import { exportWatchlist, importWatchlist } from "@/lib/watchlist";

interface Props {
  items: WatchlistEntry[];
  selected: WatchlistEntry | null;
  onPick: (e: WatchlistEntry) => void;
  onRemove: (e: WatchlistEntry) => void;
}

export default function Watchlist({ items, selected, onPick, onRemove }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const flash = (ok: boolean, text: string) => {
    setNotice({ ok, text });
    window.setTimeout(() => setNotice(null), 2600);
  };

  const download = () => {
    const blob = new Blob([exportWatchlist()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "niftyterm-watchlist.json";
    a.click();
    URL.revokeObjectURL(url);
    flash(true, "EXPORTED");
  };

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const ok = importWatchlist(String(reader.result ?? ""));
      flash(ok, ok ? "WATCHLIST IMPORTED" : "IMPORT FAILED — INVALID JSON");
    };
    reader.readAsText(f);
    e.target.value = "";
  };

  return (
    <>
      <p className="mb-2 px-1 font-mono text-[9px] tracking-[0.3em] text-faint">
        WATCHLIST · {String(items.length).padStart(2, "0")}
      </p>
      {items.length === 0 && (
        <p className="mb-2 px-1 font-mono text-[10px] leading-relaxed tracking-widest text-faint">
          LIST EMPTY — TAP THE STAR
          <br />
          IN THE HEADER TO ADD A SYMBOL
        </p>
      )}
      <ul className="flex flex-col">
        {items.map((q, i) => {
          const isSel =
            selected?.symbol === q.symbol && selected?.exchange === q.exchange;
          return (
            <li key={`${q.exchange}-${q.symbol}`}>
              <div
                className={`group flex w-full items-center transition-colors duration-100 ${
                  isSel ? "bg-up" : "hover:bg-panel"
                }`}
              >
                <span
                  aria-hidden
                  className={`w-6 shrink-0 pl-2 font-mono text-[9px] tracking-widest ${
                    isSel ? "text-ink/50" : "text-faint"
                  }`}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <button
                  onClick={() => onPick(q)}
                  aria-current={isSel ? "true" : undefined}
                  className={`flex min-w-0 flex-1 items-center justify-between px-2 py-2 font-mono text-[12px] ${
                    isSel ? "text-ink" : "text-muted hover:text-paper"
                  }`}
                >
                  <span className="truncate tracking-wider">{q.symbol}</span>
                  <span
                    className={`shrink-0 pl-2 text-[9px] tracking-[0.2em] ${
                      isSel ? "text-ink/60" : "text-faint group-hover:text-muted"
                    }`}
                  >
                    {q.type === "Index" ? "IDX" : q.exchange}
                  </span>
                </button>
                <button
                  onClick={() => onRemove(q)}
                  aria-label={`Remove ${q.symbol} from watchlist`}
                  title={`Remove ${q.symbol}`}
                  className={`px-2 py-2 font-mono text-[10px] leading-none transition-colors duration-100 ${
                    isSel
                      ? "text-ink/50 hover:text-ink"
                      : "text-faint hover:text-down lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100"
                  }`}
                >
                  ✕
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mt-auto pt-8">
        <div className="flex items-center gap-4 border-b border-hairline pb-3">
          <button
            onClick={download}
            className="font-mono text-[9px] tracking-[0.2em] text-faint transition-colors duration-100 hover:text-paper"
          >
            EXPORT
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            className="font-mono text-[9px] tracking-[0.2em] text-faint transition-colors duration-100 hover:text-paper"
          >
            IMPORT
          </button>
          {notice && (
            <span
              role="status"
              aria-live="polite"
              className={`font-mono text-[9px] tracking-[0.2em] ${
                notice.ok ? "text-up" : "text-down"
              }`}
            >
              {notice.ok ? "✓" : "✕"} {notice.text}
            </span>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={onFile}
            aria-label="Import watchlist JSON"
          />
        </div>
        <p className="pt-4 font-mono text-[9px] leading-relaxed tracking-wider text-faint">
          DATA · YAHOO FINANCE / NSE / BSE
          <br />
          KEYS · 1–8 RANGE · R RETRY · / SEARCH
          <br />
          NOT INVESTMENT ADVICE
        </p>
      </div>
    </>
  );
}
