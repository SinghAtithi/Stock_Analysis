"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { SearchResult } from "@/lib/types";
import { Search as SearchIcon } from "lucide-react";
import { track } from "@/lib/analytics";

interface Props {
  onSelect: (r: SearchResult) => void;
}

/* TASK-79: first-time users shouldn't face a dead input. Popular picks use
   the app's canonical shapes (page.tsx FALLBACK_ENTRY convention); recents
   are a light capture in localStorage — deeper recents UX is TASK-229. */
const POPULAR: SearchResult[] = [
  { symbol: "NIFTY 50", name: "NIFTY 50", shortName: "NIFTY 50", exchange: "NSE", type: "Index", sector: "" },
  { symbol: "SENSEX", name: "SENSEX", shortName: "SENSEX", exchange: "BSE", type: "Index", sector: "" },
  { symbol: "RELIANCE", name: "Reliance Industries", shortName: "RELIANCE", exchange: "NSE", type: "Equity", sector: "Energy Minerals" },
  { symbol: "TCS", name: "Tata Consultancy Services", shortName: "TCS", exchange: "NSE", type: "Equity", sector: "Technology Services" },
];

const RECENTS_KEY = "nifty.searchRecents";
const RECENTS_MAX = 4;

function readRecents(): SearchResult[] {
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is SearchResult =>
        !!r && typeof r === "object" &&
        typeof (r as SearchResult).symbol === "string" &&
        typeof (r as SearchResult).exchange === "string",
    );
  } catch {
    return [];
  }
}

function saveRecent(r: SearchResult): void {
  try {
    const rest = readRecents().filter(
      (x) => !(x.symbol === r.symbol && x.exchange === r.exchange),
    );
    window.localStorage.setItem(
      RECENTS_KEY,
      JSON.stringify([r, ...rest].slice(0, RECENTS_MAX)),
    );
  } catch {
    /* private mode / quota — recents are best-effort */
  }
}

export default function Search({ onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [recents, setRecents] = useState<SearchResult[]>([]);
  const focusedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const resultsRef = useRef<SearchResult[]>([]);
  const activeRef = useRef(0);

  useEffect(() => {
    resultsRef.current = results;
    activeRef.current = active;
  }, [results, active]);

  useEffect(() => {
    const el = document.getElementById(`search-opt-${active}`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const runSearch = useCallback(async (q: string) => {
    abortRef.current?.abort();
    if (q.trim().length < 1) {
      setResults([]);
      /* TASK-79: empty+focused shows suggestions — but not on page load */
      if (focusedRef.current) {
        setRecents(readRecents());
        setOpen(true);
      }
      return;
    }
    const ac = new AbortController();
    abortRef.current = ac;
    setSearching(true);
    setSearchError(false);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
        signal: ac.signal,
      });
      const data = await res.json();
      if (!ac.signal.aborted) {
        setResults(data.results ?? []);
        setActive(0);
        setOpen(true);
        setSearchError(false);
      }
    } catch (e) {
      /* TASK-153: aborts stay silent — genuine failures surface a retry state */
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        if (!ac.signal.aborted) {
          setResults([]);
          setSearchError(true);
          setOpen(focusedRef.current);
        }
      }
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
    saveRecent(r);
    track("search_select", r.symbol);
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
          onFocus={() => {
            focusedRef.current = true;
            setRecents(readRecents());
            setOpen(true);
          }}
          onBlur={() => {
            focusedRef.current = false;
            setTimeout(() => setOpen(false), 150);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search symbol or company"
          className="w-full bg-transparent text-sm text-paper placeholder:text-faint outline-none"
          autoComplete="off"
          spellCheck={false}
          aria-label="Search Indian stocks"
          role="combobox"
          aria-expanded={open}
          aria-controls={query.trim().length === 0 ? "search-suggestions" : "search-results"}
          aria-activedescendant={
            open && results.length > 0 ? `search-opt-${active}` : undefined
          }
          aria-autocomplete="list"
        />
        <kbd className="hidden select-none rounded-full border border-line bg-panel-2 px-2 py-0.5 font-mono text-[10px] leading-none text-faint sm:block">
          /
        </kbd>
      </div>

      {open && query.trim().length === 0 && (
        <div
          id="search-suggestions"
          aria-label="Search suggestions"
          className="absolute inset-x-0 top-full z-50 mt-2 overflow-hidden rounded-2xl border border-line bg-surface shadow-md"
        >
          {recents.length > 0 && (
            <>
              <p className="px-4 pt-3 pb-1 text-xs font-medium tracking-wide text-faint">Recent</p>
              <ul className="py-1">
                {recents.map((r) => (
                  <li key={`recent-${r.exchange}-${r.symbol}`}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pick(r)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-canvas"
                    >
                      <span className="min-w-0 truncate text-sm">
                        <span className="font-medium text-paper">{r.symbol}</span>{" "}
                        <span className="ml-2 text-muted">{r.name}</span>
                      </span>
                      <span className="shrink-0 rounded-full border border-line bg-surface px-2 py-0.5 font-mono text-[10px] leading-none text-faint">{r.exchange}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="px-4 pt-3 pb-1 text-xs font-medium tracking-wide text-faint">
            {recents.length > 0 ? "Popular" : "Try one of these"}
          </p>
          <ul className="py-1 pb-2">
            {POPULAR.map((r) => (
              <li key={`popular-${r.exchange}-${r.symbol}`}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(r)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-canvas"
                >
                  <span className="min-w-0 truncate text-sm">
                    <span className="font-medium text-paper">{r.symbol}</span>{" "}
                    <span className="ml-2 text-muted">{r.name}</span>
                  </span>
                  <span className="shrink-0 rounded-full border border-line bg-surface px-2 py-0.5 font-mono text-[10px] leading-none text-faint">{r.type}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {open && query.trim().length > 0 && (
        <div
          id="search-results"
          role="listbox"
          aria-label="Search results"
          tabIndex={0}
          className="absolute inset-x-0 top-full z-50 mt-2 max-h-72 overflow-y-auto rounded-2xl border border-line bg-surface shadow-md"
        >
          {searching && results.length === 0 && (
            <div role="status" className="px-4 py-3 text-sm text-faint">
              Searching NSE · BSE…
            </div>
          )}
          {/* TASK-153: genuine failures get their own state + retry — the
              spinner must never be the only thing a user ever sees */}
          {searchError && !searching && (
            <div className="px-4 py-3 text-sm">
              <p role="alert" className="text-muted">
                Couldn’t search — check your connection.
              </p>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setSearchError(false);
                  void runSearch(query);
                }}
                className="mt-2 rounded-full border border-line bg-surface px-3 py-1 text-xs text-muted transition-colors hover:text-paper"
              >
                Retry
              </button>
            </div>
          )}
          {!searching && !searchError && results.length === 0 && (
            <div className="px-4 py-3 text-sm text-faint">No match for “{query}”</div>
          )}
          {results.map((r, i) => {
              const hint = [r.sector, r.indices?.[0]].filter(Boolean).join(" · ");
              const q = query.trim().toUpperCase();
              const at = r.symbol.toUpperCase().indexOf(q);
              return (
                /* option directly under listbox — intermediate ul/li wrappers
                   sever the required option/listbox a11y ancestry (TASK-79) */
                <div
                  key={`${r.exchange}-${r.symbol}`}
                  role="option"
                  id={`search-opt-${i}`}
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(r)}
                  className={`flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors ${i === active ? "bg-panel-2" : "hover:bg-canvas"}`}
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
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
