"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

interface StrategyOption {
  id: string;
  name: string;
  juryRank: number | null;
}

interface Props {
  strategies: StrategyOption[];
  value: string;
  onChange: (id: string) => void;
}

/* TASK-81: searchable strategy picker for large registries — the 190-strategy
 * pill row overruns the toolbar, so past a threshold the screener swaps pills
 * for this combobox. Keyboard pattern per WAI-ARIA combobox (collapse): input
 * owns focus, aria-controls points at the listbox, ArrowUp/Down move
 * aria-activedescendant, Enter selects, Escape closes. */

const MAX_VISIBLE = 40;

export default function StrategyPicker({
  strategies,
  value,
  onChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  const selected = strategies.find((s) => s.id === value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hits = q
      ? strategies.filter(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            s.id.toLowerCase().includes(q)
        )
      : strategies;
    return hits.slice(0, MAX_VISIBLE);
  }, [strategies, query]);

  /* active index can outlive a shrinking filter — clamp at read time */
  const active = Math.min(activeIdx, Math.max(0, filtered.length - 1));

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const openList = () => {
    setQuery("");
    setOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const commit = (id: string) => {
    if (!id) return;
    onChange(id);
    setOpen(false);
    setQuery("");
  };

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        openList();
        return;
      }
      const next =
        e.key === "ArrowDown"
          ? Math.min(active + 1, filtered.length - 1)
          : Math.max(active - 1, 0);
      setActiveIdx(next);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const hit = filtered[active];
      if (hit) commit(hit.id);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openList())}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`Strategy: ${selected?.name ?? value}. Change strategy`}
        title={selected ? `${selected.name}${selected.juryRank ? ` · jury #${selected.juryRank}` : ""}` : value}
        className="flex max-w-[220px] items-center gap-1.5 rounded-full bg-paper px-3.5 py-1.5 text-sm font-medium text-ink shadow-sm transition-colors hover:bg-accent sm:max-w-none"
      >
        <span className="truncate">{selected?.name ?? value}</span>
        {selected?.juryRank != null && (
          <span className="rounded-full bg-ink/10 px-1.5 py-0.5 font-mono text-[10px]">
            #{selected.juryRank}
          </span>
        )}
        <span aria-hidden className="text-[10px]">▾</span>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-2 w-72 rounded-xl border border-line bg-surface p-2 shadow-md">
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={
              filtered[active] ? `${listboxId}-opt-${active}` : undefined
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Filter strategies…"
            aria-label="Filter strategies"
            className="mb-1.5 w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm text-paper placeholder:text-faint focus-visible:outline-2 focus-visible:outline-accent"
          />
          <ul
            id={listboxId}
            role="listbox"
            aria-label="Strategies"
            className="max-h-72 overflow-y-auto"
          >
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-sm text-muted" role="option" aria-selected={false} aria-disabled>
                No strategies match “{query.trim()}”.
              </li>
            )}
            {filtered.map((s, i) => {
              const isSelected = s.id === value;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    id={`${listboxId}-opt-${i}`}
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => setActiveIdx(i)}
                    onClick={() => commit(s.id)}
                    className={`flex w-full items-baseline justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                      i === active ? "bg-panel-2 text-paper" : "text-muted hover:bg-panel-2 hover:text-paper"
                    } ${isSelected ? "font-medium" : ""}`}
                  >
                    <span className="min-w-0 truncate">{s.name}</span>
                    <span className="shrink-0 font-mono text-[10px] tabular-nums text-faint">
                      {s.juryRank != null ? `#${s.juryRank}` : s.id}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
