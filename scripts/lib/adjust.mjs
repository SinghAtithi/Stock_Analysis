/**
 * Adjusted-candle mapping for signals/backtests (TASK-15).
 * eod_candles stores raw prices + per-row adj_factor (docs/data-sources.md
 * §Split-adjustment): adj = raw * factor, factor composes on/after ex-date.
 * Strategies must score adjusted series or splits fake momentum/mean-reversion.
 */

/**
 * @param {Array<{ts:number,o:number,h:number,l:number,c:number,v:number,adj_factor?:number}>} rows
 */
export function toAdjustedCandles(rows) {
  return rows.map((r) => {
    const f = Number.isFinite(r.adj_factor) && r.adj_factor > 0 ? r.adj_factor : 1;
    return {
      time: r.ts,
      open: r.o * f,
      high: r.h * f,
      low: r.l * f,
      close: r.c * f,
      volume: r.v,
    };
  });
}
