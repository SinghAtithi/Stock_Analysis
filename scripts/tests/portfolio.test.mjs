/* TASK-1378 — portfolio x-ray: tolerant broker-CSV parsing, concentration,
   Nifty-50 overlap and factor-exposure math (web/src/lib/portfolio.ts). */
import test from "node:test";
import assert from "node:assert/strict";
import {
  PORTFOLIO_KEY,
  parsePortfolioCsv,
  normalizeHeader,
  normalizeSymbol,
  parseNumeric,
  classifyCap,
  computeConcentration,
  computeNiftyOverlap,
  computeFactorExposure,
  FACTOR_STRATEGIES,
} from "@/lib/portfolio";

/* ---------- CSV parsing ---------- */

test("parses a Zerodha-style export", () => {
  const r = parsePortfolioCsv(
    [
      "Symbol,Instrument,Sector,Quantity,Avg. cost,LT",
      "RELIANCE,ISIN0000000032,Energy,10,2450.50,L",
      "TCS,ISIN0000000033,IT,5,3890.00,L",
    ].join("\n"),
  );
  assert.equal(r.missing.length, 0);
  assert.equal(r.headerless, false);
  assert.equal(r.holdings.length, 2);
  assert.equal(r.holdings[0].symbol, "RELIANCE");
  assert.equal(r.holdings[0].qty, 10);
  assert.equal(r.holdings[0].avgPrice, 2450.5);
  assert.equal(r.holdings[0].value, 24505);
});

test("parses a Groww-style export", () => {
  const r = parsePortfolioCsv(
    [
      "Symbol Name,Quantity,Average Price",
      "INFY,20,\"₹1,450.00\"",
      "HDFCBANK,15,1750.25",
    ].join("\n"),
  );
  assert.equal(r.missing.length, 0);
  assert.equal(r.holdings.length, 2);
  const infy = r.holdings.find((h) => h.symbol === "INFY");
  assert.equal(infy?.qty, 20);
  assert.equal(infy?.avgPrice, 1450);
});

test("strips NSE/BSE suffixes, prefixes and -EQ", () => {
  const r = parsePortfolioCsv(
    [
      "symbol,qty,avg price",
      "RELIANCE.NS,1,100",
      "TCS.BO,1,100",
      "NSE:HDFCBANK,1,100",
      "INFY-EQ,1,100",
      "BSE LT,1,100",
    ].join("\n"),
  );
  const syms = r.holdings.map((h) => h.symbol).sort();
  assert.deepEqual(syms, ["HDFCBANK", "INFY", "LT", "RELIANCE", "TCS"]);
});

test("merges duplicate symbols with weighted average price", () => {
  const r = parsePortfolioCsv(
    [
      "symbol,qty,avg price",
      "RELIANCE,10,1000",
      "RELIANCE,10,2000",
    ].join("\n"),
  );
  assert.equal(r.holdings.length, 1);
  assert.equal(r.holdings[0].qty, 20);
  assert.equal(r.holdings[0].avgPrice, 1500);
  assert.equal(r.holdings[0].value, 30000);
});

test("skips bad rows with reasons", () => {
  const r = parsePortfolioCsv(
    [
      "symbol,qty,avg price",
      "RELIANCE,10,2450.50",
      ",5,100",
      "TCS,abc,100",
      "HDFCBANK,5,xyz",
      "INFY,-2,100",
    ].join("\n"),
  );
  assert.equal(r.holdings.length, 1);
  assert.equal(r.skipped.length, 4);
  const reasons = r.skipped.map((s) => s.reason).join("|");
  assert.match(reasons, /No symbol/);
  assert.match(reasons, /Quantity "abc"/);
  assert.match(reasons, /Price "xyz"/);
  assert.match(reasons, /positive number/);
});

test("quoted fields with commas parse correctly", () => {
  const r = parsePortfolioCsv(
    'symbol,qty,avg price\n"RELIANCE","10","2,450.50"\n',
  );
  assert.equal(r.holdings.length, 1);
  assert.equal(r.holdings[0].avgPrice, 2450.5);
});

test("headerless file falls back to positional columns", () => {
  const r = parsePortfolioCsv("RELIANCE,10,2450.50\nTCS,5,3890.00\n");
  assert.equal(r.headerless, true);
  assert.equal(r.holdings.length, 2);
  assert.equal(r.holdings[0].symbol, "RELIANCE");
});

test("reports missing column groups", () => {
  const r = parsePortfolioCsv(
    ["symbol,qty", "RELIANCE,10"].join("\n"),
  );
  assert.ok(r.missing.includes("price"));
});

test("handles BOM, blank lines and CRLF", () => {
  const r = parsePortfolioCsv(
    "\uFEFFsymbol,qty,avg price\r\nRELIANCE,10,100\r\n\r\nTCS,5,200\r\n",
  );
  assert.equal(r.holdings.length, 2);
  assert.equal(r.blankLines, 1);
});

