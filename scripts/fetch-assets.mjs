#!/usr/bin/env node
/* fetch-assets.mjs — T16: EOD series for the ASSET universe (S172/S174).
 * Populates eod_candles for "NIFTY 50", "SENSEX" (Moneycontrol index endpoint,
 * codes in;NSX / in;SEN — case is edge-dependent per T31, both tried) and
 * "GOLDBEES" (Moneycontrol equity endpoint, symbol GOLDBEES — verified live;
 * Yahoo v8 chart GOLDBEES.NS as fallback, may be IP-throttled).
 * The cash proxy ("CASH") needs no series — it is synthetic (0 return) and
 * only exists inside the strategies.
 * Upserts on PK (symbol, ts) — idempotent. --force refetches current series.
 * Usage:
 *   node scripts/fetch-assets.mjs [--years N] [--force]
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, DEFAULT_DB_PATH } from "./lib/db.mjs";
import { HostBackoff, isRateLimited } from "./lib/curl.mjs";
import { applyMigrations } from "./migrate.mjs";
import {
  parseMoneycontrolChart,
  parseYahooChart,
  upsertCandles,
  latestTradingDayStart,
  yahooUrl,
} from "./ingest-eod.mjs";

const ASSETS = [
  { symbol: "NIFTY 50", kind: "index", mcSymbols: ["in;NSX", "in;nsx"] },
  { symbol: "SENSEX", kind: "index", mcSymbols: ["in;SEN", "in;sen"] },
  { symbol: "GOLDBEES", kind: "stock", mcSymbols: ["GOLDBEES"] },
];

export function moneycontrolIndexUrl(symbol, years) {
  const now = Math.floor(Date.now() / 1000);
  const from = now - Math.ceil(years * 365.25) * 86_400;
  const countback = Math.min(years * 260 + 50, 3000);
  return `https://priceapi.moneycontrol.com/techCharts/indianMarket/index/history` +
    `?symbol=${encodeURIComponent(symbol)}&resolution=1D&from=${from}&to=${now}` +
    `&countback=${countback}&currencyCode=INR`;
}

export function moneycontrolStockUrl(symbol, years) {
  const now = Math.floor(Date.now() / 1000);
  const from = now - Math.ceil(years * 365.25) * 86_400;
  const countback = Math.min(years * 260 + 50, 3000);
  return `https://priceapi.moneycontrol.com/techCharts/indianMarket/stock/history` +
    `?symbol=${encodeURIComponent(symbol)}&resolution=1D&from=${from}&to=${now}` +
    `&countback=${countback}&currencyCode=INR`;
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/* Fetch one asset through its chain. Index: MC index endpoint, both symbol
 * cases (Akamai edges disagree on case, see T31). Equity: MC equity endpoint;
 * on failure Yahoo v8 chart (symbol.NS), which may 429. */
export async function fetchAssetSeries(asset, { years = 10, backoff = new HostBackoff() } = {}) {
  let lastErr = null;
  for (const mcSym of asset.mcSymbols) {
    try {
      const url = asset.kind === "index"
        ? moneycontrolIndexUrl(mcSym, years)
        : moneycontrolStockUrl(mcSym, years);
      const data = await backoff.getJson(url);
      const parsed = parseMoneycontrolChart(data, mcSym);
      if (parsed) return { source: "moneycontrol", mcSymbol: mcSym, candles: parsed.candles };
    } catch (e) {
      lastErr = e;
      if (isRateLimited(e)) await delay(500);
    }
  }

  if (asset.kind === "stock") {
    try {
      const yahooSym = `${asset.symbol}.NS`;
      for (const host of ["query1", "query2"]) {
        try {
          const data = await backoff.getJson(yahooUrl(yahooSym, years, host));
          const parsed = parseYahooChart(data, yahooSym);
          if (parsed) return { source: "yahoo", mcSymbol: yahooSym, candles: parsed.candles };
        } catch (e) {
          lastErr = e;
          if (isRateLimited(e)) continue;
          break;
        }
      }
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr ?? new Error("all sources exhausted");
}

export function isAssetCurrent(db, symbol, nowMs = Date.now()) {
  const row = db.prepare("SELECT MAX(ts) AS maxTs FROM eod_candles WHERE symbol = ?").get(symbol);
  return !!row?.maxTs && row.maxTs >= latestTradingDayStart(nowMs);
}

export async function fetchAssets({ years = 10, dbPath = DEFAULT_DB_PATH, force = false, quiet = false } = {}) {
  const db = openDb(dbPath);
  applyMigrations(db);
  const log = (msg) => { if (!quiet) console.error(msg); };
  const stats = { fetched: 0, skipped: 0, failed: [], candles: 0, sources: {} };
  const backoff = new HostBackoff();
  const started = Date.now();

  for (const asset of ASSETS) {
    if (!force && isAssetCurrent(db, asset.symbol)) {
      stats.skipped += 1;
      log(`[skip] ${asset.symbol} — already current`);
      continue;
    }
    try {
      const got = await fetchAssetSeries(asset, { years, backoff });
      upsertCandles(db, asset.symbol, got.candles);
      stats.fetched += 1;
      stats.candles += got.candles.length;
      stats.sources[got.source] = (stats.sources[got.source] ?? 0) + 1;
      log(`[ok] ${asset.symbol} — ${got.candles.length} candles via ${got.source} (${got.mcSymbol})`);
    } catch (e) {
      stats.failed.push(asset.symbol);
      log(`[fail] ${asset.symbol} — ${String(e?.message ?? e).slice(0, 100)}`);
    }
    await delay(1500);
  }

  const summary = { assets: ASSETS.map((a) => a.symbol), fetched: stats.fetched, skipped: stats.skipped,
    failed: stats.failed, candles: stats.candles, sources: stats.sources, tookMs: Date.now() - started };
  db.close();
  return summary;
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const argv = process.argv.slice(2);
  const years = Number(argv[argv.indexOf("--years") + 1]) || 10;
  fetchAssets({ years, force: argv.includes("--force") })
    .then((s) => {
      console.log(JSON.stringify(s, null, 2));
      if (s.failed.length) process.exitCode = 1;
    })
    .catch((e) => { console.error("fatal:", e); process.exit(1); });
}
