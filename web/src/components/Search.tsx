"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { SearchResult } from "@/lib/types";

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
      <div className="group flex items-center gap-3 border border-hairline-strong bg-panel px-4 transition-colors duration-150 focus-within:border-paper">
        <span className="select-none font-mono text-[13px] text-up group-focus-within:animate-none cursor-blink">
          &gt;
        </span>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKeyDown}
          placeholder="SEARCH SYMBOL / NAME"
          className="w-full bg-transparent py-3.5 font-mono text-[13px] tracking-wider text-paper placeholder:text-faint outline-none"
          autoComplete="off"
          spellCheck={false}
          aria-label="Search Indian stocks"
        />
        <kbd className="hidden sm:block select-none border border-hairline px-1.5 py-0.5 font-mono text-[10px] text-faint">
          /
        </kbd>
      </div>

      {open && (
        <div className="absolute inset-x-0 top-full z-50 border border-t-0 border-hairline-strong bg-ink shadow-[0_24px_48px_-12px_rgba(0,0,0,0.8)] animate-fade-up">
          {searching && results.length === 0 && (
            <div className="px-4 py-3 font-mono text-[12px] text-faint animate-dot-pulse">
              scanning NSE · BSE…
            </div>
          )}
          {!searching && results.length === 0 && (
            <div className="px-4 py-3 font-mono text-[12px] text-faint">
              no match for “{query}”
            </div>
          )}
          <ul className="max-h-72 overflow-y-auto">
            {results.map((r, i) => (
              <li key={`${r.exchange}-${r.symbol}`}>
                <button
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(r)}
                  className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left font-mono transition-colors duration-75 ${
                    i === active ? "bg-up text-ink" : "text-paper"
                  }`}
                >
                  <span className="truncate text-[12px] tracking-wider">
                    {r.symbol}
                    <span className={i === active ? "text-ink/60" : "text-faint"}>
                      {"  "}{r.name}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 text-right font-mono ${
                      i === active ? "text-ink/60" : "text-faint"
                    }`}
                  >
                    <span className="block text-[10px] tracking-widest">
                      {r.exchange}
                    </span>
                    {r.sector && (
                      <span className="block truncate text-[10px] tracking-widest opacity-70">
                        {r.sector.toUpperCase()}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
