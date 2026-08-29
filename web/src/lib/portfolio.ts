/* TASK-1378 — portfolio x-ray: tolerant broker-CSV parsing, sector/cap
   concentration, Nifty-50 overlap and factor-exposure math. Pure functions —
   instrument metadata is injected by the caller (web/src/lib/instruments),
   so this module stays free of the instruments.json bundle. Holdings live in
   localStorage under PORTFOLIO_KEY and are never uploaded. */

export const PORTFOLIO_KEY = "niftyterm.portfolio";

export interface HoldingRow {
  /** Canonical uppercase symbol, exchange suffix stripped. */
  symbol: string;
  qty: number;
  avgPrice: number;
  /** qty * avgPrice — invested value, the weight used by every aggregation. */
  value: number;
}

export interface ParseIssue {
  /** 1-based source line number. */
  line: number;
  reason: string;
}

export interface CsvParseResult {
  /** Deduplicated holdings (same symbol merged, weighted avg price). */
  holdings: HoldingRow[];
  /** Rows that could not be parsed, with reasons. */
  skipped: ParseIssue[];
  /** Header cells as found (first record), lowercased/trimmed. */
  headers: string[];
  /** Column groups not detected: "symbol" | "qty" | "price". */
  missing: string[];
  /** True when the first record matched no known header names. */
  headerless: boolean;
  /** Lines ignored because they were blank. */
  blankLines: number;
}

/* ---------- CSV plumbing ---------- */

/** Whole-text record splitter: quoted fields may contain commas, escaped
 * quotes and even newlines; CRLF is tolerated. Produces final cells. */
function splitCsvRecords(text: string): string[][] {
  const records: string[][] = [];
  let cells: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cells.push(cell);
      cell = "";
    } else if (ch === "\n") {
      cells.push(cell);
      cell = "";
      records.push(cells);
      cells = [];
    } else if (ch === "\r") {
      /* skipped — records end at \n */
    } else {
      cell += ch;
    }
  }
  cells.push(cell);
  if (cells.length > 1 || cells[0].trim() !== "") records.push(cells);
  return records;
}

/* ---------- column detection ---------- */

