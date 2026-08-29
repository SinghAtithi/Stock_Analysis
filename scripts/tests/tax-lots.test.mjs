/**
 * TASK-1414 — tax lot planner math (web/src/lib/taxLots.ts).
 * Pure functions: holding-period classification, STCG/LTCG split,
 * countdown, what-if sale projection, FY grouping, CSV export.
 *
 * Run: npm test  (from web/)  ·  node --test scripts/tests/tax-lots.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  TAX_DEFAULTS,
  financialYear,
  fySummary,
  isLongTerm,
  lotTax,
  lotsToCsv,
  ltcgInDays,
  marginalRateOf,
  monthsHeld,
  projectSale,
  stcgRateOf,
} from "../../web/src/lib/taxLots.ts";

const lot = (over = {}) => ({
  id: "l1",
  symbol: "RELIANCE",
  buyDate: "2026-02-01",
  qty: 100,
  avgPrice: 100,
  currentPrice: 150,
  ...over,
});

const cfg = { ...TAX_DEFAULTS };

/* ---------- holding period ---------- */

test("monthsHeld counts calendar months by anniversary", () => {
  assert.equal(monthsHeld("2025-08-15", "2026-08-15"), 12);
  assert.equal(monthsHeld("2025-08-15", "2026-08-14"), 11);
  assert.equal(monthsHeld("2025-08-15", "2025-08-16"), 0);
  assert.equal(monthsHeld("2026-01-31", "2026-02-28"), 0);
});

test("isLongTerm respects the configured threshold", () => {
  assert.equal(isLongTerm("2025-08-15", "2026-08-15", 12), true);
  assert.equal(isLongTerm("2025-08-15", "2026-08-14", 12), false);
  assert.equal(isLongTerm("2025-08-15", "2026-02-15", 6), true);
  assert.equal(isLongTerm("2025-08-15", "2026-02-14", 6), false);
});

test("ltcgInDays counts down to the anniversary, 0 when already long term", () => {
  assert.equal(ltcgInDays("2026-08-29", "2026-08-29", 12), 365);
  assert.equal(ltcgInDays("2025-01-01", "2026-08-29", 12), 0);
});

/* ---------- per-lot split ---------- */

test("STCG lot: gain fully short-term, flat rate applied", () => {
  const t = lotTax(lot(), "2026-08-29", cfg);
  assert.equal(t.longTerm, false);
  assert.equal(t.gain, 5000);
  assert.equal(t.stcgGain, 5000);
  assert.equal(t.ltcgGain, 0);
  assert.equal(t.stcgTax, 1000);
  assert.equal(t.ltcgTax, 0);
  assert.equal(t.totalTax, 1000);
  assert.equal(t.daysToLtcg, 156); // 2026-02-01 + 12m = 2027-02-01
});

test("LTCG lot below exemption pays no LTCG tax", () => {
  const t = lotTax(lot({ buyDate: "2025-01-01", currentPrice: 200 }), "2026-08-29", cfg);
  assert.equal(t.longTerm, true);
  assert.equal(t.ltcgGain, 10000);
  assert.equal(t.ltcgTax, 0);
});

test("LTCG tax above exemption at configured rate", () => {
  const t = lotTax(lot({ buyDate: "2025-01-01", currentPrice: 2000 }), "2026-08-29", cfg);
  assert.equal(t.ltcgGain, 190000);
  assert.equal(t.ltcgTax, (190000 - 125000) * 0.125);
});

test("loss lots never produce tax", () => {
  const t = lotTax(lot({ currentPrice: 50 }), "2026-08-29", cfg);
  assert.equal(t.gain, -5000);
  assert.equal(t.stcgGain, 0);
  assert.equal(t.ltcgGain, 0);
  assert.equal(t.totalTax, 0);
});

/* ---------- configurable rates ---------- */

test("slab mode picks the marginal rate from income + gain", () => {
  const slab = { ...cfg, stcgMode: "slab", income: 1_000_000 };
  assert.equal(stcgRateOf(slab, 50_000), 0.1); // 10L falls in the ≤12L slab
  assert.equal(stcgRateOf(slab, 3_000_000), 0.3);
  assert.equal(marginalRateOf(slab), 0.1);
  const t = lotTax(lot(), "2026-08-29", slab);
  assert.equal(t.stcgTax, 5000 * 0.1);
});

