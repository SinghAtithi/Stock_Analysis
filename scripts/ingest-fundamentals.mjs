#!/usr/bin/env node
/* ingest-fundamentals.mjs — T10: fundamentals pipeline v1 (Yahoo quoteSummary v10).
 *
 * Universe: instruments from web/src/data/instruments.json by idx membership
 *   --universe nifty50 | nifty500 | all   (default nifty500)
 *   --limit N        cap symbols (test runs)
 *   --force          ignore fetched_at freshness (default: skip < 7 days old)
 *
 * Fetch: one v10 quoteSummary request per symbol, 7 modules joined by comma.
 *   query1 host, retry query2 on failure; HostBackoff on 429 (per-host).
 *   Circuit breaker: 3 consecutive non-throttle failures => skip the rest fast.
 *   Rate-limited (429) failures park the host for the backoff window and do
 *   NOT trip the breaker — the run pauses instead of burning the universe.
 *   Raw payload cached to data/raw/fund/<symbol>.json; a fetch failure falls
 *   back to the cached payload (degraded, counted separately) before failing.
 *
 * Auth: Yahoo v10 quoteSummary requires a crumb. getCrumb() (lib/curl.mjs)
 *   bootstraps an A3 session cookie from fc.yahoo.com, exchanges it for a
 *   crumb via v1/test/getcrumb, and caches {crumb, cookieJar} per process.
 *   Crumb TTL: 50 min (A3 session lifetime); expired crumbs are refreshed
 *   lazily on the next fetch. Every quoteSummary URL carries
 *   crumb=...&lang=en-US&region=US and reuses the shared cookie jar.
 *
 * Store: fundamentals(symbol, module_json, metrics_json, fetched_at) upsert.
 *   module_json = quoteSummary.result[0] exactly as returned.
 *   metrics_json = flat, null-safe; numbers only where the source reports a
 *   numeric raw value; derived values are marked with a "_derived" key.
 *
 * Symbol mapping: NSE-listed -> <SYM>.NS, BSE-only -> <SYM>.BO (marketData.ts
 *   equity convention). Index memberships are resolved from the NSE listing
 *   when present (instruments.json carries NSE+BSE rows for the same symbol).
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, REPO_ROOT } from "./lib/db.mjs";
import { HostBackoff, getCrumb, appendCrumb } from "./lib/curl.mjs";

const MODULES =
  "defaultKeyStatistics,financialData,incomeStatementHistory," +
  "balanceSheetHistory,cashflowStatementHistory,earningsHistory,summaryProfile";

const FRESH_MS = 7 * 24 * 3600 * 1000; // 7 days
const CACHE_DIR = join(REPO_ROOT, "data", "raw", "fund");
const BREAKER_THRESHOLD = 3;
const PER_SYMBOL_DELAY_MS = 300;

const num = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};
const rawOf = (o, key) => num(o?.[key]?.raw);

/* ---------------- universe ---------------- */

export function loadInstruments() {
  const p = join(REPO_ROOT, "web", "src", "data", "instruments.json");
  return JSON.parse(readFileSync(p, "utf8"));
}

export function resolveUniverse({ universe = "nifty500", limit = 0 } = {}) {
  const rows = loadInstruments();
  const sel = rows.filter((r) => {
    if (r.e !== "NSE" && r.e !== "BSE") return false;
    if (universe === "all") return true;
    const idx = Array.isArray(r.idx) ? r.idx : [];
    return universe === "nifty50" ? idx.includes("NIFTY 50") : idx.includes("NIFTY 500");
  });
  const best = new Map();
  for (const r of sel) {
    const prev = best.get(r.s);
    if (!prev || (r.e === "NSE" && prev.e !== "NSE")) best.set(r.s, r);
  }
  let out = [...best.values()].map((r) => ({
    symbol: r.s,
    name: r.n,
    yahoo: r.e === "BSE" ? `${r.s}.BO` : `${r.s}.NS`,
  }));
  out.sort((a, b) => (a.yahoo < b.yahoo ? -1 : a.yahoo > b.yahoo ? 1 : 0));
  if (limit > 0) out = out.slice(0, limit);
  return out;
}