/** Normalize a header cell: lowercase, punctuation → space, collapse. */
export function normalizeHeader(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const SYMBOL_HEADERS = [
  "symbol",
  "symbol name",
  "trading symbol",
  "tradingsymbol",
  "scrip",
  "instrument",
  "security",
];

const QTY_HEADERS = [
  "qty",
  "quantity",
  "shares",
  "no of shares",
  "units",
  "holdings",
  "count",
];

/** Price column: anything starting with "avg" or "average", or a bare "avg". */
function isPriceHeader(norm: string): boolean {
  if (norm === "avg" || norm === "average") return true;
  if (norm.startsWith("avg ") || norm.startsWith("average ")) return true;
  if (norm === "net avg" || norm.startsWith("net avg ")) return true;
  if (norm === "buy avg" || norm.startsWith("buy avg ")) return true;
  return false;
}

function findColumn(headers: string[], aliases: string[]): number {
  for (const alias of aliases) {
    const idx = headers.indexOf(alias);
    if (idx >= 0) return idx;
  }
  return -1;
}

/* ---------- cell parsing ---------- */

/** Strip ₹/Rs, thousands separators, currency noise from a numeric cell. */
export function parseNumeric(raw: string): number | null {
  const cleaned = raw
    .replace(/[₹Rs,\s]/gi, "")
    .replace(/["']/g, "")
    .replace(/\*+$/g, "")
    .trim();
  if (cleaned === "" || cleaned === "-" || cleaned === "nil" || cleaned === "na") {
    return null;
  }
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Normalize a broker symbol: uppercase, strip NSE/BSE prefixes and
 * .NS/.BO/.NSE/.BSE/-EQ/-BE/-BL/-SM suffixes. */
export function normalizeSymbol(raw: string): string {
  let s = raw.trim().toUpperCase();
  s = s.replace(/^(NSE|BSE)\s*[: ]/, "");
  s = s.replace(/\.(NS|NSE|BO|BSE)$/, "");
  s = s.replace(/-(EQ|BE|BL|SM)$/, "");
  return s.trim();
}

/* ---------- main parse ---------- */

/** Tolerant broker-CSV parse (Zerodha Kite, Groww, common variants). */
export function parsePortfolioCsv(text: string): CsvParseResult {
  const records = splitCsvRecords(text.replace(/^\uFEFF/, ""));
  const result: CsvParseResult = {
    holdings: [],
    skipped: [],
    headers: [],
    missing: [],
    headerless: false,
    blankLines: 0,
  };

  if (records.length === 0) return result;

  const first = records[0];
  const normHeaders = first.map(normalizeHeader);
  let symCol = findColumn(normHeaders, SYMBOL_HEADERS);
  let qtyCol = findColumn(normHeaders, QTY_HEADERS);
  let priceCol = -1;
  for (let i = 0; i < normHeaders.length; i++) {
    if (isPriceHeader(normHeaders[i])) {
      priceCol = i;
      break;
    }
  }

  let start = 1;
  if (symCol < 0 && qtyCol < 0 && priceCol < 0) {
    /* headerless file — assume positional symbol, qty, price */
    result.headerless = true;
    symCol = 0;
    qtyCol = 1;
    priceCol = 2;
    start = 0;
    result.headers = first.map(normalizeHeader);
  } else {
    result.headers = normHeaders;
    if (symCol < 0) result.missing.push("symbol");
    if (qtyCol < 0) result.missing.push("qty");
    if (priceCol < 0) result.missing.push("price");
    if (symCol < 0 && qtyCol >= 0 && priceCol >= 0) {
      /* symbol column absent but qty+price known — fall back to first col */
      symCol = 0;
    }
  }

  const merged = new Map<string, HoldingRow>();

  const pushIssue = (line: number, reason: string) => {
    result.skipped.push({ line, reason });
  };

  for (let r = start; r < records.length; r++) {
    const cells = records[r];
    if (cells.length === 1 && cells[0].trim() === "") {
      result.blankLines++;
      continue;
    }
    const lineNo = r + 1;
    const symRaw = (cells[symCol] ?? "").trim();
    const symbol = normalizeSymbol(symRaw);
    if (!symbol) {
      pushIssue(lineNo, "No symbol");
      continue;
    }
    const qty = parseNumeric(cells[qtyCol] ?? "");
    if (qty === null || qty <= 0) {
      pushIssue(lineNo, `Quantity "${(cells[qtyCol] ?? "").trim()}" is not a positive number`);
      continue;
    }
    const price = parseNumeric(cells[priceCol] ?? "");
    if (price === null || price < 0) {
      pushIssue(lineNo, `Price "${(cells[priceCol] ?? "").trim()}" is not a number`);
      continue;
    }
    const value = qty * price;
    const prev = merged.get(symbol);
    if (prev) {
      const totalQty = prev.qty + qty;
      prev.qty = totalQty;
      prev.avgPrice = (prev.value + value) / totalQty;
      prev.value = prev.value + value;
    } else {
      merged.set(symbol, { symbol, qty, avgPrice: price, value });
    }
  }

  result.holdings = [...merged.values()].sort((a, b) => b.value - a.value);
  return result;
}

/* ---------- instrument metadata injection ---------- */

export interface InstrumentMeta {
  sector?: string;
  idx?: string[];
}

export type MetaResolver = (symbol: string) => InstrumentMeta | null;

/* ---------- cap classification (index-based) ---------- */

export type CapBucket = "Large" | "Mid" | "Small" | "Not classified";

/** Approximate cap from Nifty index membership — Large wins over Mid over
 * Small when a stock is listed in several indices. Honest label: this is an
 * index-membership proxy, not a market-cap figure. */
export function classifyCap(idx: string[] | undefined): CapBucket {
  if (!idx || idx.length === 0) return "Not classified";
  if (idx.includes("NIFTY 50") || idx.includes("NIFTY NEXT 50")) return "Large";
  if (idx.includes("NIFTY MIDCAP 150") || idx.includes("NIFTY MIDCAP 100")) return "Mid";
  if (idx.includes("NIFTY SMALLCAP 250") || idx.includes("NIFTY SMALLCAP 50")) return "Small";
  return "Not classified";
}

/* ---------- concentration ---------- */

export interface Slice {
  label: string;
  /** Share of the denominator, 0..1. */
  pct: number;
  value: number;
}

export interface Concentration {
  /** Top 5 sectors by value + "Other"; sorted desc. */
  sectors: Slice[];
  /** Herfindahl–Hirschman index over the full sector distribution, 0..1. */
  hhi: number;
  topSector: Slice | null;
  verdict: "Diversified" | "Concentrated";
  caps: Slice[];
  /** Resolved holdings count, and value those slices are built over. */
  matchedValue: number;
  /** Symbols that resolved to no instrument (excluded from sector/cap). */
  unmatched: string[];
}

/** Herfindahl threshold: DOJ-style, >= 0.25 = concentrated market. */
export const CONCENTRATED_HHI = 0.25;
/** How many sector slices the donut shows before folding into "Other". */
export const TOP_SLICES = 5;

function toSlices(groups: Map<string, number>, total: number): Slice[] {
  const slices: Slice[] = [];
  for (const [label, value] of groups) {
    slices.push({ label, value, pct: total > 0 ? value / total : 0 });
  }
  return slices.sort((a, b) => b.value - a.value);
}

export function computeConcentration(
  holdings: HoldingRow[],
  resolve: MetaResolver,
): Concentration {
  const sectorValue = new Map<string, number>();
  const capValue = new Map<string, number>();
  const unmatched: string[] = [];
  let matchedValue = 0;

  for (const h of holdings) {
    const meta = resolve(h.symbol);
    if (!meta) {
      unmatched.push(h.symbol);
      continue;
    }
    matchedValue += h.value;
    const sector = meta.sector ?? "Unknown sector";
    sectorValue.set(sector, (sectorValue.get(sector) ?? 0) + h.value);
    const cap = classifyCap(meta.idx);
    capValue.set(cap, (capValue.get(cap) ?? 0) + h.value);
  }

  let hhi = 0;
  for (const v of sectorValue.values()) {
    if (matchedValue > 0) hhi += (v / matchedValue) * (v / matchedValue);
  }

  const allSectors = toSlices(sectorValue, matchedValue);
  const shown = allSectors.slice(0, TOP_SLICES);
  const restValue = allSectors.slice(TOP_SLICES).reduce((a, s) => a + s.value, 0);
  const sectors: Slice[] =
    restValue > 0
      ? [...shown, { label: "Other", value: restValue, pct: matchedValue > 0 ? restValue / matchedValue : 0 }]
      : shown;

  return {
    sectors,
    hhi,
    topSector: allSectors[0] ?? null,
    verdict: hhi >= CONCENTRATED_HHI ? "Concentrated" : "Diversified",
    caps: toSlices(capValue, matchedValue),
    matchedValue,
    unmatched,
  };
}

/* ---------- Nifty 50 overlap ---------- */

export interface NiftyOverlap {
  /** Value-weighted share of resolved holdings that are Nifty 50 members. */
  pct: number;
  nifty50Value: number;
  matchedValue: number;
  nifty50Count: number;
  matchedCount: number;
}

export const NIFTY50_INDEX = "NIFTY 50";

export function computeNiftyOverlap(
  holdings: HoldingRow[],
  resolve: MetaResolver,
): NiftyOverlap {
  let nifty50Value = 0;
  let matchedValue = 0;
  let nifty50Count = 0;
  let matchedCount = 0;
  for (const h of holdings) {
    const meta = resolve(h.symbol);
    if (!meta) continue;
    matchedValue += h.value;
    matchedCount++;
    if (meta.idx?.includes(NIFTY50_INDEX)) {
      nifty50Value += h.value;
      nifty50Count++;
    }
  }
  return {
    pct: matchedValue > 0 ? (nifty50Value / matchedValue) * 100 : 0,
    nifty50Value,
    matchedValue,
    nifty50Count,
    matchedCount,
  };
}

/* ---------- factor exposure ---------- */

export type FactorName = "momentum" | "value" | "quality" | "volatility";

export const FACTOR_STRATEGIES: Record<FactorName, string[]> = {
  momentum: ["S100", "S172", "S174", "demo-roc20", "demo-52wlow"],
  value: ["S099", "S076", "S078", "S080", "S081"],
  quality: ["S18-quality"],
  volatility: ["S101"],
};

export const FACTOR_LABELS: Record<FactorName, string> = {
  momentum: "Momentum",
  value: "Value",
  quality: "Quality",
  volatility: "Low volatility",
};

export interface FactorExposure {
  factor: FactorName;
  /** Value-weighted mean of symbol-level score percentiles, 0..100. */
  pct: number | null;
  /** Weight share of holdings with signal data, 0..1. */
  coverage: number;
  /** Latest signal snapshot timestamp across the factor's strategies. */
  asOf: number | null;
}

/** Per-factor, per-strategy signal score maps (symbol → raw 0..100 score as
 * served by /api/signals). Strategies with no rows simply don't contribute. */
export type FactorScores = Partial<Record<FactorName, Map<string, number>[]>>;

function percentileOf(score: number, sorted: number[]): number {
  const n = sorted.length;
  if (n <= 1) return 100;
  let lower = 0;
  for (const s of sorted) if (s < score) lower++;
  return (lower / (n - 1)) * 100;
}

/** Portfolio-level factor exposure: per symbol, average the percentile of
 * its score within each of the factor's strategy universes, then take the
 * value-weighted mean over holdings. Holdings without signal data are
 * excluded and reported through `coverage`. */
export function computeFactorExposure(
  holdings: HoldingRow[],
  scores: FactorScores,
  asOfByFactor: Partial<Record<FactorName, number | null>> = {},
): FactorExposure[] {
  const factors = Object.keys(FACTOR_STRATEGIES) as FactorName[];
  const totalValue = holdings.reduce((a, h) => a + h.value, 0);

  return factors.map((factor) => {
    const maps = scores[factor] ?? [];
    const nonEmpty = maps.filter((m) => m.size > 0);
    const asOf = asOfByFactor[factor] ?? null;
    if (nonEmpty.length === 0) {
      return { factor, pct: null, coverage: 0, asOf };
    }
    /* symbol → average percentile across the factor's strategies */
    const pctBySymbol = new Map<string, number[]>();
    for (const map of nonEmpty) {
      const sorted = [...map.values()].sort((a, b) => a - b);
      for (const [symbol, score] of map) {
        const arr = pctBySymbol.get(symbol) ?? [];
        arr.push(percentileOf(score, sorted));
        pctBySymbol.set(symbol, arr);
      }
    }
    let coveredValue = 0;
    let weighted = 0;
    for (const h of holdings) {
      const pcts = pctBySymbol.get(h.symbol);
      if (!pcts || pcts.length === 0) continue;
      const mean = pcts.reduce((a, p) => a + p, 0) / pcts.length;
      coveredValue += h.value;
      weighted += h.value * mean;
    }
    if (coveredValue === 0) {
      return { factor, pct: null, coverage: 0, asOf };
    }
    return {
      factor,
      pct: weighted / coveredValue,
      coverage: totalValue > 0 ? coveredValue / totalValue : 0,
      asOf,
    };
  });
}