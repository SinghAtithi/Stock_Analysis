export interface SearchResult {
  symbol: string;
  name: string;
  shortName: string;
  exchange: string;
  type: string;
  sector: string;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ChartData {
  symbol: string;
  currency: string;
  exchangeName: string;
  fullExchangeName: string;
  name: string;
  regularMarketPrice: number | null;
  regularMarketTime: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  change: number | null;
  changePct: number | null;
  range: string;
  interval: string;
  candles: Candle[];
  source: "yahoo" | "groww";
}

export interface TickerItem {
  symbol: string;
  name: string;
  price: number | null;
  changePct: number | null;
}

export const RANGES = [
  { label: "1D", range: "1d", interval: "5m" },
  { label: "5D", range: "5d", interval: "15m" },
  { label: "1M", range: "1mo", interval: "1h" },
  { label: "3M", range: "3mo", interval: "1d" },
  { label: "6M", range: "6mo", interval: "1d" },
  { label: "1Y", range: "1y", interval: "1d" },
  { label: "5Y", range: "5y", interval: "1wk" },
  { label: "MAX", range: "max", interval: "1mo" },
] as const;

export type RangeKey = (typeof RANGES)[number]["range"];