test("normalizeHeader is punctuation-tolerant", () => {
  assert.equal(normalizeHeader("Avg. price"), "avg price");
  assert.equal(normalizeHeader("Avg Cost"), "avg cost");
  assert.equal(normalizeHeader("SYMBOL"), "symbol");
});

test("parseNumeric strips currency noise", () => {
  assert.equal(parseNumeric("₹1,450.00"), 1450);
  assert.equal(parseNumeric("1,23,456.78"), 123456.78);
  assert.equal(parseNumeric("2450.50*"), 2450.5);
  assert.equal(parseNumeric("-"), null);
  assert.equal(parseNumeric("abc"), null);
});

test("normalizeSymbol handles common variants", () => {
  assert.equal(normalizeSymbol("reliance.NS"), "RELIANCE");
  assert.equal(normalizeSymbol("TCS.BSE"), "TCS");
  assert.equal(normalizeSymbol("NSE:HDFCBANK"), "HDFCBANK");
  assert.equal(normalizeSymbol("infy-eq"), "INFY");
  assert.equal(normalizeSymbol("  LT "), "LT");
});

/* ---------- cap classification ---------- */

test("classifyCap buckets by index membership", () => {
  assert.equal(classifyCap(["NIFTY 50", "NIFTY 500"]), "Large");
  assert.equal(classifyCap(["NIFTY NEXT 50", "NIFTY 500"]), "Large");
  assert.equal(classifyCap(["NIFTY MIDCAP 150", "NIFTY 500"]), "Mid");
  assert.equal(classifyCap(["NIFTY SMALLCAP 250", "NIFTY 500"]), "Small");
  assert.equal(classifyCap(["NIFTY 500"]), "Not classified");
  assert.equal(classifyCap(undefined), "Not classified");
  /* Large beats Mid when both present */
  assert.equal(classifyCap(["NIFTY NEXT 50", "NIFTY MIDCAP 150"]), "Large");
});

/* ---------- concentration ---------- */

const META = (sector, idx = []) => ({ sector, idx });

function metaResolver(map) {
  return (symbol) => map[symbol] ?? null;
}

const H = (symbol, qty, avgPrice) => ({
  symbol,
  qty,
  avgPrice,
  value: qty * avgPrice,
});

test("concentration computes sector slices, HHI and verdict", () => {
  const holdings = [
    H("A", 10, 100), // 1000
    H("B", 20, 100), // 2000
    H("C", 70, 100), // 7000
  ];
  const resolve = metaResolver({
    A: META("Finance"),
    B: META("Finance"),
    C: META("Energy"),
  });
  const c = computeConcentration(holdings, resolve);
  assert.equal(c.matchedValue, 10000);
  assert.equal(c.topSector?.label, "Energy");
  assert.ok(Math.abs((c.topSector?.pct ?? 0) - 0.7) < 1e-9);
  /* HHI = 0.7^2 + 0.3^2 = 0.58 */
  assert.ok(Math.abs(c.hhi - 0.58) < 1e-9);
  assert.equal(c.verdict, "Concentrated");
  assert.deepEqual(c.sectors.map((s) => s.label), ["Energy", "Finance"]);
});

test("diversified verdict below threshold", () => {
  const holdings = [
    H("A", 10, 100),
    H("B", 10, 100),
    H("C", 10, 100),
    H("D", 10, 100),
    H("E", 10, 100),
  ];
  const resolve = metaResolver({
    A: META("Finance"),
    B: META("Energy"),
    C: META("Tech"),
    D: META("Health"),
    E: META("Materials"),
  });
  const c = computeConcentration(holdings, resolve);
  /* five equal sectors → HHI 0.2 < 0.25 */
  assert.ok(c.hhi < 0.25);
  assert.equal(c.verdict, "Diversified");
});

test("unknown-sector and unmatched holdings are surfaced", () => {
  const holdings = [H("A", 10, 100), H("UNKNOWN", 10, 100)];
  const resolve = metaResolver({ A: META("Finance") });
  const c = computeConcentration(holdings, resolve);
  assert.deepEqual(c.unmatched, ["UNKNOWN"]);
  assert.equal(c.matchedValue, 1000);
  const labels = c.sectors.map((s) => s.label);
  assert.ok(!labels.includes("UNKNOWN"));
});

test("top-5 folding into Other", () => {
  const holdings = Array.from({ length: 7 }, (_, i) => H(`S${i}`, 10, 100));
  const resolve = metaResolver(
    Object.fromEntries(
      Array.from({ length: 7 }, (_, i) => [`S${i}`, META(`Sector ${i}`)]),
    ),
  );
  const c = computeConcentration(holdings, resolve);
  assert.equal(c.sectors.length, 6);
  assert.equal(c.sectors[c.sectors.length - 1].label, "Other");
  assert.ok(Math.abs(c.sectors.reduce((a, s) => a + s.pct, 0) - 1) < 1e-9);
});

