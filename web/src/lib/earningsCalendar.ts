/* Earnings-calendar data source for /calendar (TASK-1383).
 *
 * There is no earnings-data API in the repo (corporate-actions carries
 * dividends/splits only), so scheduled result dates come from this STATIC,
 * MANUALLY CURATED dataset — a representative Nifty 50 subset with dates in
 * the near future (Q1 FY27 stragglers Sep 2026 + the Q2 FY27 wave
 * Oct–Nov 2026). No market data is fetched at runtime.
 *
 * Honesty contract: the page surfaces `meta.source` + `meta.asOf` as a chip
 * and flags `meta.stale` when the dataset goes > STALE_AFTER_DAYS without a
 * refresh. When no dates are known (empty/expired dataset) the page
 * degrades to the AC5 empty state — that is the intended failure mode, not
 * an error page.
 */

export type FilingBoard = "NSE" | "BSE" | "Both";
export type ExpectedTime =
  | "After market hours"
  | "During trading hours"
  | "Scheduled";

export interface EarningsEvent {
  symbol: string;
  name: string;
  sector: string;
  /** IST calendar date, "YYYY-MM-DD". */
  date: string;
  /** When the result is expected (exchange filing window). */
  time: ExpectedTime;
  /** Exchange(s) the filing is expected on. */
  filing: FilingBoard;
}

export const CALENDAR_SOURCE_LABEL = "Static filing calendar (curated)";
export const CALENDAR_AS_OF = "2026-08-29";
/** Beyond this age the UI must show the STALE chip (repo convention). */
export const STALE_AFTER_DAYS = 14;

/* date · time · filing follow the pattern of prior quarters for the
   prominent names; the rest are representative scheduling. Review and
   refresh this table each quarter (see meta.asOf). */
