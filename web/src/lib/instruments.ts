import instruments from "@/data/instruments.json" with { type: "json" };

/* Yahoo index tickers differ from exchange names (NIFTY 50 != ^NSEI).
   Shared by the chart layer (marketData.ts) and anything resolving index
   symbols; unknown names fall back to the generic caret. Verified tickers
   only (see docs/task-reports/TASK-UI-01.md). */
export const INDEX_MAP: Record<string, string> = {
  "NIFTY 50": "^NSEI",
  NIFTY: "^NSEI",
  SENSEX: "^BSESN",
  BANKNIFTY: "^NSEBANK",
  "NIFTY BANK": "^NSEBANK",
  "NIFTY FIN SERVICE": "^NIFTY_FIN_SERVICE",
  FINNIFTY: "^NIFTY_FIN_SERVICE",
  "INDIA VIX": "^INDIAVIX",
  "NIFTY MIDCAP 100": "^NSEMDCP50",
  "NIFTY NEXT 50": "^NSENEXT50",
};

export interface Instrument {
  s: string;
  n: string;
  e: string;
  sec?: string;
  ind?: string;
  idx?: string[];
}

const LIST = instruments as Instrument[];

/* Index detection shared by search, /api/instruments and watchlist mirroring.
   Symbol tokens alone misfiled 63 BSE indices whose symbols are opaque
   (AUTO, 200EQW, BANKEX, TECK — TASK-997): their listing names carry the
   "BSE " prefix instead. BSE LIMITED is the exchange's own listed stock,
   not an index. Name matching stays prefix-only on purpose — token-matching
   names would misfile ETFs like "DSP Nifty Bank ETF" as indices. */
export const INDEX_SYMBOL_RE =
  /(NIFTY|SENSEX|INDIA VIX|BANKNIFTY|FINNIFTY|MIDCAP|SME|INDIA 10)/;

export function isIndexSymbol(symbol: string, name?: string): boolean {
  if (INDEX_SYMBOL_RE.test(symbol.toUpperCase())) return true;
  if (!name) return false;
  const n = name.toUpperCase();
  return n.startsWith("BSE ") && !n.startsWith("BSE LIMITED");
}

export interface SearchHit {
  symbol: string;
  name: string;
  exchange: string;
  isIndex: boolean;
  sector?: string;
  industry?: string;
  indices?: string[];
}

export function searchInstruments(q: string, limit = 8): SearchHit[] {
  const needle = q.trim().toUpperCase();
  if (needle.length < 2) return [];

  const scored: { hit: SearchHit; score: number }[] = [];
  const max = 1200;

  for (let i = 0; i < LIST.length; i++) {
    const inst = LIST[i];
    const sym = inst.s;
    const name = inst.n.toUpperCase();
    let score = -1;

    if (sym === needle) score = 0;
    else if (sym.startsWith(needle)) score = 1;
    else if (name === needle) score = 2;
    else if (name.startsWith(needle)) score = 3;
    else if (sym.includes(needle)) score = 4;
    else if (name.includes(needle) && needle.length >= 3) score = 5;

    if (score >= 0) {
      const hit: SearchHit = {
        symbol: sym,
        name: inst.n,
        exchange: inst.e,
        isIndex: isIndexSymbol(sym, inst.n),
      };
      if (inst.sec) hit.sector = inst.sec;
      if (inst.ind) hit.industry = inst.ind;
      if (inst.idx?.length) hit.indices = inst.idx;
      scored.push({ hit, score });
      if (scored.length >= max) break;
    }
  }

  scored.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    if (a.hit.exchange !== b.hit.exchange) return a.hit.exchange === "NSE" ? -1 : 1;
    return a.hit.symbol.localeCompare(b.hit.symbol);
  });

  return scored.slice(0, limit).map((x) => x.hit);
}

export function findInstrument(symbol: string): Instrument | undefined {
  return LIST.find((i) => i.s === symbol);
}

/* Exact symbol+exchange listing first, else the first listing of the symbol
   (dual-listed names like SENSEX exist under both NSE and BSE). Used by the
   watchlist mirror route to validate client-supplied entries. */
export function findInstrumentListing(
  symbol: string,
  exchange: string
): Instrument | undefined {
  const exact = LIST.find((i) => i.s === symbol && i.e === exchange);
  if (exact) return exact;
  return LIST.find((i) => i.s === symbol);
}
