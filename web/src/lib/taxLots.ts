/* TASK-1414 — tax lot planner: pure math for STCG/LTCG split, holding
   countdown, what-if sale projection and FY grouping. All law-derived
   numbers live in TaxConfig (TAX_DEFAULTS) — nothing hardcoded here. */

export interface SlabRate {
  upTo: number;
  rate: number;
}

export interface TaxConfig {
  holdingMonths: number;
  stcgMode: "flat" | "slab";
  stcgRate: number;
  ltcgRate: number;
  ltcgExemption: number;
  stcgSlabRates: SlabRate[];
  income: number;
}

export interface TaxLot {
  id: string;
  symbol: string;
  buyDate: string;
  qty: number;
  avgPrice: number;
  currentPrice: number;
}

export interface LotTax {
  longTerm: boolean;
  monthsHeld: number;
  daysToLtcg: number;
  gain: number;
  stcgGain: number;
  ltcgGain: number;
  stcgTax: number;
  ltcgTax: number;
  totalTax: number;
}

export interface SaleProjection {
  stcgGain: number;
  ltcgGain: number;
  stcgTax: number;
  ltcgTax: number;
  totalTax: number;
  grossProceeds: number;
  netProceeds: number;
  realizedFy: string;
}

export interface FyRow {
  fy: string;
  lots: number;
  qty: number;
  invested: number;
  value: number;
  gain: number;
  stcgGain: number;
  ltcgGain: number;
  stcgTax: number;
  ltcgTax: number;
  totalTax: number;
}

export const TAX_LOTS_KEY = "niftyterm.taxLots";
export const TAX_CONFIG_KEY = "niftyterm.taxConfig";

export const TAX_DEFAULTS: TaxConfig = {
  holdingMonths: 12,
  stcgMode: "flat",
  stcgRate: 0.2,
  ltcgRate: 0.125,
  ltcgExemption: 125_000,
  stcgSlabRates: [
    { upTo: 400_000, rate: 0 },
    { upTo: 800_000, rate: 0.05 },
    { upTo: 1_200_000, rate: 0.1 },
    { upTo: 1_600_000, rate: 0.15 },
    { upTo: 2_000_000, rate: 0.2 },
    { upTo: 2_400_000, rate: 0.25 },
    { upTo: Infinity, rate: 0.3 },
  ],
  income: 0,
};

export const fmtInr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const fmtNum = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 2,
});

export function parseDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function toISODate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function monthsHeld(buyDate: string, asOf: string): number {
  const buy = parseDate(buyDate);
  const now = parseDate(asOf);
  let m = (now.getFullYear() - buy.getFullYear()) * 12 + (now.getMonth() - buy.getMonth());
  if (now.getDate() < buy.getDate()) m -= 1;
  return m;
}

export function isLongTerm(buyDate: string, asOf: string, holdingMonths: number): boolean {
  return monthsHeld(buyDate, asOf) >= holdingMonths;
}

export function ltcgInDays(buyDate: string, asOf: string, holdingMonths: number): number {
  const buy = parseDate(buyDate);
  const now = parseDate(asOf);
  const anniv = new Date(buy.getFullYear(), buy.getMonth() + holdingMonths, buy.getDate());
  const days = Math.ceil((anniv.getTime() - now.getTime()) / 86_400_000);
  return days > 0 ? days : 0;
}

export function financialYear(date: string): string {
  const d = parseDate(date);
  const startYear = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `FY ${startYear}-${String(startYear + 1).slice(2)}`;
}

export function investedOf(lot: TaxLot): number {
  return lot.qty * lot.avgPrice;
}

export function valueOf(lot: TaxLot): number {
  return lot.qty * lot.currentPrice;
}

export function gainOf(lot: TaxLot): number {
  return valueOf(lot) - investedOf(lot);
}

export function marginalRateOf(config: TaxConfig): number {
  const total = config.income;
  for (const s of config.stcgSlabRates) {
    if (total <= s.upTo) return s.rate;
  }
  return config.stcgSlabRates[config.stcgSlabRates.length - 1]?.rate ?? 0;
}

export function stcgRateOf(config: TaxConfig, gain: number): number {
  if (config.stcgMode === "flat") return config.stcgRate;
  const total = config.income + Math.max(0, gain);
  for (const s of config.stcgSlabRates) {
    if (total <= s.upTo) return s.rate;
  }
  return config.stcgSlabRates[config.stcgSlabRates.length - 1]?.rate ?? 0;
}

