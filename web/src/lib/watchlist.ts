"use client";

export interface WatchlistEntry {
  symbol: string;
  name: string;
  shortName: string;
  exchange: string;
  type: string;
  sector: string;
}

export const WATCHLIST_KEY = "niftyterm.watchlist";
export const WATCHLIST_EVENT = "niftyterm:watchlist";

export const DEFAULT_WATCHLIST: WatchlistEntry[] = [
  { symbol: "RELIANCE", name: "Reliance Industries", shortName: "RELIANCE", exchange: "NSE", type: "Equity", sector: "" },
  { symbol: "TCS", name: "Tata Consultancy Services", shortName: "TCS", exchange: "NSE", type: "Equity", sector: "" },
  { symbol: "HDFCBANK", name: "HDFC Bank", shortName: "HDFCBANK", exchange: "NSE", type: "Equity", sector: "" },
  { symbol: "INFY", name: "Infosys", shortName: "INFY", exchange: "NSE", type: "Equity", sector: "" },
  { symbol: "TATAMOTORS", name: "Tata Motors", shortName: "TATAMOTORS", exchange: "NSE", type: "Equity", sector: "" },
  { symbol: "NIFTY 50", name: "NIFTY 50", shortName: "NIFTY 50", exchange: "NSE", type: "Index", sector: "" },
  { symbol: "SENSEX", name: "S&P BSE Sensex", shortName: "SENSEX", exchange: "BSE", type: "Index", sector: "" },
];

const isEntry = (x: unknown): x is WatchlistEntry =>
  typeof x === "object" &&
  x !== null &&
  typeof (x as WatchlistEntry).symbol === "string" &&
  (x as WatchlistEntry).symbol.length > 0 &&
  typeof (x as WatchlistEntry).exchange === "string" &&
  (x as WatchlistEntry).exchange.length > 0;

const normalize = (e: WatchlistEntry): WatchlistEntry => ({
  symbol: e.symbol,
  name: typeof e.name === "string" && e.name ? e.name : e.symbol,
  shortName: typeof e.shortName === "string" && e.shortName ? e.shortName : e.symbol,
  exchange: e.exchange,
  type: typeof e.type === "string" && e.type ? e.type : "Equity",
  sector: typeof e.sector === "string" ? e.sector : "",
});

const keyOf = (e: WatchlistEntry) => `${e.exchange}|${e.symbol}`;

const unique = (list: WatchlistEntry[]): WatchlistEntry[] => {
  const seen = new Set<string>();
  return list.filter((e) => {
    const k = keyOf(e);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

const parseRaw = (raw: string): WatchlistEntry[] => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_WATCHLIST;
    const valid = parsed.filter(isEntry).map(normalize);
    if (valid.length === 0 && parsed.length > 0) return DEFAULT_WATCHLIST;
    return unique(valid);
  } catch {
    return DEFAULT_WATCHLIST;
  }
};

const read = (): WatchlistEntry[] => {
  if (typeof window === "undefined") return DEFAULT_WATCHLIST;
  try {
    const raw = window.localStorage.getItem(WATCHLIST_KEY);
    if (raw === null) return DEFAULT_WATCHLIST;
    return parseRaw(raw);
  } catch {
    return DEFAULT_WATCHLIST;
  }
};

/* stable snapshots for useSyncExternalStore — same reference while storage unchanged */
let snapshotRaw: string | null = null;
let snapshotList: WatchlistEntry[] = DEFAULT_WATCHLIST;

export function getWatchlistSnapshot(): WatchlistEntry[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(WATCHLIST_KEY);
  } catch {
    raw = null;
  }
  if (raw === snapshotRaw) return snapshotList;
  snapshotRaw = raw;
  snapshotList = raw === null ? DEFAULT_WATCHLIST : parseRaw(raw);
  return snapshotList;
}

export function getServerWatchlistSnapshot(): WatchlistEntry[] {
  return DEFAULT_WATCHLIST;
}

const write = (list: WatchlistEntry[]): void => {
  const json = JSON.stringify(list);
  snapshotList = list;
  try {
    window.localStorage.setItem(WATCHLIST_KEY, json);
    snapshotRaw = json;
  } catch {
    /* quota / private mode — keep in-memory only */
  }
  window.dispatchEvent(new CustomEvent(WATCHLIST_EVENT));
};

export function loadWatchlist(): WatchlistEntry[] {
  return read();
}

export function addToWatchlist(entry: WatchlistEntry): void {
  if (typeof window === "undefined") return;
  write(unique([...read(), entry]));
}

export function removeFromWatchlist(symbol: string, exchange: string): void {
  if (typeof window === "undefined") return;
  write(read().filter((e) => !(e.symbol === symbol && e.exchange === exchange)));
}

/** TASK-83 undo: restore an entry to its original position. Any current
 *  occurrence is replaced first (undo-after-re-add can't duplicate), the
 *  index clamps to bounds so concurrent edits can't throw. */
export function insertWatchlistAt(entry: WatchlistEntry, index: number): void {
  if (typeof window === "undefined") return;
  const list = read().filter((e) => !(e.symbol === entry.symbol && e.exchange === entry.exchange));
  const i = Math.max(0, Math.min(index, list.length));
  list.splice(i, 0, normalize(entry));
  write(list);
}

export function isInWatchlist(entry: Pick<WatchlistEntry, "symbol" | "exchange">): boolean {
  if (typeof window === "undefined") return false;
  return read().some((e) => e.symbol === entry.symbol && e.exchange === entry.exchange);
}

export function exportWatchlist(): string {
  return JSON.stringify(read(), null, 2);
}

/* TASK-726: validate + normalize an import payload without touching
   storage, so the UI can preview a count before asking for confirmation. */
export function parseImport(json: string): WatchlistEntry[] | null {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return null;
    const valid = unique(parsed.filter(isEntry).map(normalize));
    if (valid.length === 0) return null;
    return valid;
  } catch {
    return null;
  }
}

/* TASK-726: import REPLACES the watchlist by default — export→edit→import
   must honor removals; "merge" keeps the old union behavior for consumers
   who explicitly opt in. Returns how many entries were written. */
export function applyImport(
  entries: WatchlistEntry[],
  mode: "replace" | "merge" = "replace",
): number {
  const valid = unique(entries.filter(isEntry).map(normalize));
  if (valid.length === 0) return 0;
  if (mode === "merge") {
    write(unique([...read(), ...valid]));
  } else {
    write(valid);
  }
  return valid.length;
}

export function importWatchlist(
  json: string,
  mode: "replace" | "merge" = "replace",
): number {
  const entries = parseImport(json);
  return entries ? applyImport(entries, mode) : -1;
}

/** Union-merge cloud-mirror entries into localStorage (TASK-62). Existing
 *  local entries win conflicts; matching is by exchange|symbol. Returns how
 *  many entries were actually added (0 when nothing changed). */
export function mergeIntoWatchlist(incoming: WatchlistEntry[]): number {
  if (typeof window === "undefined") return 0;
  const valid = unique(incoming.filter(isEntry).map(normalize));
  if (valid.length === 0) return 0;
  const current = read();
  const have = new Set(current.map(keyOf));
  const fresh = valid.filter((e) => !have.has(keyOf(e)));
  if (fresh.length === 0) return 0;
  write(unique([...current, ...fresh]));
  return fresh.length;
}

export function subscribeWatchlist(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (e: StorageEvent) => {
    if (e.key === WATCHLIST_KEY || e.key === null) cb();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(WATCHLIST_EVENT, cb as EventListener);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(WATCHLIST_EVENT, cb as EventListener);
  };
}
