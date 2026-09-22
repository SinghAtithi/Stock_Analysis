import test from "node:test";
import assert from "node:assert/strict";

/* TASK-1547 — corporateActions pure logic: the module header declares itself
   "unit-testable with node:test", but no suite ever landed. fetchCorporateActions
   (live network) is excluded — normalize/snap/marker logic is covered here. */

const ca = await import("../../web/src/lib/corporateActions.ts");

const item = (over = {}) => ({ ts: 1_700_000_000, type: "dividend", ratio: 8, subject: null, ...over });

test("normalizeAction: labels and chip text per kind", () => {
  const div = ca.normalizeAction(item());
  assert.equal(div.kind, "dividend");
  assert.equal(div.label, "DIV");
  assert.equal(div.short, "DIV ₹8");
  assert.equal(div.plain, "Dividend ₹8/share — price adjusted");
  const split = ca.normalizeAction(item({ type: "split", ratio: 5 }));
  assert.equal(split.label, "SPLIT");
  assert.equal(split.short, "SPLIT 5:1");
  const bonus = ca.normalizeAction(item({ type: "bonus", ratio: 2 }));
  assert.equal(bonus.label, "BONUS");
  assert.equal(bonus.short, "BONUS 1:1");
});

test("normalizeAction: null ratios and reverse splits degrade gracefully", () => {
  assert.equal(ca.normalizeAction(item({ ratio: null })).short, "DIV");
  assert.equal(ca.normalizeAction(item({ type: "split", ratio: null })).short, "SPLIT");
  assert.equal(ca.normalizeAction(item({ type: "split", ratio: 0.5 })).short, "SPLIT 1:2");
  assert.equal(ca.normalizeAction(item({ type: "bonus", ratio: 1 })).short, "BONUS");
});

test("normalizeAction: unknown types rejected, non-finite ts dropped", () => {
  assert.equal(ca.normalizeAction(item({ type: "buyback" })), null);
  assert.equal(ca.normalizeAction(item({ type: "" })), null);
  const out = ca.normalizeActions([
    item({ ts: 2 }),
    item({ ts: 1 }),
    item({ type: "buyback", ts: 3 }),
    item({ ts: Number.NaN }),
  ]);
  assert.deepEqual(out.map((a) => a.ts), [1, 2]);
});

test("actionsInWindow: snaps near candles, drops far ones, rewrites ts", () => {
  const day = 86400;
  const base = 1_700_000_000;
  const mk = (ts) => ca.normalizeAction(item({ ts }));
  const candles = [{ time: base }, { time: base + day }];
  // 5.5h (IST/UTC gap) off the candle snaps with a 1-day net.
  const near = mk(base + 19_800);
  const far = mk(base + 10 * day);
  const out = ca.actionsInWindow([far, near], candles, 1);
  assert.equal(out.length, 1);
  assert.equal(out[0].ts, base);
  assert.deepEqual(ca.actionsInWindow([near], [], 7), []);
  assert.deepEqual(ca.actionsInWindow([], candles, 7), []);
});

test("toMarkers: dividends square, splits/bonuses circle, warn-family ids", () => {
  const items = ca.normalizeActions([
    item({ type: "dividend", ratio: 8 }),
    item({ type: "split", ratio: 5 }),
    item({ type: "bonus", ratio: 2 }),
  ]);
  const markers = ca.toMarkers(items, "#92400e");
  assert.equal(markers.length, 3);
  assert.deepEqual(markers.map((m) => m.shape), ["square", "circle", "circle"]);
  assert.ok(markers.every((m) => m.position === "belowBar" && m.color === "#92400e"));
  assert.deepEqual(markers.map((m) => m.text), ["DIV", "SPLIT", "BONUS"]);
  assert.ok(markers.every((m) => m.id.includes("-")));
});
