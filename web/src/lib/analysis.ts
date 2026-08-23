/**
 * Pure single-stock analysis over a chart payload. No I/O, no throws:
 * every field is null-safe so the API layer can serialize it directly.
 */

import type { Candle } from "@/lib/types";
import { roc, sma } from "@/lib/strategies/indicators";

export type Trend = "uptrend" | "downtrend" | "mixed" | "unknown";

/**
 * Structural input accepted by analyzeChart. Satisfied by both the server
 * ChartPayload (marketData.ts, field `exchange`) and the client ChartData
 * (types.ts, field `exchangeName`) without coupling analysis to either.
 */
export interface AnalysisInput {
  symbol: string;
  name: string;
  currency: string;
  exchange?: string;
  exchangeName?: string;
  regularMarketTime: number | null;
  previousClose: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  change: number | null;
  changePct: number | null;
  range: string;
  interval: string;
  candles: Candle[];
  source: "yahoo" | "groww" | "moneycontrol" | "google";
  stale?: boolean;
  degraded?: string;
}

export interface StockAnalysis {
  quote: {
    symbol: string;
    name: string;
    exchange: string;
    currency: string;
    price: number | null;
    change: number | null;
    changePct: number | null;
    previousClose: number | null;
    fiftyTwoWeekHigh: number | null;
    fiftyTwoWeekLow: number | null;
    asOf: number | null;
  };
  indicators: {
    sma20: number | null;
    sma50: number | null;
    sma200: number | null;
    roc20: number | null;
    rsi14: number | null;
    annualVolPct: number | null;
  };
  window: {
    bars: number;
    high: number | null;
    low: number | null;
    offHighPct: number | null;
    offLowPct: number | null;
  };
  trend: Trend;
  signals: string[];
  meta: Pick<AnalysisInput, "range" | "interval" | "source"> & {
    stale?: boolean;
    degraded?: string;
  };
}

const lastOf = <T,>(arr: T[]): T | undefined => arr[arr.length - 1];

/** Wilder-smoothed RSI; null when history is shorter than `period`+1. */
export function rsi(closes: number[], period = 14): number | null {
  if (closes.length <= period) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (d < 0 ? -d : 0)) / period;
  }
  if (avgLoss === 0) return avgGain === 0 ? null : 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

/** Annualized close-to-close volatility in percent over the window. */
function annualVolPct(closes: number[]): number | null {
  if (closes.length < 3) return null;
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const base = closes[i - 1];
    if (base > 0 && Number.isFinite(base) && Number.isFinite(closes[i])) {
      rets.push(closes[i] / base - 1);
    }
  }
  if (rets.length < 2) return null;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance =
    rets.reduce((acc, r) => acc + (r - mean) * (r - mean), 0) / (rets.length - 1);
  const sd = Math.sqrt(variance);
  return Number.isFinite(sd) ? sd * Math.sqrt(252) * 100 : null;
}

function distPct(price: number, ref: number | null): number | null {
  if (ref === null || !Number.isFinite(ref) || ref === 0) return null;
  return ((price - ref) / ref) * 100;
}

export function analyzeChart(chart: AnalysisInput): StockAnalysis | null {
  const { candles } = chart;
  const price = lastOf(candles)?.close;
  if (!candles.length || price === undefined) return null;

  const closes = candles.map((c) => c.close);
  const smaArrs = {
    sma20: lastOf(sma(closes, 20)) ?? null,
    sma50: lastOf(sma(closes, 50)) ?? null,
    sma200: lastOf(sma(closes, 200)) ?? null,
  };
  const roc20 = lastOf(roc(closes, 20)) ?? null;
  const rsi14 = rsi(closes, 14);
  const vol = annualVolPct(closes);

  let high = -Infinity;
  let low = Infinity;
  for (const c of candles) {
    if (c.high > high) high = c.high;
    if (c.low < low) low = c.low;
  }
  const winHigh = Number.isFinite(high) ? high : null;
  const winLow = Number.isFinite(low) ? low : null;

  const { sma20, sma50, sma200 } = smaArrs;
  let trend: Trend = "unknown";
  if (sma50 !== null && sma200 !== null) {
    if (price > sma50 && sma50 > sma200) trend = "uptrend";
    else if (price < sma50 && sma50 < sma200) trend = "downtrend";
    else trend = "mixed";
  }

  const signals: string[] = [];
  const pushSide = (label: string, ref: number | null) => {
    if (ref === null) return;
    signals.push(`price ${price > ref ? "above" : "below"} ${label}`);
  };
  pushSide("sma20", sma20);
  pushSide("sma50", sma50);
  pushSide("sma200", sma200);
  if (sma20 !== null && sma50 !== null && sma200 !== null) {
    if (sma20 > sma50 && sma50 > sma200) signals.push("bullish ma alignment (20>50>200)");
    else if (sma20 < sma50 && sma50 < sma200) signals.push("bearish ma alignment (20<50<200)");
  }
  if (roc20 !== null) signals.push(`roc20 ${roc20 >= 0 ? "+" : ""}${roc20.toFixed(2)}%`);
  if (rsi14 !== null) {
    if (rsi14 >= 70) signals.push(`rsi14 ${rsi14.toFixed(1)} overbought`);
    else if (rsi14 <= 30) signals.push(`rsi14 ${rsi14.toFixed(1)} oversold`);
    else signals.push(`rsi14 ${rsi14.toFixed(1)} neutral`);
  }

  const meta: StockAnalysis["meta"] = {
    range: chart.range,
    interval: chart.interval,
    source: chart.source,
  };
  if (chart.stale) meta.stale = true;
  if (chart.degraded) meta.degraded = chart.degraded;

  return {
    quote: {
      symbol: chart.symbol,
      name: chart.name,
      exchange: chart.exchangeName ?? chart.exchange ?? "",
      currency: chart.currency,
      price,
      change: chart.change,
      changePct: chart.changePct,
      previousClose: chart.previousClose,
      fiftyTwoWeekHigh: chart.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: chart.fiftyTwoWeekLow,
      asOf: chart.regularMarketTime,
    },
    indicators: { sma20, sma50, sma200, roc20, rsi14, annualVolPct: vol },
    window: {
      bars: candles.length,
      high: winHigh,
      low: winLow,
      offHighPct: distPct(price, winHigh),
      offLowPct: distPct(price, winLow),
    },
    trend,
    signals,
    meta,
  };
}
