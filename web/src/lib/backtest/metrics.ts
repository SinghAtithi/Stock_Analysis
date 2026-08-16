import type { EquityPoint } from "./engine";

/**
 * Performance metrics (T23). NaN-safe by construction: every ratio returns
 * null when its inputs are missing or degenerate (no data, zero variance,
 * flat equity). Equity input is the engine's cumulative series (start at 1).
 *
 * Formulas (annualized where relevant):
 * - CAGR     = (V_end / V_0)^(1/years) - 1, years = calendar days / 365.25
 * - Ann. vol = sample stdev of daily returns * sqrt(252)
 * - Sharpe   = (mean_daily * 252 - rf_annual) / ann_vol
 *              rf = 6.5% annual — India risk-free context (10y G-sec ~6.5%,
 *              RBI repo anchored). Fixed constant, documented in CLI output.
 * - Sortino  = (mean_daily * 252 - rf_annual) / downside_dev * sqrt(252)
 *              downside_dev = sqrt(mean(min(r, 0)^2))
 * - Max DD   = max peak-to-trough equity loss (reported positive), with the
 *              peak date (run-up) and trough date (low) at the worst point.
 * - Hit rate = fraction of calendar months with positive compounded return
 * - Ann. turnover = gross one-way traded fraction per calendar year
 * - Exposure = fraction of trading days the strategy holds >= 1 position
 */

export const RF_ANNUAL = 0.065;
export const TRADING_DAYS_PER_YEAR = 252;
const DAYS_PER_YEAR = 365.25;
const DAY_MS = 86_400_000;

export interface SeriesPoint {
  date: string;
  value: number;
}

export interface SeriesMetrics {
  totalReturn: number | null;
  cagr: number | null;
  annualizedVol: number | null;
  sharpe: number | null;
  sortino: number | null;
  maxDrawdown: number | null;
  maxDrawdownPeakDate: string | null;
  maxDrawdownTroughDate: string | null;
  hitRate: number | null;
  years: number | null;
  tradingDays: number;
  positiveMonths: number;
  totalMonths: number;
}

export interface Metrics extends SeriesMetrics {
  annualizedTurnover: number | null;
  exposure: number | null;
}

export interface MetricsInput {
  equity: EquityPoint[];
  totalTurnover: number;
  investedDays: number;
}

function safeReturns(points: SeriesPoint[]): { returns: number[]; mean: number; std: number } | null {
  const returns: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1].value;
    const cur = points[i].value;
    if (!Number.isFinite(prev) || !Number.isFinite(cur) || prev <= 0) continue;
    returns.push(cur / prev - 1);
  }
  if (returns.length < 2) return null;
  let mean = 0;
  for (const r of returns) mean += r;
  mean /= returns.length;
  let ss = 0;
  for (const r of returns) ss += (r - mean) * (r - mean);
  const std = Math.sqrt(ss / (returns.length - 1));
  return { returns, mean, std };
}

function calendarYears(points: SeriesPoint[]): number | null {
  if (points.length < 2) return null;
  const t0 = Date.parse(`${points[0].date}T00:00:00Z`);
  const t1 = Date.parse(`${points[points.length - 1].date}T00:00:00Z`);
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) return null;
  return (t1 - t0) / DAY_MS / DAYS_PER_YEAR;
}

export function computeSeriesMetrics(points: SeriesPoint[]): SeriesMetrics {
  const empty: SeriesMetrics = {
    totalReturn: null,
    cagr: null,
    annualizedVol: null,
    sharpe: null,
    sortino: null,
    maxDrawdown: null,
    maxDrawdownPeakDate: null,
    maxDrawdownTroughDate: null,
    hitRate: null,
    years: null,
    tradingDays: points.length,
    positiveMonths: 0,
    totalMonths: 0,
  };
  if (points.length === 0) return empty;

  const years = calendarYears(points);
  const stats = safeReturns(points);

  let totalReturn: number | null = null;
  if (Number.isFinite(points[0].value) && Number.isFinite(points[points.length - 1].value) && points[0].value > 0) {
    totalReturn = points[points.length - 1].value / points[0].value - 1;
  }

  let cagr: number | null = null;
  if (totalReturn !== null && years !== null && years > 0 && totalReturn > -1) {
    cagr = Math.pow(points[points.length - 1].value / points[0].value, 1 / years) - 1;
  }

  let annualizedVol: number | null = null;
  let sharpe: number | null = null;
  let sortino: number | null = null;
  if (stats) {
    annualizedVol = stats.std * Math.sqrt(TRADING_DAYS_PER_YEAR);
    const annMean = stats.mean * TRADING_DAYS_PER_YEAR;
    const excess = annMean - RF_ANNUAL;
    if (annualizedVol > 0 && Number.isFinite(annualizedVol)) {
      sharpe = excess / annualizedVol;
    }
    let downsideSs = 0;
    for (const r of stats.returns) {
      if (r < 0) downsideSs += r * r;
    }
    const downsideDev = Math.sqrt(downsideSs / stats.returns.length) * Math.sqrt(TRADING_DAYS_PER_YEAR);
    if (downsideDev > 0 && Number.isFinite(downsideDev)) {
      sortino = excess / downsideDev;
    }
  }

  // Max drawdown with peak/trough dates (worst point wins ties: earliest).
  let peak = -Infinity;
  let peakIdx = -1;
  let maxDd = 0;
  let troughIdx = -1;
  let troughPeakIdx = -1;
  for (let i = 0; i < points.length; i++) {
    const v = points[i].value;
    if (!Number.isFinite(v)) continue;
    if (v > peak) {
      peak = v;
      peakIdx = i;
    }
    const dd = v / peak - 1;
    if (dd < maxDd) {
      maxDd = dd;
      troughIdx = i;
      troughPeakIdx = peakIdx;
    }
  }

  // Monthly hit rate.
  const monthly = new Map<string, number>();
  let positives = 0;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1].value;
    const cur = points[i].value;
    if (!Number.isFinite(prev) || !Number.isFinite(cur) || prev <= 0) continue;
    const m = points[i].date.slice(0, 7);
    monthly.set(m, (monthly.get(m) ?? 1) * (1 + (cur / prev - 1)));
  }
  for (const v of monthly.values()) {
    if (v - 1 > 0) positives++;
  }
  const totalMonths = monthly.size;

  return {
    totalReturn,
    cagr,
    annualizedVol,
    sharpe,
    sortino,
    maxDrawdown: maxDd < 0 ? -maxDd : null,
    maxDrawdownPeakDate: troughIdx >= 0 && maxDd < 0 ? points[troughPeakIdx].date : null,
    maxDrawdownTroughDate: troughIdx >= 0 && maxDd < 0 ? points[troughIdx].date : null,
    hitRate: totalMonths > 0 ? positives / totalMonths : null,
    years,
    tradingDays: points.length,
    positiveMonths: positives,
    totalMonths,
  };
}

export function computeMetrics(input: MetricsInput): Metrics {
  const series = computeSeriesMetrics(input.equity.map((e) => ({ date: e.date, value: e.strat })));
  let annualizedTurnover: number | null = null;
  if (series.years !== null && series.years > 0) {
    annualizedTurnover = input.totalTurnover / series.years;
  }
  let exposure: number | null = null;
  if (input.equity.length > 0) {
    exposure = input.investedDays / input.equity.length;
  }
  return { ...series, annualizedTurnover, exposure };
}
