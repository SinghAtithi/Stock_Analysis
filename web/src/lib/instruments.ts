import instruments from "@/data/instruments.json";

export interface Instrument {
  s: string;
  n: string;
  e: string;
  sec?: string;
  ind?: string;
  idx?: string[];
}

const LIST = instruments as Instrument[];

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
        isIndex: /(NIFTY|SENSEX|INDIA VIX|BANKNIFTY|FINNIFTY|MIDCAP|SME|INDIA 10)/.test(
          sym
        ),
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