/* ---------- Nifty overlap ---------- */

test("overlap is value-weighted against Nifty 50 membership", () => {
  const holdings = [
    H("RELIANCE", 10, 100), // member, 1000
    H("NONMEMBER", 20, 100), // not member, 2000
    H("UNKNOWN", 30, 100), // unresolvable, excluded
  ];
  const resolve = metaResolver({
    RELIANCE: META("Energy", ["NIFTY 50"]),
    NONMEMBER: META("Tech", ["NIFTY 500"]),
  });
  const o = computeNiftyOverlap(holdings, resolve);
  assert.equal(o.nifty50Count, 1);
  assert.equal(o.matchedCount, 2);
  assert.equal(o.nifty50Value, 1000);
  assert.equal(o.matchedValue, 3000);
  assert.ok(Math.abs(o.pct - (1000 / 3000) * 100) < 1e-9);
});

test("overlap is 0 when nothing resolves", () => {
  const o = computeNiftyOverlap([H("X", 1, 1)], metaResolver({}));
  assert.equal(o.pct, 0);
  assert.equal(o.matchedCount, 0);
});

/* ---------- factor exposure ---------- */

test("factor exposure maps strategies to factors", () => {
  assert.deepEqual(FACTOR_STRATEGIES.momentum, ["S100", "S172", "S174", "demo-roc20", "demo-52wlow"]);
  assert.ok(FACTOR_STRATEGIES.value.includes("S099"));
  assert.ok(FACTOR_STRATEGIES.quality.includes("S18-quality"));
  assert.deepEqual(FACTOR_STRATEGIES.volatility, ["S101"]);
});

function scoresOf(factor, entries) {
  return { [factor]: [new Map(entries)] };
}

test("weighted percentile mean exposure", () => {
  /* universe: A(10) B(20) C(30) D(40) — percentiles: A 0, B 33.3, C 66.7, D 100 */
  const holdings = [
    H("B", 1, 100), // 100
    H("D", 3, 100), // 300
  ];
  const e = computeFactorExposure(
    holdings,
    scoresOf("momentum", [
      ["A", 10],
      ["B", 20],
      ["C", 30],
      ["D", 40],
    ]),
  );
  const m = e.find((x) => x.factor === "momentum");
  assert.ok(m && m.pct !== null);
  assert.ok(Math.abs(m.pct - ((33.33 * 100 + 100 * 300) / 400)) < 1.5);
  assert.ok(Math.abs(m.coverage - 1) < 1e-9);
});

test("missing symbols are excluded and reduce coverage", () => {
  const holdings = [
    H("B", 1, 100), // has data
    H("Z", 1, 100), // no data — half the value uncovered
  ];
  const e = computeFactorExposure(
    holdings,
    scoresOf("value", [
      ["A", 10],
      ["B", 50],
      ["C", 90],
    ]),
  );
  const v = e.find((x) => x.factor === "value");
  assert.ok(v && v.pct !== null);
  /* B is the median of 3 → percentile 50 */
  assert.ok(Math.abs((v.pct ?? 0) - 50) < 1e-9);
  assert.ok(Math.abs(v.coverage - 0.5) < 1e-9);
});

test("averages percentiles across a factor's strategies", () => {
  const holdings = [H("A", 1, 100), H("B", 1, 100)];
  const e = computeFactorExposure(
    holdings,
    {
      quality: [
        new Map([
          ["A", 0],
          ["B", 100],
        ]),
        new Map([
          ["A", 100],
          ["B", 0],
        ]),
      ],
    },
  );
  const q = e.find((x) => x.factor === "quality");
  assert.ok(q && q.pct !== null);
  assert.ok(Math.abs(q.pct - 50) < 1e-9);
});

test("factor with no data reports null pct and zero coverage", () => {
  const e = computeFactorExposure([H("A", 1, 100)], scoresOf("volatility", []));
  const v = e.find((x) => x.factor === "volatility");
  assert.ok(v);
  assert.equal(v.pct, null);
  assert.equal(v.coverage, 0);
  /* other factors still computed */
  assert.equal(e.length, 4);
});

test("as-of is threaded through", () => {
  const e = computeFactorExposure(
    [H("A", 1, 100)],
    scoresOf("momentum", [["A", 50]]),
    { momentum: 1_787_481_000 },
  );
  const m = e.find((x) => x.factor === "momentum");
  assert.equal(m?.asOf, 1_787_481_000);
  assert.equal(e.find((x) => x.factor === "value")?.asOf, null);
});

test("localStorage key follows the niftyterm namespace", () => {
  assert.equal(PORTFOLIO_KEY, "niftyterm.portfolio");
});