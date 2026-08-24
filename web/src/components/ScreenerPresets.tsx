"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { SortDir } from "@/components/DataTable";
import {
  deleteScreenerPreset,
  restoreScreenerPreset,
  getServerPresetsSnapshot,
  getScreenerPresetsSnapshot,
  saveScreenerPreset,
  subscribeScreenerPresets,
  type ScreenerPreset,
} from "@/lib/screenerPresets";

interface Props {
  strategy: string;
  sortKey: string | null;
  sortDir: SortDir;
  onApply: (preset: ScreenerPreset) => void;
}

/* Saved views (TASK-62): quiet device-scoped snapshots of strategy + sort.
   "Save view" → inline name input; picker lists presets, click applies. */
export default function ScreenerPresets({
  strategy,
  sortKey,
  sortDir,
  onApply,
}: Props) {
  const presets = useSyncExternalStore(
    subscribeScreenerPresets,
    getScreenerPresetsSnapshot,
    getServerPresetsSnapshot,
  );
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  /* TASK-776: saving used to be silent — flash a visible + sr-only cue */
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  /* TASK-386: one pending delete, 5s undo window */
  const [pendingDelete, setPendingDelete] = useState<{ preset: (typeof presets)[number]; index: number } | null>(null);
  const undoTimerRef = useRef<number | null>(null);
  useEffect(() => () => { if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current); }, []);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open && !naming) return;
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setNaming(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setNaming(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, naming]);

  /* TASK-613: overwriting an existing view name requires a second explicit
     click ("Overwrite"); typing again cancels the confirmation */
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const nameExists =
    name.trim() !== "" &&
    presets.some((p) => p.name === name.trim());
  const pendingOverwrite = confirmOverwrite && nameExists;

  const save = useCallback(() => {
    const trimmed = name.trim();
    if (!trimmed || !strategy) return;
    const exists = presets.some((p) => p.name === trimmed);
    if (exists && !confirmOverwrite) {
      setConfirmOverwrite(true);
      return;
    }
    const persisted = saveScreenerPreset(trimmed, { strategy, sortKey, sortDir });
    setNotice(
      persisted
        ? { ok: true, text: exists ? `View “${trimmed}” updated` : `View “${trimmed}” saved` }
        : { ok: false, text: "Couldn't save view — storage unavailable" },
    );
    window.setTimeout(() => setNotice(null), 2600);
    setName("");
    setConfirmOverwrite(false);
    setNaming(false);
  }, [name, strategy, sortKey, sortDir, presets, confirmOverwrite]);

  return (
    <div ref={containerRef} className="ml-auto flex items-center gap-2">
      {pendingDelete && (
        <span role="status" aria-live="polite" className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-2 py-0.5 text-xs text-muted">
          Deleted “{pendingDelete.preset.name}”
          <button
            type="button"
            onClick={() => {
              if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current);
              restoreScreenerPreset(pendingDelete.preset, pendingDelete.index);
              setPendingDelete(null);
            }}
            className="rounded-full border border-line bg-panel-2 px-2 py-0.5 text-[11px] font-medium text-paper transition-colors hover:border-line-strong"
          >
            Undo
          </button>
        </span>
      )}
      {notice && (
        <span
          role="status"
          aria-live="polite"
          className={`rounded-full px-2 py-0.5 text-xs ${notice.ok ? "bg-up-soft text-up" : "bg-down-soft text-down"}`}
        >
          {notice.text}
        </span>
      )}
      {naming ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          className="flex items-center gap-1.5"
        >
          <input
            autoFocus
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setConfirmOverwrite(false);
            }}
            maxLength={40}
            placeholder="View name"
            aria-label="View name"
            className="w-40 rounded-full border border-line bg-surface px-3 py-1.5 text-sm text-paper focus-visible:outline-2 focus-visible:outline-accent"
          />
          {pendingOverwrite && (
            <span className="text-[11px] leading-tight text-down" role="alert">
              exists — overwrite?
            </span>
          )}
          <button
            type="submit"
            disabled={!name.trim()}
            className="rounded-full bg-paper px-3 py-1.5 text-sm font-medium text-ink shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pendingOverwrite ? "Overwrite" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => {
              setNaming(false);
              setName("");
              setConfirmOverwrite(false);
            }}
            className="rounded-full border border-line bg-surface px-3 py-1.5 text-sm text-muted transition-colors hover:text-paper"
          >
            Cancel
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setNaming(true)}
          className="rounded-full border border-dashed border-line px-3.5 py-1.5 text-sm text-muted transition-colors hover:border-line-strong hover:text-paper"
        >
          Save view
        </button>
      )}

      {presets.length > 0 && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-haspopup="true"
            aria-label={`Saved views, ${presets.length} available`}
            className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
              open
                ? "border-paper bg-paper text-ink shadow-sm"
                : "border-line bg-surface text-muted hover:border-line-strong hover:text-paper"
            }`}
          >
            Views ({presets.length})
          </button>

          {open && (
            <ul
              aria-label="Saved views"
              className="absolute right-0 z-20 mt-2 flex min-w-64 flex-col gap-1 rounded-xl border border-line bg-surface p-2 shadow-md"
            >
              {presets.map((p) => (
                <li key={p.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      onApply(p);
                      setOpen(false);
                    }}
                    title={`${p.strategy}${p.sortKey ? ` · ${p.sortKey} ${p.sortDir}` : ""}`}
                    className="min-w-0 flex-1 truncate rounded-lg px-2 py-1.5 text-left text-sm text-paper transition-colors hover:bg-panel-2"
                  >
                    {p.name}
                    <span className="ml-2 font-mono text-[11px] tabular-nums text-faint">
                      {p.sortKey ? `${p.sortKey} ${p.sortDir}` : "default"}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const index = presets.findIndex((x) => x.id === p.id);
                      setPendingDelete({ preset: p, index });
                      deleteScreenerPreset(p.id);
                      if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current);
                      undoTimerRef.current = window.setTimeout(() => setPendingDelete(null), 5000);
                    }}
                    aria-label={`Delete saved view ${p.name}`}
                    className="shrink-0 rounded-full border border-line bg-panel-2 px-2 py-0.5 text-xs text-muted transition-colors hover:text-down"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
