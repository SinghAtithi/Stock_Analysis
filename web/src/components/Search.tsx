"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { SearchResult } from "@/lib/types";
import { Search as SearchIcon } from "lucide-react";

interface Props {
  onSelect: (r: SearchResult) => void;
}

export default function Search({ onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const resultsRef = useRef<SearchResult[]>([]);
  const activeRef = useRef(0);

  useEffect(() => {
    resultsRef.current = results;
    activeRef.current = active;
  }, [results, active]);

  const runSearch = useCallback(async (q: string) => {
    abortRef.current?.abort();
    if (q.trim().length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    const ac = new AbortController();
    abortRef.current = ac;
    setSearching(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
        signal: ac.signal,
      });
      const data = await res.json();
      if (!ac.signal.aborted) {
        setResults(data.results ?? []);
        setActive(0);
        setOpen(true);
      }
    } catch {
      /* aborted */
    } finally {
      if (!ac.signal.aborted) setSearching(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => runSearch(query), 150);
    return () => clearTimeout(t);
  }, [query, runSearch]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement !== inputRef.current) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pick = (r: SearchResult) => {
    onSelect(r);
    setQuery("");
    setResults([]);
    setOpen(false);
    inputRef.current?.blur();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const items = resultsRef.current;
    if (e.key === "ArrowDown" && items.length) {
      e.preventDefault();
      setActive((a) => (a + 1) % items.length);
    } else if (e.key === "ArrowUp" && items.length) {
      e.preventDefault();
      setActive((a) => (a - 1 + items.length) % items.length);
    } else if (e.key === "Enter" && items.length) {
      e.preventDefault();
      pick(items[activeRef.current]);
    }
  };

  return (
    <div className="relative w-full">
      <div className="flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-2 shadow-sm transition-colors focus-within:border-line-strong focus-within:shadow-md">
        <SearchIcon size={16} className="shrink-0 text-faint" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKeyDown}
          placeholder="Search symbol or company"
          className="w-full bg-transparent text-sm text-paper placeholder:text-faint outline-none"
          autoComplete="off"
          spellCheck={false}
          aria-label="Search Indian stocks"
          role="combobox"
          aria-expanded={open}
          aria-controls="search-results"
          aria-activedescendant={
            open && results.length > 0 ? `search-opt-${active}` : undefined
          }
          aria-autocomplete="list"
        />
        <kbd className="hidden select-none rounded-full border border-line bg-panel-2 px-2 py-0.5 font-mono text-[10px] leading-none text-faint sm:block">
          /
        </kbd>
      </div>

      {open && (
        <div
          id="search-results"
          role="listbox"
          aria-label="Search results"
          className="absolute inset-x-0 top-full z-50 mt-2 overflow-hidden rounded-2xl border border-line bg-surface shadow-md"
        >
          {searching && results.length === 0 && (
            <div role="status" className="px-4 py-3 text-sm text-faint">
              Searching NSE · BSE…
            </div>
          )}
          {!searching && results.length === 0 && (
            <div className="px-4 py-3 text-sm text-faint">No match for “{query}”</div>
          )}
          <ul className="max-h-72 overflow-y-auto py-1">
            {results.map((r, i) => {
              const hint = [r.sector, r.indices?.[0]].filter(Boolean).join(" · ");
              const q = query.trim().toUpperCase();
              const at = r.symbol.toUpperCase().indexOf(q);
              return (
                <li key={`${r.exchange}-${r.symbol}`} role="none">
                  <button
                    id={`search-opt-${i}`}
                    role="option"
                    aria-selected={i === active}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(r)}
                    className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors ${i === active ? "bg-panel-2" : "hover:bg-canvas"}`}
                  >
                    <span className="min-w-0 truncate text-sm">
                      <span className="font-medium text-paper">
                        {at >= 0 ? (
                          <>
                            {r.symbol.slice(0, at)}
                            <span className="underline decoration-paper/30 underline-offset-2">{r.symbol.slice(at, at + q.length)}</span>
                            {r.symbol.slice(at + q.length)}
                          </>
                        ) : (
                          r.symbol
                        )}
                      </span>
                      <span className="ml-2 text-muted">{r.name}</span>
                      {hint && <span className="ml-2 hidden text-xs text-faint sm:inline">· {hint}</span>}
                    </span>
                    <span className="shrink-0 rounded-full border border-line bg-surface px-2 py-0.5 font-mono text-[10px] leading-none text-faint">{r.exchange}</span>
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