test("custom rates flow through per-lot math", () => {
  const custom = { ...cfg, stcgRate: 0.15, ltcgRate: 0.1, ltcgExemption: 0 };
  const s = lotTax(lot(), "2026-08-29", custom);
  assert.equal(s.stcgTax, 5000 * 0.15);
  const l = lotTax(lot({ buyDate: "2025-01-01", currentPrice: 2000 }), "2026-08-29", custom);
  assert.equal(l.ltcgTax, 190000 * 0.1);
});

/* ---------- what-if projection ---------- */

test("projectSale applies the exemption once across the selected LTCG", () => {
  const a = lot({ id: "a", buyDate: "2025-01-01", currentPrice: 800 }); // gain 70k
  const b = lot({ id: "b", buyDate: "2025-02-01", currentPrice: 800 }); // gain 70k
  const p = projectSale([a, b], "2026-08-29", cfg);
  assert.equal(p.ltcgGain, 140000);
  assert.equal(p.ltcgTax, (140000 - 125000) * 0.125);
  assert.equal(p.totalTax, p.ltcgTax);
  assert.equal(p.grossProceeds, 160000);
  assert.equal(p.netProceeds, 160000 - p.totalTax);
  assert.equal(p.realizedFy, "FY 2026-27");
});

test("projectSale mixes STCG and LTCG correctly", () => {
  const a = lot({ id: "a" }); // STCG gain 5000
  const b = lot({ id: "b", buyDate: "2025-01-01", currentPrice: 2000 }); // LTCG gain 190k
  const p = projectSale([a, b], "2026-08-29", cfg);
  assert.equal(p.stcgTax, 1000);
  assert.equal(p.ltcgTax, (190000 - 125000) * 0.125);
  assert.equal(p.totalTax, p.stcgTax + p.ltcgTax);
});

/* ---------- financial years + FY summary ---------- */

test("financialYear runs April to March", () => {
  assert.equal(financialYear("2026-03-31"), "FY 2025-26");
  assert.equal(financialYear("2026-04-01"), "FY 2026-27");
  assert.equal(financialYear("2026-01-15"), "FY 2025-26");
});

test("fySummary groups by FY of purchase, sorted oldest first", () => {
  const a = lot({ id: "a", buyDate: "2024-05-01", qty: 100, avgPrice: 100, currentPrice: 150 });
  const b = lot({ id: "b", buyDate: "2026-01-15", qty: 10, avgPrice: 500, currentPrice: 550 });
  const rows = fySummary([b, a], "2026-08-29", cfg);
  assert.deepEqual(
    rows.map((r) => r.fy),
    ["FY 2024-25", "FY 2025-26"],
  );
  const [fy24, fy25] = rows;
  assert.equal(fy24.lots, 1);
  assert.equal(fy24.gain, 5000);
  assert.equal(fy24.ltcgGain, 5000, "held >12 months by 2026-08-29");
  assert.equal(fy25.lots, 1);
  assert.equal(fy25.stcgGain, 500);
  assert.equal(fy25.totalTax, 100); // 500 × 20%
});

/* ---------- CSV export ---------- */

test("lotsToCsv emits header, per-lot rows and FY summary, quoting commas", () => {
  const csv = lotsToCsv(
    [lot({ symbol: "RELIANCE, & CO" }), lot({ id: "b", buyDate: "2025-01-01", currentPrice: 2000 })],
    "2026-08-29",
    cfg,
  );
  const lines = csv.split("\n");
  assert.ok(lines[0].startsWith("symbol,buy_date,qty"));
  assert.ok(lines[1].includes('"RELIANCE, & CO"'));
  assert.ok(lines.some((l) => l.startsWith("fy,lots,qty")));
  assert.ok(lines.some((l) => l.startsWith("FY 2025-26,")));
});

test("empty lot list yields header plus empty FY summary", () => {
  const csv = lotsToCsv([], "2026-08-29", cfg);
  assert.ok(csv.split("\n").length >= 3);
});