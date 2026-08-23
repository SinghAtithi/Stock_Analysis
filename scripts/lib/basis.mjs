/**
 * Basis reconciliation for eod_candles writes (TASK-26).
 *
 * Storage invariant (ADR-0002): eod_candles holds ONE coherent series per
 * symbol on the basis of its most recent ingest — split-adjusted closes when
 * the source adjusts (Yahoo), raw when it doesn't (MC/Groww). Vendors re-base
 * independently (Yahoo recomputes its whole adjusted history after every
 * split; fallback vendors serve raw), so naively upserting can splice two
 * different bases into one series and fabricate cliffs.
 *
 * Fix: on every write, price the SAME trading day from both sides. Any ratio
 * between stored.c(day) and incoming.c(day) that isn't ~1 is pure basis
 * offset — rescale the stored segment onto the incoming basis before the
 * upsert. This replaces the event-driven adj_factor rebuild with something
 * that needs no corporate-actions table, no vendor metadata, and cannot
 * double-adjust.
 */

const DAY_S = 86_400;

/** Map ts -> candle for O(1) overlap lookup. */
function byTs(rows) {
  const m = new Map();
  for (const r of rows) m.set(r.ts, r);
  return m;
}

/**
 * Reconcile a stored series against an incoming batch.
 *
 * @param {Array<{ts:number,c:number}>} stored  current DB rows (any order)
 * @param {Array<{ts:number,c:number}>} incoming rows about to be upserted
 * @param {{eps?: number, gapEps?: number}} opts
 *   eps     – max |ratio-1| treated as "same basis" on exact-day overlap (default 0.005)
 *   gapEps  – max |ratio-1| tolerated across a date-gap boundary without
 *             rescaling (default 0.30; real single-day moves never exceed it)
 * @returns {{ scale: number, reason: string }}
 *   scale – multiply EVERY stored row's o/h/l/c by this before upsert
 *           (1 = nothing to do)
 */
export function reconcileBasis(stored, incoming, opts = {}) {
  const eps = opts.eps ?? 0.005;
  const gapEps = opts.gapEps ?? 0.30;
  if (!stored.length || !incoming.length) return { scale: 1, reason: "empty-side" };

  const inc = byTs(incoming);
  const cur = byTs(stored);

  // 1) exact-day overlaps: strongest signal. Use the most recent one so the
  //    scale reflects the freshest basis pair available.
  let overlapDay = null;
  for (const r of stored) {
    const incRow = inc.get(r.ts);
    if (incRow && Number.isFinite(incRow.c) && incRow.c > 0 && r.c > 0) {
      if (overlapDay === null || r.ts > overlapDay.ts) {
        overlapDay = { ts: r.ts, storedC: r.c, incomingC: incRow.c };
      }
    }
  }
  if (overlapDay) {
    const ratio = overlapDay.incomingC / overlapDay.storedC;
    if (Math.abs(ratio - 1) <= eps) return { scale: 1, reason: "overlap-agrees" };
    return { scale: ratio, reason: `overlap-rebase@${overlapDay.ts}` };
  }

  // 2) no shared day: compare across the seam (newest stored vs oldest
  //    incoming). Only rescale on an impossible move — otherwise leave alone.
  const maxStored = stored.reduce((a, b) => (b.ts > a.ts ? b : a));
  const minInc = incoming.reduce((a, b) => (b.ts < a.ts ? b : a));
  const gapDays = Math.abs(minInc.ts - maxStored.ts) / DAY_S;
  if (!maxStored.c || !minInc.c || minInc.ts <= maxStored.ts) {
    return { scale: 1, reason: "no-forward-seam" };
  }
  const seamRatio = minInc.c / maxStored.c;
  if (Math.abs(seamRatio - 1) <= gapEps) return { scale: 1, reason: "seam-plausible" };
  return { scale: seamRatio, reason: `seam-jump@${maxStored.ts}->${minInc.ts}(${Math.round(gapDays)}d)` };
}

/** Apply a scale factor to candle OHLC (volume untouched). Returns new array. */
export function scaleCandles(rows, scale) {
  if (scale === 1) return rows;
  return rows.map((r) => ({
    ...r,
    o: r.o * scale,
    h: r.h * scale,
    l: r.l * scale,
    c: r.c * scale,
  }));
}
