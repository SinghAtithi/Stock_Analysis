"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

interface StrategyOption {
  id: string;
  name: string;
  subtitle: string;
  category: string;
  juryRank: number | null;
  edgeScore: number | null;
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
        className="flex max-w-[220px] items-center gap-1.5 rounded-lg bg-paper px-3.5 py-1.5 text-sm font-medium text-ink shadow-sm transition-colors hover:bg-accent sm:max-w-none"
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
                  <div
                    className={`flex items-center gap-1.5 rounded-lg px-3 py-2 transition-colors ${
                      i === active ? "bg-panel-2" : "hover:bg-panel-2"
                    }`}
                  >
                    <button
                      type="button"
                      id={`${listboxId}-opt-${i}`}
                      role="option"
                      aria-selected={isSelected}
                      onMouseEnter={() => setActiveIdx(i)}
                      onClick={() => commit(s.id)}
                      className={`min-w-0 flex-1 text-left text-sm transition-colors ${
                        isSelected ? "font-medium text-paper" : "text-muted hover:text-paper"
                      }`}
                    >
                      {/* TASK-232: opaque ids mean nothing to a retail user —
                          card shows id · plain-English subtitle · jury rank */}
                      <span className="block truncate">{s.name}</span>
                      <span className="block truncate font-mono text-[10px] tabular-nums text-faint">
                        {s.id} · {s.subtitle}
                        {s.juryRank != null ? ` · Jury #${s.juryRank}` : ""}
                      </span>
                    </button>
                    <span className="group relative shrink-0">
                      <button
                        type="button"
                        aria-label={`About ${s.name}`}
                        aria-describedby={`${listboxId}-tip-${i}`}
                        onMouseEnter={() => setActiveIdx(i)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            setOpen(false);
                            inputRef.current?.focus();
                          }
                        }}
                        className="grid h-6 w-6 place-items-center rounded-full border border-line bg-surface text-[11px] font-medium text-muted transition-colors hover:border-line-strong hover:text-paper focus-visible:outline-2 focus-visible:outline-accent"
                      >
                        i
                      </button>
                      {/* native tooltip: opens on hover and on keyboard focus
                          (focus-within covers Tab focus), no JS state */}
                      <span
                        id={`${listboxId}-tip-${i}`}
                        role="tooltip"
                        className="pointer-events-none absolute right-0 top-full z-40 mt-1.5 w-60 rounded-lg border border-line bg-panel-2 px-3 py-2 text-xs leading-relaxed text-muted opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
                      >
                        {s.juryRank != null ? `Jury #${s.juryRank} · Edge ${s.edgeScore ?? "—"}/10` : "Unranked — no jury verdict yet"}
                        {" · "}
                        {s.category}
                      </span>
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
