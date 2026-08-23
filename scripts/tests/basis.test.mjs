/**
 * TASK-26 / ADR-0002 — basis reconciliation on eod_candles writes.
 * Vendors re-base independently (Yahoo adjusted+rebased, MC/Groww raw);
 * naive upserts splice cliffs into stored series. reconcileBasis must
 * detect and repair every splice class below.
 *
 * Run: npm test  (from web/)  ·  node --test scripts/tests/basis.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { reconcileBasis, scaleCandles } from "../../scripts/lib/basis.mjs";

const DAY = 86_400;
const candle = (day, c) => ({ ts: day * DAY, o: c, h: c, l: c, c });
const series = (from, to, price) =>
  Array.from({ length: to - from + 1 }, (_, i) => candle(from + i, price));

test("same-basis overlap is a no-op (normal daily ingest)", () => {
  const stored = series(90, 100, 500);
  const incoming = [...series(95, 110, 500), candle(111, 505)];
  assert.deepEqual(reconcileBasis(stored, incoming), { scale: 1, reason: "overlap-agrees" });
});

test("post-split rebase: source now reports history ÷10 → stored segment scales down", () => {
  const stored = [...series(80, 99, 950), candle(100, 955)]; // pre-split basis
  const incoming = [...series(90, 105, 95.5), candle(106, 96)]; // rebased basis
  const out = reconcileBasis(stored, incoming);
  // most recent shared day is 100: incoming 95.5 vs stored 955 → exactly 0.1
  assert.equal(out.scale, 0.1);
  assert.match(out.reason, /overlap-rebase/);
});

test("raw vendor overwrites adjusted tail: stored segment scales up onto raw basis", () => {
  const stored = [...series(90, 99, 96.5), candle(100, 96.6)]; // adjusted basis
  const incoming = [...series(98, 105, 966)]; // raw NSE prices, same market
  const out = reconcileBasis(stored, incoming);
  // shared day 100: 966 vs 96.6 → ×10
  assert.equal(out.scale, 10);
});

test("tiny drift inside eps does not trigger rescale", () => {
  const stored = series(90, 100, 500);
  const incoming = series(92, 104, 502); // +0.4%, within 0.5% eps
  assert.deepEqual(reconcileBasis(stored, incoming), { scale: 1, reason: "overlap-agrees" });
});

test("no overlap + plausible seam move → leave alone", () => {
  const stored = series(50, 60, 500);
  const incoming = series(70, 80, 520); // +4% across the gap, plausible
  assert.deepEqual(reconcileBasis(stored, incoming), { scale: 1, reason: "seam-plausible" });
});

test("no overlap + impossible seam jump → rescale (stitched bases)", () => {
  const stored = series(50, 60, 500);
  const incoming = series(70, 80, 1000); // +100% across a quiet gap: basis break
  const out = reconcileBasis(stored, incoming);
  assert.equal(out.scale, 2);
  assert.match(out.reason, /seam-jump/);
});

test("empty either side is always a no-op", () => {
  assert.equal(reconcileBasis([], series(1, 5, 100)).scale, 1);
  assert.equal(reconcileBasis(series(1, 5, 100), []).scale, 1);
});

test("most recent shared day wins when several overlap", () => {
  // older day disagrees by ×~0.1, newer day by ×1.2 — picking the wrong
  // day would rescale the whole history onto a stale basis
  const stored = [candle(90, 999), candle(100, 500)];
  const incoming = [candle(90, 100), candle(100, 600)];
  const out = reconcileBasis(stored, incoming);
  assert.ok(Math.abs(out.scale - 1.2) < 1e-9, "uses day 100 factor, not day 90");
});

test("scaleCandles touches OHLC only", () => {
  const [r] = scaleCandles([{ ts: 7, o: 2, h: 3, l: 1, c: 2.5, v: 42 }], 10);
  assert.deepEqual(r, { ts: 7, o: 20, h: 30, l: 10, c: 25, v: 42 });
});