export function lotTax(lot: TaxLot, asOf: string, config: TaxConfig): LotTax {
  const longTerm = isLongTerm(lot.buyDate, asOf, config.holdingMonths);
  const gain = gainOf(lot);
  const stcgGain = longTerm ? 0 : Math.max(0, gain);
  const ltcgGain = longTerm ? Math.max(0, gain) : 0;
  const stcgTax = stcgGain * stcgRateOf(config, stcgGain);
  const ltcgTax = Math.max(0, ltcgGain - config.ltcgExemption) * config.ltcgRate;
  return {
    longTerm,
    monthsHeld: monthsHeld(lot.buyDate, asOf),
    daysToLtcg: ltcgInDays(lot.buyDate, asOf, config.holdingMonths),
    gain,
    stcgGain,
    ltcgGain,
    stcgTax,
    ltcgTax,
    totalTax: stcgTax + ltcgTax,
  };
}

export function projectSale(lots: TaxLot[], asOf: string, config: TaxConfig): SaleProjection {
  let stcgGain = 0;
  let ltcgGain = 0;
  let grossProceeds = 0;
  for (const lot of lots) {
    const t = lotTax(lot, asOf, config);
    stcgGain += t.stcgGain;
    ltcgGain += t.ltcgGain;
    grossProceeds += valueOf(lot);
  }
  const stcgTax = stcgGain * stcgRateOf(config, stcgGain);
  const ltcgTax = Math.max(0, ltcgGain - config.ltcgExemption) * config.ltcgRate;
  const totalTax = stcgTax + ltcgTax;
  return {
    stcgGain,
    ltcgGain,
    stcgTax,
    ltcgTax,
    totalTax,
    grossProceeds,
    netProceeds: grossProceeds - totalTax,
    realizedFy: financialYear(asOf),
  };
}

export function fySummary(lots: TaxLot[], asOf: string, config: TaxConfig): FyRow[] {
  const rows: FyRow[] = [];
  const byFy = new Map<string, TaxLot[]>();
  for (const lot of lots) {
    const fy = financialYear(lot.buyDate);
    const arr = byFy.get(fy) ?? [];
    arr.push(lot);
    byFy.set(fy, arr);
  }
  for (const [fy, group] of byFy) {
    const perLot = group.map((lot) => lotTax(lot, asOf, config));
    const row: FyRow = {
      fy,
      lots: group.length,
      qty: group.reduce((a, l) => a + l.qty, 0),
      invested: group.reduce((a, l) => a + investedOf(l), 0),
      value: group.reduce((a, l) => a + valueOf(l), 0),
      gain: perLot.reduce((a, t) => a + t.gain, 0),
      stcgGain: perLot.reduce((a, t) => a + t.stcgGain, 0),
      ltcgGain: perLot.reduce((a, t) => a + t.ltcgGain, 0),
      stcgTax: perLot.reduce((a, t) => a + t.stcgTax, 0),
      ltcgTax: perLot.reduce((a, t) => a + t.ltcgTax, 0),
      totalTax: perLot.reduce((a, t) => a + t.totalTax, 0),
    };
    rows.push(row);
  }
  return rows.sort((a, b) => (a.fy < b.fy ? -1 : 1));
}

export function lotsToCsv(lots: TaxLot[], asOf: string, config: TaxConfig): string {
  const esc = (v: string | number): string => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines: string[] = [];
  lines.push(
    [
      "symbol",
      "buy_date",
      "qty",
      "avg_price",
      "current_price",
      "invested",
      "value",
      "gain",
      "classification",
      "stcg_gain",
      "ltcg_gain",
      "stcg_tax",
      "ltcg_tax",
      "total_tax",
      "fy_of_purchase",
      "fy_of_sale",
    ].join(","),
  );
  for (const lot of lots) {
    const t = lotTax(lot, asOf, config);
    lines.push(
      [
        esc(lot.symbol || "(untitled)"),
        esc(lot.buyDate),
        esc(lot.qty),
        esc(lot.avgPrice),
        esc(lot.currentPrice),
        esc(investedOf(lot)),
        esc(valueOf(lot)),
        esc(t.gain),
        esc(t.longTerm ? "LTCG" : "STCG"),
        esc(t.stcgGain),
        esc(t.ltcgGain),
        esc(t.stcgTax),
        esc(t.ltcgTax),
        esc(t.totalTax),
        esc(financialYear(lot.buyDate)),
        esc(financialYear(asOf)),
      ].join(","),
    );
  }
  lines.push("");
  lines.push("fy,lots,qty,invested,value,gain,stcg_gain,ltcg_gain,stcg_tax,ltcg_tax,total_tax");
  for (const r of fySummary(lots, asOf, config)) {
    lines.push(
      [
        esc(r.fy),
        esc(r.lots),
        esc(r.qty),
        esc(r.invested),
        esc(r.value),
        esc(r.gain),
        esc(r.stcgGain),
        esc(r.ltcgGain),
        esc(r.stcgTax),
        esc(r.ltcgTax),
        esc(r.totalTax),
      ].join(","),
    );
  }
  return lines.join("\n");
}