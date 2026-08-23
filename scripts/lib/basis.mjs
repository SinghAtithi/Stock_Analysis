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

/**
 * Canonical calendar-day bucket. Vendors stamp the same trading day at
 * different intra-day epochs (Yahoo IST-midnight = 18:30Z prev-label,
 * Moneycontrol UTC-midnight), so exact-ts equality never matches across
 * sources and writes would duplicate rows. All matching is day-based.
 */
function dayKey(ts) {
  return Math.floor(ts / DAY_S);
}

/** Map dayKey -> candle for O(1) overlap lookup. */
function byTs(rows) {
  const m = new Map();
  for (const r of rows) m.set(dayKey(r.ts), r);
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
    const incRow = inc.get(dayKey(r.ts));
    if (incRow && Number.isFinite(incRow.c) && incRow.c > 0 && r.c > 0) {
      if (overlapDay === null || dayKey(r.ts) > dayKey(overlapDay.ts)) {
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

/**
 * Write-path wrapper (TASK-36 hotfix): rescale onto the incoming basis when
 * bases disagree, delete stored rows colliding on CALENDAR DAY with incoming
 * (vendor stamp conventions differ — exact-ts upsert would duplicate), then
 * insert. `db` is an open better-sqlite3/node:sqlite handle; `log` optional.
 */
export function storeCandlesReconciled(db, symbol, incoming, log = () => {}) {
  const stored = db.prepare("SELECT ts, c FROM eod_candles WHERE symbol = ?").all(symbol);
  const { scale, reason } = reconcileBasis(stored, incoming);
  const incomingDays = new Set(incoming.map((r) => Math.floor(r.ts / DAY_S)));
  const tx = db.transaction(() => {
    if (scale !== 1) {
      db.prepare(
        "UPDATE eod_candles SET o = o * ?, h = h * ?, l = l * ?, c = c * ? WHERE symbol = ?"
      ).run(scale, scale, scale, scale, symbol);
    }
    const del = db.prepare(
      "DELETE FROM eod_candles WHERE symbol = ? AND CAST(ts / 86400 AS INT) = ?"
    );
    for (const d of incomingDays) del.run(symbol, d);
    const ins = db.prepare(
      `INSERT INTO eod_candles (symbol, ts, o, h, l, c, v, adj_factor)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT (symbol, ts) DO UPDATE SET
         o = excluded.o, h = excluded.h, l = excluded.l, c = excluded.c, v = excluded.v`
    );
    for (const r of incoming) ins.run(symbol, r.ts, r.o, r.h, r.l, r.c, r.v);
  });
  tx();
  if (scale !== 1) {
    log(`[basis] ${symbol}: rescaled ${stored.length} stored rows ×${scale.toFixed(4)} (${reason})`);
  }
  return incoming.length;
}