/* ---------------- fetch ---------------- */

export function quoteSummaryUrl(host, yahooSymbol, crumb) {
  const url =
    `https://${host}.finance.yahoo.com/v10/finance/quoteSummary/` +
    `${encodeURIComponent(yahooSymbol)}?modules=${MODULES}`;
  return crumb ? appendCrumb(url, crumb) : url;
}

export async function fetchQuoteSummary(yahooSymbol, { backoff = new HostBackoff(), timeoutMs = 30_000 } = {}) {
  const { crumb, cookieJar } = await getCrumb();
  let lastErr;
  for (const host of ["query1", "query2"]) {
    try {
      const data = await backoff.getJson(quoteSummaryUrl(host, yahooSymbol, crumb), {
        maxRetries: 2,
        timeoutMs,
        cookieJar,
      });
      const err = data?.quoteSummary?.error;
      if (err) throw new Error(String(err.message ?? err) || "quoteSummary error");
      return data;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

/* ---------------- normalization ---------------- */

export function extractAccruals(result) {
  const bs = result?.balanceSheetHistory?.balanceSheetStatements ?? [];
  const inc = result?.incomeStatementHistory?.incomeStatementHistory ?? [];
  const cf = result?.cashflowStatementHistory?.cashflowStatements ?? [];
  return {
    accrual_netIncome: rawOf(inc[0], "netIncome"),
    accrual_operatingCashFlow: rawOf(cf[0], "operatingCashflow"),
    accrual_totalAssetsCur: rawOf(bs[0], "totalAssets"),
    accrual_totalAssetsPrior: rawOf(bs[1], "totalAssets"),
  };
}

export function flattenMetrics(result) {
  const dks = result?.defaultKeyStatistics ?? {};
  const fin = result?.financialData ?? {};
  const bs = result?.balanceSheetHistory?.balanceSheetStatements ?? [];
  const inc = result?.incomeStatementHistory?.incomeStatementHistory ?? [];
  const profile = result?.summaryProfile ?? {};

  const marketCap =
    rawOf(fin, "marketCap") ??
    rawOf(dks, "marketCap") ??
    (num(fin.marketCap) ?? num(dks.marketCap));
  const trailingPE =
    rawOf(dks, "trailingPE") ??
    rawOf(fin, "trailingPE") ??
    (num(dks.trailingPE) ?? num(fin.trailingPE));
  const enterpriseValue =
    rawOf(dks, "enterpriseValue") ??
    rawOf(fin, "enterpriseValue") ??
    (num(dks.enterpriseValue) ?? num(fin.enterpriseValue));

  let ebitda = rawOf(fin, "ebitda") ?? num(fin.ebitda);
  let evToEbitda = null;
  let evToEbitdaDerived = false;
  if (ebitda !== null && ebitda !== 0) {
    evToEbitda = enterpriseValue !== null ? enterpriseValue / ebitda : null;
  } else {
    const opInc = rawOf(inc[0], "operatingIncome") ?? rawOf(fin, "operatingIncome");
    const dep = rawOf(inc[0], "depreciationAndAmortization");
    if (opInc !== null && dep !== null && enterpriseValue !== null && opInc + dep !== 0) {
      ebitda = opInc + dep;
      evToEbitda = enterpriseValue / ebitda;
      evToEbitdaDerived = true;
    }
  }

  return {
    ...extractAccruals(result),
    marketCap,
    trailingPE,
    forwardPE:
      rawOf(fin, "forwardPE") ??
      rawOf(dks, "forwardPE") ??
      (num(fin.forwardPE) ?? num(dks.forwardPE)),
    priceToBook: rawOf(dks, "priceToBook") ?? num(dks.priceToBook),
    priceToSales:
      rawOf(fin, "priceToSalesTrailing12Months") ??
      rawOf(dks, "priceToSalesTrailing12Months") ??
      (num(fin.priceToSalesTrailing12Months) ?? num(dks.priceToSalesTrailing12Months)),
    enterpriseValue,
    ebitda,
    evToEbitda,
    evToEbitda_derived: evToEbitdaDerived,
    earningsYield: trailingPE !== null && trailingPE !== 0 ? 1 / trailingPE : null,
    earningsYield_derived: trailingPE !== null && trailingPE !== 0,
    dividendYield: rawOf(dks, "dividendYield") ?? rawOf(fin, "dividendYield") ?? null,
    returnOnEquity: rawOf(fin, "returnOnEquity") ?? null,
    returnOnAssets: rawOf(fin, "returnOnAssets") ?? null,
    returnOnCapital: rawOf(fin, "returnOnCapital") ?? null,
    debtToEquity: rawOf(fin, "debtToEquity") ?? null,
    currentRatio: rawOf(fin, "currentRatio") ?? null,
    freeCashflow: rawOf(fin, "freeCashflow") ?? null,
    grossProfit: rawOf(fin, "grossProfits") ?? rawOf(fin, "grossProfit") ?? null,
    totalRevenue: rawOf(fin, "totalRevenue") ?? null,
    operatingIncome: rawOf(fin, "operatingIncome") ?? rawOf(inc[0], "operatingIncome") ?? null,
    netIncome: rawOf(fin, "netIncome") ?? rawOf(inc[0], "netIncome") ?? null,
    totalAssets: rawOf(bs[0], "totalAssets") ?? null,
    totalDebt: rawOf(bs[0], "totalDebt") ?? null,
    totalCash: rawOf(bs[0], "cash") ?? rawOf(bs[0], "cashAndShortTermInvestments") ?? null,
    ebit: rawOf(inc[0], "operatingIncome") ?? null,
    sector: profile.sector ?? null,
    industry: profile.industry ?? null,
    fiftyTwoWeekHigh: rawOf(dks, "fiftyTwoWeekHigh") ?? null,
    fiftyTwoWeekLow: rawOf(dks, "fiftyTwoWeekLow") ?? null,
    bookValue: rawOf(dks, "bookValue") ?? null,
  };
}

/* ---------------- ingest ---------------- */

export function cachePath(yahooSymbol, dir = CACHE_DIR) {
  return join(dir, `${yahooSymbol.replace(/[^A-Za-z0-9._-]/g, "_")}.json`);
}

export async function ingestFundamentals(db, { symbols, fetchFn, force = false, now = Date.now(), onSymbol = null, cacheDir = CACHE_DIR, backoff = null } = {}) {
  const upsert = db.prepare(
    `INSERT INTO fundamentals (symbol, module_json, metrics_json, fetched_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(symbol) DO UPDATE SET
       module_json = excluded.module_json,
       metrics_json = excluded.metrics_json,
       fetched_at = excluded.fetched_at`
  );
  const getFetched = db.prepare("SELECT fetched_at FROM fundamentals WHERE symbol = ?");

  mkdirSync(cacheDir, { recursive: true });
  const summary = { total: symbols.length, fetched: 0, skipped: 0, cached: 0, failed: [], breakerOpened: false };
  let consecutiveFailures = 0;

  for (const { symbol, yahoo } of symbols) {
    if (summary.breakerOpened) {
      summary.failed.push(`${symbol} (circuit open)`);
      if (onSymbol) onSymbol({ symbol, status: "skipped", reason: "circuit" });
      continue;
    }
    const cachedAt = getFetched.get(symbol)?.fetched_at ?? 0;
    if (!force && cachedAt > 0 && now - cachedAt * 1000 < FRESH_MS) {
      summary.skipped += 1;
      if (onSymbol) onSymbol({ symbol, status: "skipped", reason: "fresh" });
      continue;
    }
    try {
      let data;
      let degraded = false;
      try {
        data = await fetchFn(yahoo);
      } catch (e) {
        const cache = cachePath(yahoo, cacheDir);
        if (existsSync(cache)) {
          data = JSON.parse(readFileSync(cache, "utf8"));
          degraded = true;
        } else {
          throw e;
        }
      }
      const result = data?.quoteSummary?.result?.[0];
      if (!result) throw new Error("no quoteSummary.result[0] in payload");
      const metrics = { ...flattenMetrics(result), degraded };
      const fetchedAt = Math.floor(now / 1000);
      upsert.run(symbol, JSON.stringify(result), JSON.stringify(metrics), fetchedAt);
      if (!degraded) writeFileSync(cachePath(yahoo, cacheDir), JSON.stringify(data));
      consecutiveFailures = 0;
      summary.fetched += 1;
      if (onSymbol) onSymbol({ symbol, status: degraded ? "cached" : "fetched", degraded });
    } catch (e) {
      if (e?.rateLimited) {
        summary.failed.push(symbol);
        if (onSymbol) onSymbol({ symbol, status: "failed", error: String(e?.message ?? e) });
        if (backoff && e?.host) await backoff.waitIfNeeded(e.host);
        continue;
      }
      consecutiveFailures += 1;
      if (consecutiveFailures >= BREAKER_THRESHOLD) summary.breakerOpened = true;
      summary.failed.push(symbol);
      if (onSymbol) onSymbol({ symbol, status: "failed", error: String(e?.message ?? e) });
    }
    await new Promise((r) => setTimeout(r, PER_SYMBOL_DELAY_MS));
  }
  const attempted = summary.fetched + summary.cached + summary.failed.filter((s) => !s.includes("circuit")).length;
  summary.coveragePct = attempted > 0 ? Math.round((summary.fetched / attempted) * 1000) / 10 : 0;
  summary.coveragePctWithCache = attempted > 0 ? Math.round(((summary.fetched + summary.cached) / attempted) * 1000) / 10 : 0;
  return summary;
}

/* ---------------- CLI ---------------- */

function usage() {
  console.error(
    `usage: node scripts/ingest-fundamentals.mjs [--universe nifty50|nifty500|all] [--limit N] [--force]

  --universe  symbol universe (default nifty500)
  --limit N   cap the number of symbols (test runs)
  --force     ignore fetched_at freshness; default skips symbols < 7 days old`
  );
}

async function main() {
  const args = process.argv.slice(2);
  let universe = "nifty500";
  let limit = 0;
  let force = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--universe") universe = args[++i] ?? universe;
    else if (a === "--limit") limit = Number(args[++i] ?? 0);
    else if (a === "--force") force = true;
    else if (a === "--help" || a === "-h") return usage();
    else {
      console.error(`unknown arg: ${a}`);
      return usage();
    }
  }
  if (!["nifty50", "nifty500", "all"].includes(universe)) {
    console.error(`unknown universe: ${universe} (nifty50|nifty500|all)`);
    process.exit(2);
  }

  const symbols = resolveUniverse({ universe, limit });
  console.error(`[universe] ${universe} — ${symbols.length} symbols`);

  const db = openDb();
  const backoff = new HostBackoff();
  const summary = await ingestFundamentals(db, {
    symbols,
    force,
    backoff,
    fetchFn: (yahoo) => fetchQuoteSummary(yahoo, { backoff }),
    onSymbol: ({ symbol, status, reason, error, degraded }) => {
      if (status === "failed")
        console.error(`[fail] ${symbol} — ${String(error).slice(0, 80)}`);
      else if (status === "cached")
        console.error(`[cache] ${symbol} — served from data/raw/fund (degraded)`);
      else if (status === "skipped")
        console.error(`[skip] ${symbol} — ${reason === "fresh" ? "fetched < 7d ago" : "circuit open"}`);
      else console.error(`[ok] ${symbol} — ${degraded ? "cached" : "fetched"}`);
    },
  });
  db.close();

  console.error(
    `\nsummary: ${summary.total} symbols — fetched ${summary.fetched}, cached ${summary.cached}, ` +
      `skipped ${summary.skipped}, failed ${summary.failed.length}` +
      `\ncoverage: ${summary.coveragePct}% live / ${summary.coveragePctWithCache}% with cache` +
      (summary.breakerOpened ? "\ncircuit opened after 3 consecutive failures (Yahoo blocked?)" : "") +
      (summary.failed.length ? `\nfailed: ${summary.failed.join(", ")}` : "")
  );
  process.exit(0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();

export { MODULES };