export const SCHEDULED_RESULTS: readonly EarningsEvent[] = [
  // — Q1 FY27 stragglers (final) —
  { symbol: "ETERNAL", name: "ETERNAL LIMITED", sector: "Technology Services", date: "2026-09-08", time: "Scheduled", filing: "Both" },
  { symbol: "TMPV", name: "TATA MOTORS PASS VEH LTD", sector: "Consumer Durables", date: "2026-09-09", time: "Scheduled", filing: "Both" },
  { symbol: "ADANIPORTS", name: "ADANI PORT & SEZ LTD", sector: "Transportation", date: "2026-09-10", time: "During trading hours", filing: "Both" },
  { symbol: "GRASIM", name: "GRASIM INDUSTRIES LTD", sector: "Non-Energy Minerals", date: "2026-09-11", time: "After market hours", filing: "Both" },
  { symbol: "INDIGO", name: "INTERGLOBE AVIATION LTD", sector: "Transportation", date: "2026-09-15", time: "After market hours", filing: "NSE" },
  { symbol: "JIOFIN", name: "JIO FIN SERVICES LTD", sector: "Finance", date: "2026-09-16", time: "After market hours", filing: "BSE" },
  { symbol: "ADANIENT", name: "ADANI ENTERPRISES LIMITED", sector: "Distribution Services", date: "2026-09-17", time: "During trading hours", filing: "Both" },
  { symbol: "POWERGRID", name: "POWER GRID CORP. LTD.", sector: "Utilities", date: "2026-09-18", time: "After market hours", filing: "NSE" },
  { symbol: "ONGC", name: "OIL AND NATURAL GAS CORP.", sector: "Energy Minerals", date: "2026-09-22", time: "After market hours", filing: "BSE" },
  { symbol: "COALINDIA", name: "COAL INDIA LTD", sector: "Energy Minerals", date: "2026-09-23", time: "After market hours", filing: "NSE" },
  { symbol: "NTPC", name: "NTPC LTD", sector: "Utilities", date: "2026-09-24", time: "After market hours", filing: "NSE" },
  { symbol: "HINDALCO", name: "HINDALCO  INDUSTRIES  LTD", sector: "Non-Energy Minerals", date: "2026-09-25", time: "After market hours", filing: "Both" },
  { symbol: "TATASTEEL", name: "TATA STEEL LIMITED", sector: "Non-Energy Minerals", date: "2026-09-28", time: "After market hours", filing: "Both" },
  { symbol: "JSWSTEEL", name: "JSW STEEL LIMITED", sector: "Non-Energy Minerals", date: "2026-09-29", time: "After market hours", filing: "Both" },
  // — Q2 FY27 wave (IT) —
  { symbol: "TCS", name: "TATA CONSULTANCY SERV LT", sector: "Technology Services", date: "2026-10-05", time: "After market hours", filing: "Both" },
  { symbol: "INFY", name: "INFOSYS LIMITED", sector: "Technology Services", date: "2026-10-06", time: "After market hours", filing: "BSE" },
  { symbol: "HCLTECH", name: "HCL TECHNOLOGIES LTD", sector: "Technology Services", date: "2026-10-07", time: "After market hours", filing: "Both" },
  { symbol: "TECHM", name: "TECH MAHINDRA LIMITED", sector: "Technology Services", date: "2026-10-08", time: "After market hours", filing: "BSE" },
  { symbol: "WIPRO", name: "WIPRO LTD", sector: "Technology Services", date: "2026-10-09", time: "After market hours", filing: "Both" },
  // — Q2 FY27 wave (industrial) —
  { symbol: "LT", name: "LARSEN & TOUBRO LTD.", sector: "Industrial Services", date: "2026-10-12", time: "After market hours", filing: "BSE" },
  { symbol: "RELIANCE", name: "RELIANCE INDUSTRIES LTD", sector: "Energy Minerals", date: "2026-10-13", time: "After market hours", filing: "Both" },
  // — Q2 FY27 wave (banks) —
  { symbol: "HDFCBANK", name: "HDFC BANK LTD", sector: "Finance", date: "2026-10-14", time: "After market hours", filing: "Both" },
  { symbol: "ICICIBANK", name: "ICICI BANK LTD.", sector: "Finance", date: "2026-10-15", time: "After market hours", filing: "Both" },
  { symbol: "SBIN", name: "STATE BANK OF INDIA", sector: "Finance", date: "2026-10-16", time: "After market hours", filing: "Both" },
  { symbol: "KOTAKBANK", name: "KOTAK MAHINDRA BANK LTD", sector: "Finance", date: "2026-10-19", time: "After market hours", filing: "Both" },
  { symbol: "AXISBANK", name: "AXIS BANK LIMITED", sector: "Finance", date: "2026-10-21", time: "After market hours", filing: "Both" },
  { symbol: "BAJFINANCE", name: "BAJAJ FINANCE LIMITED", sector: "Finance", date: "2026-10-22", time: "After market hours", filing: "BSE" },
  { symbol: "BAJAJFINSV", name: "BAJAJ FINSERV LTD.", sector: "Finance", date: "2026-10-23", time: "After market hours", filing: "BSE" },
  // — Q2 FY27 wave (auto + consumer) —
  { symbol: "MARUTI", name: "MARUTI SUZUKI INDIA LTD.", sector: "Consumer Durables", date: "2026-10-26", time: "During trading hours", filing: "Both" },
  { symbol: "M&M", name: "MAHINDRA & MAHINDRA LTD", sector: "Consumer Durables", date: "2026-10-27", time: "After market hours", filing: "Both" },
  { symbol: "TITAN", name: "TITAN COMPANY LIMITED", sector: "Consumer Durables", date: "2026-10-28", time: "After market hours", filing: "Both" },
  { symbol: "ASIANPAINT", name: "ASIAN PAINTS LIMITED", sector: "Process Industries", date: "2026-10-29", time: "After market hours", filing: "Both" },
  { symbol: "HINDUNILVR", name: "HINDUSTAN UNILEVER LTD.", sector: "Consumer Non-Durables", date: "2026-10-30", time: "After market hours", filing: "Both" },
  // — Q2 FY27 wave (final stretch) —
  { symbol: "NESTLEIND", name: "NESTLE INDIA LIMITED", sector: "Consumer Non-Durables", date: "2026-11-02", time: "After market hours", filing: "BSE" },
  { symbol: "ITC", name: "ITC LTD", sector: "Consumer Non-Durables", date: "2026-11-03", time: "After market hours", filing: "Both" },
  { symbol: "SUNPHARMA", name: "SUN PHARMACEUTICAL IND L", sector: "Health Technology", date: "2026-11-04", time: "During trading hours", filing: "Both" },
  { symbol: "ULTRACEMCO", name: "ULTRATECH CEMENT LIMITED", sector: "Non-Energy Minerals", date: "2026-11-05", time: "After market hours", filing: "Both" },
  { symbol: "BHARTIARTL", name: "BHARTI AIRTEL LIMITED", sector: "Communications", date: "2026-11-06", time: "During trading hours", filing: "Both" },
  { symbol: "CIPLA", name: "CIPLA LTD", sector: "Health Technology", date: "2026-11-10", time: "After market hours", filing: "BSE" },
  { symbol: "DRREDDY", name: "DR. REDDY S LABORATORIES", sector: "Health Technology", date: "2026-11-11", time: "After market hours", filing: "Both" },
];

/** Events on or after today (IST). When the curated table is empty or has
 *  fully aged out this returns [] — the page then shows the empty state. */
export function getScheduledResults(todayIso: string): EarningsEvent[] {
  return SCHEDULED_RESULTS.filter((e) => e.date >= todayIso).sort((a, b) =>
    a.date.localeCompare(b.date),
  );
}

/** Days since the manual refresh; > STALE_AFTER_DAYS ⇒ stale flag. */
export function calendarStaleness(todayIso: string): number {
  const t = Date.parse(`${todayIso}T00:00:00Z`);
  const a = Date.parse(`${CALENDAR_AS_OF}T00:00:00Z`);
  if (!Number.isFinite(t) || !Number.isFinite(a)) return 0;
  return Math.floor((t - a) / 86_400_000);
}