import type { RangeKey, SearchResult } from "@/lib/types";
import { stripExchangeSuffix } from "@/lib/instruments";
import { RANGES } from "@/lib/types";

/* TASK-1418 — shared helpers for /compare: symbol resolution, chart URL
   building, and direction-aware fundamentals comparison. */

export interface CompareSlot {
  symbol: string;
  name: string;
  shortName: string;
  exchange: string;
  type: string;
  sector: string;
}

export const toSlot = (r: SearchResult): CompareSlot => ({
  symbol: r.symbol,
  name: r.name,
  shortName: r.shortName || r.symbol,
  exchange: r.exchange,
  type: r.type,
  sector: r.sector ?? "",
});

/** Resolve a URL param (?a= / ?b=) to a full instrument via /api/instruments,
    mirroring the home page's resolveTarget (TASK-51 deep links). */
export async function resolveSlot(raw: string | null): Promise<CompareSlot | null> {
  if (!raw) return null;
  const { symbol, impliedExchange } = stripExchangeSuffix(raw);
  if (!symbol) return null;
  try {
    const res = await fetch(
      `/api/instruments?s=${encodeURIComponent(symbol)}${
        impliedExchange ? `&e=${encodeURIComponent(impliedExchange)}` : ""
      }`,
    );
    if (!res.ok) return null;
    const json = await res.json();
    const found = json.instrument as SearchResult | null;
    return found ? toSlot(found) : null;
  } catch {
    return null;
  }
}

export function chartUrl(slot: CompareSlot, rangeKey: RangeKey): string {
  const cfg = RANGES.find((x) => x.range === rangeKey) ?? RANGES[5];
  return `/api/chart?symbol=${encodeURIComponent(slot.symbol)}&exchange=${encodeURIComponent(
    slot.exchange,
  )}&type=${encodeURIComponent(slot.type)}&range=${cfg.range}&interval=${cfg.interval}`;
}

/* ---- fundamentals comparison ------------------------------------------- */

export interface FundMetrics {
  trailingPe: number | null;
  forwardPe: number | null;
  priceToBook: number | null;
  priceToSales: number | null;
  dividendYield: number | null;
  returnOnEquity: number | null;
  returnOnAssets: number | null;
  debtToEquity: number | null;
  currentRatio: number | null;
  grossMargin: number | null;
  operatingMargin: number | null;
  netMargin: number | null;
  marketCap: number | null;
  sector: string | null;
  industry: string | null;
}

export interface FundPayload {
  metrics: FundMetrics | null;
  meta: { as_of: string | null; source: string | null };
}

export type MetricDirection = "lower" | "higher" | "neutral";

export interface MetricDef {
  key: keyof FundMetrics;
  label: string;
  direction: MetricDirection;
  fmt: (v: number) => string;
}

const num = (v: number, digits = 2): string => v.toFixed(digits);
const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;
const cr = (v: number): string =>
  `₹${(v / 1e7).toLocaleString("en-IN", { maximumFractionDigits: 0 })} cr`;

/* Direction rules: lower is better for valuation/leverage multiples, higher
   for returns, margins and yields; market cap is size, not quality — neutral
   (no highlight) per task brief ("where direction is ambiguous, no highlight"). */
export const FUND_METRICS: MetricDef[] = [
  { key: "trailingPe", label: "P/E", direction: "lower", fmt: num },
  { key: "forwardPe", label: "Fwd P/E", direction: "lower", fmt: num },
  { key: "priceToBook", label: "P/B", direction: "lower", fmt: num },
  { key: "priceToSales", label: "P/S", direction: "lower", fmt: num },
  { key: "debtToEquity", label: "D/E", direction: "lower", fmt: num },
  { key: "currentRatio", label: "Current ratio", direction: "higher", fmt: num },
  { key: "returnOnEquity", label: "ROE", direction: "higher", fmt: pct },
  { key: "returnOnAssets", label: "ROA", direction: "higher", fmt: pct },
  { key: "grossMargin", label: "Gross margin", direction: "higher", fmt: pct },
  { key: "operatingMargin", label: "Op margin", direction: "higher", fmt: pct },
  { key: "netMargin", label: "Net margin", direction: "higher", fmt: pct },
  { key: "dividendYield", label: "Div yield", direction: "higher", fmt: pct },
  { key: "marketCap", label: "Market cap", direction: "neutral", fmt: cr },
];

export function metricValue(m: FundMetrics | null, key: keyof FundMetrics): number | null {
  if (!m) return null;
  const v = m[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Which side carries the better value for a metric — "a", "b", or null
    (tie, missing side, or direction-neutral). */
export function betterSide(
  a: number | null,
  b: number | null,
  direction: MetricDirection,
): "a" | "b" | null {
  if (direction === "neutral") return null;
  if (a === null || b === null || a === b) return null;
  const better = direction === "lower" ? Math.min(a, b) : Math.max(a, b);
  return better === a ? "a" : "b";
}

export const fmtFinite = (v: number | null, digits = 2): string =>
  v === null || !Number.isFinite(v) ? "—" : v.toFixed(digits);