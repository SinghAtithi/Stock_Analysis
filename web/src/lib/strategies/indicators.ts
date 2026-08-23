/**
 * Pure indicator math. No I/O, no throws: every function is NaN-safe and
 * returns null where the value is undefined. Aligned outputs: result[i]
 * corresponds to input[i], with null before the window is warm.
 */

/** a / b, or null when b is 0 or either side is non-finite. */
export function safeDiv(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
  return a / b;
}

function hasNonFinite(values: number[]): boolean {
  for (const v of values) {
    if (!Number.isFinite(v)) return true;
  }
  return false;
}

/** Simple moving average; null until `period` samples are available. */
export function sma(values: number[], period: number): (number | null)[] {
  const n = values.length;
  if (n === 0) return [];
  if (period <= 0 || period > n) return new Array(n).fill(null);

  const out: (number | null)[] = new Array(n).fill(null);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) {
      sum = 0;
      continue;
    }
    if (i >= period) {
      const drop = values[i - period];
      if (Number.isFinite(drop)) sum -= drop;
    }
    sum += v;
    if (i >= period - 1) {
      let windowOk = true;
      for (let j = i - period + 1; j <= i; j++) {
        if (!Number.isFinite(values[j])) {
          windowOk = false;
          break;
        }
      }
      out[i] = windowOk ? sum / period : null;
    }
  }
  return out;
}

/** Exponential moving average, seeded with SMA at index period-1. */
export function ema(values: number[], period: number): (number | null)[] {
  const n = values.length;
  if (n === 0) return [];
  if (period <= 0 || period > n) return new Array(n).fill(null);

  const seed = sma(values, period);
  const out: (number | null)[] = new Array(n).fill(null);
  const alpha = 2 / (period + 1);

  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    if (i === period - 1) {
      out[i] = seed[i];
    } else if (i > period - 1) {
      const prev = out[i - 1];
      if (prev !== null) out[i] = alpha * v + (1 - alpha) * prev;
    }
  }
  return out;
}

/** Rate of change in percent: (v[i] - v[i-lookback]) / v[i-lookback] * 100. */
export function roc(values: number[], lookback: number): (number | null)[] {
  const n = values.length;
  if (n === 0) return [];
  if (lookback <= 0 || lookback >= n) return new Array(n).fill(null);

  const out: (number | null)[] = new Array(n).fill(null);
  for (let i = lookback; i < n; i++) {
    const base = values[i - lookback];
    const cur = values[i];
    if (!Number.isFinite(base) || !Number.isFinite(cur) || base === 0) {
      out[i] = null;
      continue;
    }
    out[i] = ((cur - base) / base) * 100;
  }
  return out;
}

/** Z-score (x - mean) / std over the whole series; null when std is 0. */
export function zscore(values: number[]): (number | null)[] {
  const n = values.length;
  if (n === 0) return [];
  if (hasNonFinite(values)) return new Array(n).fill(null);

  let mean = 0;
  for (const v of values) mean += v;
  mean /= n;

  let variance = 0;
  for (const v of values) variance += (v - mean) * (v - mean);
  variance /= n;

  const std = Math.sqrt(variance);
  if (std === 0 || !Number.isFinite(std)) return new Array(n).fill(null);

  return values.map((v) => (v - mean) / std);
}

/**
 * Percentile rank 0-100 of each value within the series (tie-averaged:
 * equal values share the midpoint of their positions). null if any input
 * is non-finite.
 */
export function pctRank(values: number[]): (number | null)[] {
  const n = values.length;
  if (n === 0) return [];
  if (hasNonFinite(values)) return new Array(n).fill(null);

  const idx = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const out: (number | null)[] = new Array(n).fill(null);

  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && idx[j + 1].v === idx[i].v) j++;
    const midpoint = (i + j) / 2;
    const pct = n > 1 ? (midpoint / (n - 1)) * 100 : 0;
    for (let k = i; k <= j; k++) out[idx[k].i] = pct;
    i = j + 1;
  }
  return out;
}
