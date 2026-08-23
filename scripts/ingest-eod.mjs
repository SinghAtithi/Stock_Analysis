#!/usr/bin/env node
/* ingest-eod.mjs — T9: EOD candle store + universe ingest.
 * Chain: Yahoo v8 chart (range=N y, interval=1d, events=div,split) ->
 *        Moneycontrol priceapi (resolution=1D, countback) ->
 *        Groww chart API (daily, short window).
 * Writes eod_candles (epoch-seconds ts, adj_factor per the split-adjustment
 * algorithm in docs/data-sources.md §"Split-adjustment algorithm") and merges
 * split/dividend events into corporate_actions.
 * Usage:
 *   node scripts/ingest-eod.mjs [--universe nifty50|nifty500|all] [--years N] [--quick]
 *   node scripts/ingest-eod.mjs --symbol RELIANCE [--years N] [--force]
 *     Single-symbol mode adds an NSE NextApi tail-fill (raw daily rows back to
 *     the 1996-01-01 exchange archive floor — see docs/data-sources.md §1a).
 */
import { readFileSync, writeFileSync, mkdirSync, statSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, DEFAULT_DB_PATH, REPO_ROOT } from "./lib/db.mjs";
import { storeCandlesReconciled } from "./lib/basis.mjs";
import { HostBackoff, defaultBackoff, isRateLimited, curlBootstrap } from "./lib/curl.mjs";
import { applyMigrations } from "./migrate.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const INSTRUMENTS_PATH = path.join(REPO_ROOT, "web", "src", "data", "instruments.json");
export const CORP_ACTIONS_PATH = path.join(REPO_ROOT, "data", "corporate_actions.json");
export const RAW_EOD_DIR = path.join(REPO_ROOT, "data", "raw", "eod");

/* ----- universe ----- */

export const NIFTY50_FALLBACK = [
  "ADANIENT","ADANIPORTS","APOLLOHOSP","ASIANPAINT","AXISBANK","BAJAJ-AUTO",
  "BAJAJFINSV","BAJFINANCE","BEL","BHARTIARTL","CIPLA","COALINDIA","DRREDDY",
  "EICHERMOT","ETERNAL","GRASIM","HCLTECH","HDFCBANK","HDFCLIFE","HINDALCO",
  "HINDUNILVR","ICICIBANK","INDIGO","INFY","ITC","JIOFIN","JSWSTEEL","KOTAKBANK",
  "LT","M&M","MARUTI","MAXHEALTH","NESTLEIND","NTPC","ONGC","POWERGRID","RELIANCE",
  "SBILIFE","SBIN","SHRIRAMFIN","SUNPHARMA","TATACONSUM","TATASTEEL","TCS","TECHM",
  "TITAN","TMPV","TRENT","ULTRACEMCO","WIPRO",
];

export const INDEX_NAMES = { nifty50: "NIFTY 50", nifty500: "NIFTY 500" };

function isEquity(x) {
  if (!x || typeof x !== "object") return false;
  if (!["NSE", "BSE"].includes(x.e)) return false;
  if (/^[\^]/.test(x.s ?? "")) return false;
  if (/index|ETF|mutual fund/i.test(x.n ?? "")) return false;
  return true;
}

/* Resolve {symbol, exchange, name}[] for a universe, NSE-preferred when a
 * symbol is listed on both exchanges. Falls back to the hardcoded NIFTY 50
 * list if membership flags (idx) are absent for the requested universe. */
export function resolveUniverse(instruments, universe = "nifty500") {
  const indexName = INDEX_NAMES[universe];
  let rows;
  if (indexName) {
    rows = instruments.filter((x) => isEquity(x) && Array.isArray(x.idx) && x.idx.includes(indexName));
    if (!rows.length && universe === "nifty50") {
      rows = instruments.filter((x) => isEquity(x) && NIFTY50_FALLBACK.includes(x.s) && x.e === "NSE");
    }
  } else {
    rows = instruments.filter(isEquity);
  }
  const bySymbol = new Map();
  for (const x of rows) {
    const existing = bySymbol.get(x.s);
    if (!existing || (existing.e !== "NSE" && x.e === "NSE")) bySymbol.set(x.s, x);
  }
  return [...bySymbol.values()].map((x) => ({ symbol: x.s, exchange: x.e, name: x.n ?? x.s }));
}

export function loadInstruments() {
  return JSON.parse(readFileSync(INSTRUMENTS_PATH, "utf8"));
}

/* ----- trading-day helpers (IST) ----- */

export function latestTradingDayStart(nowMs = Date.now(), { closeHour = 15, closeMin = 30 } = {}) {
  const ist = new Date(nowMs + 5.5 * 3600_000);
  let dayStart = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - 5.5 * 3600_000;
  if (ist.getUTCDay() === 0 || ist.getUTCDay() === 6 || ist.getUTCHours() < closeHour ||
      (ist.getUTCHours() === closeHour && ist.getUTCMinutes() < closeMin)) {
    dayStart -= 86_400_000;
  }
  const d = new Date(dayStart + 5.5 * 3600_000);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
    dayStart -= 86_400_000;
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return Math.floor(dayStart / 1000);
}

/* Skip fetch when the newest stored candle is on or after the latest trading day. */
export function isCurrent(db, symbol, nowMs = Date.now()) {
  const row = db.prepare("SELECT MAX(ts) AS maxTs FROM eod_candles WHERE symbol = ?").get(symbol);
  return !!row?.maxTs && row.maxTs >= latestTradingDayStart(nowMs);
}

/* ----- parsers ----- */

/* positive finite OHLC + epoch ts >= 2000-01-01 (rejects Yahoo null->0 rows) */
/* positive finite OHLC + epoch ts at/after the NSE archive floor 1996-01-01
 * (rejects Yahoo null->0 rows; TASK-30: must NOT reject pre-2000 history) */
const NSE_FLOOR_TS = Math.floor((Date.UTC(1996, 0, 1) - 5.5 * 3600_000) / 1000);
function isValidCandle(c) {
  return [c.ts, c.o, c.h, c.l, c.c].every(Number.isFinite)
    && c.o > 0 && c.h > 0 && c.l > 0 && c.c > 0
    && c.ts >= NSE_FLOOR_TS;
}

export function parseYahooChart(data, symbol) {
  const result = data?.chart?.result?.[0];
  if (!result?.timestamp) return null;
  const ts = result.timestamp;
  const quote = result.indicators?.quote?.[0] ?? {};
  const candles = [];
  for (let i = 0; i < ts.length; i++) {
    const c = {
      ts: Math.floor(Number(ts[i])),
      o: Number(quote.open?.[i]),
      h: Number(quote.high?.[i]),
      l: Number(quote.low?.[i]),
      c: Number(quote.close?.[i]),
      v: Number(quote.volume?.[i] ?? 0),
    };
    if (isValidCandle(c)) candles.push(c);
  }
  if (!candles.length) return null;
  const events = result.events ?? {};
  const fmt = (t) => {
    const d = new Date(t * 1000);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
  };
  const actions = [];
  for (const [t, ev] of Object.entries(events.splits ?? {})) {
    actions.push({
      symbol, type: "split", date: fmt(Number(t)),
      ratio: ev?.numerator && ev?.denominator ? Number(ev.numerator) / Number(ev.denominator) : null,
      raw: { source: "yahoo", ...ev },
    });
  }
  for (const [t, ev] of Object.entries(events.dividends ?? {})) {
    actions.push({
      symbol, type: "dividend", date: fmt(Number(t)),
      ratio: Number(ev?.amount) || null,
      raw: { source: "yahoo", ...ev },
    });
  }
  return { candles, actions };
}

export function parseMoneycontrolChart(data, symbol) {
  if (data?.s !== "ok") return null;
  const t = data.t, o = data.o, h = data.h, l = data.l, c = data.c, v = data.v;
  if (!Array.isArray(t) || !t.length) return null;
  const candles = [];
  for (let i = 0; i < t.length; i++) {
    const row = {
      ts: Math.floor(Number(t[i])),
      o: Number(o?.[i]), h: Number(h?.[i]), l: Number(l?.[i]),
      c: Number(c?.[i]), v: Number(v?.[i] ?? 0),
    };
    if (isValidCandle(row)) candles.push(row);
  }
  return candles.length ? { candles, actions: [], symbol } : null;
}

export function parseGrowwChart(data, symbol) {
  if (!Array.isArray(data?.candles)) return null;
  const candles = [];
  for (const row of data.candles) {
    if (!Array.isArray(row)) continue;
    const tsMs = Number(row[0]);
    const c = {
      ts: Math.floor(tsMs / 1000),
      o: Number(row[1]), h: Number(row[2]), l: Number(row[3]),
      c: Number(row[4]), v: Number(row[5] ?? 0),
    };
    if (isValidCandle(c)) candles.push(c);
  }
  return candles.length ? { candles, actions: [], symbol } : null;
}

/* ----- NSE NextApi proxy (TASK-30) -----
 * www.nseindia.com/api/NextApi/apiClient/* is the revamped site's server-side
 * proxy and is NOT Akamai-guarded — keyless curl works (live-verified
 * 2026-08-23, docs/data-sources.md §1a). getHistoricalTradeData serves raw
 * daily OHLCV+VWAP back to the exchange's archive floor (1996-01-01 for
 * RELIANCE; listing-era rows before that simply don't exist upstream).
 * Caps: 70 rows/request walking back from toDate; oversized ranges error. */

export const NSE_FLOOR = "1996-01-01";

const NSE_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/* ms -> "DD-MM-YYYY" (the proxy's expected format) */
export function fmtDmy(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}-${p(d.getUTCMonth() + 1)}-${d.getUTCFullYear()}`;
}

/* "DD-Mon-YYYY" (mtimestamp) -> ms, or NaN when malformed */
function dmyMonToMs(s) {
  const m = /^(\d{2})-([A-Za-z]{3})-(\d{4})$/.exec(String(s));
  if (!m) return Number.NaN;
  const mon = NSE_MONTHS.findIndex((x) => x.toLowerCase() === m[2].toLowerCase());
  if (mon < 0) return Number.NaN;
  return Date.UTC(Number(m[3]), mon, Number(m[1]));
}

export function nseTradeUrl(symbol, fromDate, toDate) {
  return "https://www.nseindia.com/api/NextApi/apiClient/GetQuoteApi" +
    `?functionName=getHistoricalTradeData&symbol=${encodeURIComponent(symbol)}` +
    `&series=EQ&fromDate=${fromDate}&toDate=${toDate}`;
}

export function parseNseTradeRows(data, symbol) {
  if (!Array.isArray(data)) return null;
  const candles = [];
  for (const r of data) {
    if (!r || typeof r !== "object") continue;
    const tsMs = dmyMonToMs(r.mtimestamp);
    /* NSE timestamps are session dates; align to 00:00 IST like other vendors */
    const c = {
      ts: Math.floor((tsMs - 5.5 * 3600_000) / 1000),
      o: Number(r.chOpeningPrice),
      h: Number(r.chTradeHighPrice),
      l: Number(r.chTradeLowPrice),
      c: Number(r.chClosingPrice),
      v: Number(r.chTotTradedQty ?? 0),
    };
    if (isValidCandle(c)) candles.push(c);
  }
  return candles.length ? { candles, actions: [], symbol } : null;
}

/* Backward-stepping [from,to] windows, calendar-day based. 80 days keeps any
 * window under the 70-row cap even in the busiest trading months. Windows are
 * half-open by construction: w[i].to = w[i-1].from - 1 day. */
export function nseWindows(fromMs, toMs, stepDays = 80) {
  const out = [];
  let end = toMs;
  while (end >= fromMs) {
    const start = Math.max(fromMs, end - stepDays * 86_400_000);
    out.push({ from: fmtDmy(start), to: fmtDmy(end) });
    if (start <= fromMs) break;
    end = start - 86_400_000;
  }
  return out;
}

/* Fetch [fromMs, toMs] through the proxy window-by-window. Dedupes by ts and
 * returns ascending candles. getJson is injectable for tests. All requests
 * share one cookie session (bootstrapped like a browser) — a burst of
 * cookie-less one-shot clients reads as bot traffic to Akamai and gets the
 * IP throttled mid-run (observed 2026-08-23). */
let nseSession = { jar: null, bootstrappedAt: 0 };

export async function ensureNseSession(backoff, log, { maxAgeMs = 10 * 60_000 } = {}) {
  if (!nseSession.jar || Date.now() - nseSession.bootstrappedAt > maxAgeMs) {
    const jar = path.join(os.tmpdir(), "niftyterm-nse-cookies.txt");
    await curlBootstrap("https://www.nseindia.com", jar);
    nseSession = { jar, bootstrappedAt: Date.now() };
    log(`[nse] session bootstrapped (${jar})`);
  }
  return nseSession.jar;
}

export async function fetchNseHistory(symbol, {
  fromMs,
  toMs,
  backoff = defaultBackoff,
  getJson,
  delayMs = 1_200,
  log = () => {},
} = {}) {
  const fetcher = getJson ?? ((url) => backoff.getJson(url));
  const windows = nseWindows(fromMs, toMs);
  const byTs = new Map();
  for (let i = 0; i < windows.length; i++) {
    const w = windows[i];
    try {
      const parsed = parseNseTradeRows(await fetcher(nseTradeUrl(symbol, w.from, w.to)), symbol);
      if (parsed) for (const c of parsed.candles) byTs.set(c.ts, c);
    } catch (e) {
      log(`[nse] ${symbol} window ${w.from}..${w.to} failed: ${String(e?.message ?? e).slice(0, 80)}`);
    }
    if (i % 10 === 9) log(`[nse] ${symbol}: ${i + 1}/${windows.length} windows`);
    if (i < windows.length - 1) await delay(delayMs);
  }
  return [...byTs.values()].sort((a, b) => a.ts - b.ts);
}

/* Resolve a user-supplied ticker ("RELIANCE", "RELIANCE.NS", "reliance.eq")
 * to {symbol, exchange, name}, NSE-preferred. Falls back to an NSE item when
 * instruments.json doesn't know the symbol. */
export function resolveSymbolItem(instruments, raw) {
  const sym = String(raw).trim().toUpperCase().replace(/\.(NS|BO|EQ)$/i, "");
  const rows = instruments.filter((x) => x && x.s === sym && ["NSE", "BSE"].includes(x.e));
  const pick = rows.find((x) => x.e === "NSE") ?? rows[0];
  if (pick) return { symbol: pick.s, exchange: pick.e, name: pick.n ?? pick.s };
  return { symbol: sym, exchange: "NSE", name: sym };
}

/* NSE corporate-actions list (open publication endpoint, docs §1). Parsed
 * conservatively: only split/bonus subjects whose ratio regexes match become
 * {type:'split'} actions; everything else (dividends, AGMs, …) is ignored. */
export function nseCorpActionsUrl(symbol) {
  return "https://www.nseindia.com/api/corporates-corporateActions?index=equities" +
    `&symbol=${encodeURIComponent(symbol)}`;
}

export function parseNseCorpActions(data) {
  if (!Array.isArray(data)) return [];
  const out = [];
  for (const r of data) {
    if (!r || typeof r.subject !== "string" || typeof r.exDate !== "string") continue;
    const dm = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(r.exDate.trim());
    if (!dm) continue;
    const mon = NSE_MONTHS.findIndex((x) => x.toLowerCase() === dm[2].toLowerCase());
    if (mon < 0) continue;
    const iso = `${dm[3]}-${String(mon + 1).padStart(2, "0")}-${dm[1].padStart(2, "0")}`;
    const s = r.subject;
    let ratio = null;
    const bonus = /bonus[^0-9]*(\d+)\s*:\s*(\d+)/i.exec(s);
    const split = /split[^0-9]*(\d+(?:\.\d+)?)\s*(?:to|-|–)\s*(\d+(?:\.\d+)?)/i.exec(s);
    const fv = /(?:f\.?v\.?|face\s*value)[^\d]*(\d+(?:\.\d+)?)\s*(?:to|-|–)\s*(\d+(?:\.\d+)?)/i.exec(s);
    if (bonus) {
      const a = Number(bonus[1]), b = Number(bonus[2]);
      if (a > 0 && b > 0) ratio = (a + b) / b;
    } else if (split) {
      const from = Number(split[1]), to = Number(split[2]);
      if (from > 0 && to > 0) ratio = from / to;
    } else if (fv) {
      const from = Number(fv[1]), to = Number(fv[2]);
      if (from > 0 && to > 0) ratio = from / to;
    }
    if (ratio !== null && ratio >= 0.05 && ratio <= 100) {
      out.push({ type: "split", date: iso, ratio, raw: { source: "nse", subject: s } });
    }
  }
  return out;
}

async function fetchNseCorpActions(symbol, backoff, log, jar) {
  try {
    const data = await backoff.getJson(nseCorpActionsUrl(symbol), jar ? { cookieJar: jar } : {});
    const actions = parseNseCorpActions(data);
    log(`[nse-ca] ${symbol}: ${actions.length} split/bonus events parsed`);
    return actions;
  } catch (e) {
    log(`[nse-ca] ${symbol} unavailable: ${String(e?.message ?? e).slice(0, 80)}`);
    return [];
  }
}



/* ----- fetchers (chain) ----- */

export function yahooUrl(symbol, years, host = "query1") {
  const range = years > 10 ? "max" : `${years}y`;
  return `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?range=${range}&interval=1d&includePrePost=false&events=div%2Csplit`;
}

export function moneycontrolUrl(symbol, years) {
  const now = Math.floor(Date.now() / 1000);
  const from = now - Math.ceil(years * 365.25) * 86_400;
  const countback = Math.min(years * 260 + 50, 3000);
  return `https://priceapi.moneycontrol.com/techCharts/indianMarket/stock/history` +
    `?symbol=${encodeURIComponent(symbol)}&resolution=1D&from=${from}&to=${now}` +
    `&countback=${countback}&currencyCode=INR`;
}

export function growwUrl(symbol, exchange, size = 480) {
  const now = Math.floor(Date.now() / 1000);
  return `https://groww.in/v1/api/charting_service/v2/chart/exchange/${exchange}/segment/CASH/` +
    `${encodeURIComponent(symbol)}/daily?endTimeInMillis=${now * 1000}&size=${size}`;
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/* Fetch one symbol through the chain. Returns {source, candles, actions, raw} or null.
 * `breaker` ({open, note429}) short-circuits a source that has proven to be down
 * (e.g. Yahoo's IP-wide 429s) so the run doesn't burn backoff time per symbol. */
export async function fetchEodForSymbol(item, { years = 10, backoff = defaultBackoff, breaker } = {}) {
  const yahooSym = `${item.symbol}.${item.exchange === "BSE" ? "BO" : "NS"}`;
  const bare = item.symbol;

  let yahooRateLimited = false;
  if (!breaker?.open) {
    for (const host of ["query1", "query2"]) {
      try {
        const data = await backoff.getJson(yahooUrl(yahooSym, years, host));
        const parsed = parseYahooChart(data, yahooSym);
        if (parsed) return { source: "yahoo", symbol: yahooSym, raw: data, ...parsed };
        break; /* 200 but no candles — invalid symbol; try the next source */
      } catch (e) {
        if (isRateLimited(e)) {
          yahooRateLimited = true;
          breaker?.note429?.();
          continue;
        }
        break;
      }
    }
  }

  try {
    const data = await backoff.getJson(moneycontrolUrl(bare, years));
    const parsed = parseMoneycontrolChart(data, bare);
    if (parsed) return { source: "moneycontrol", symbol: bare, raw: data, ...parsed };
  } catch (e) {
    if (isRateLimited(e) && yahooRateLimited) throw e; /* both down — give up on symbol */
  }

  for (const ex of [item.exchange, item.exchange === "NSE" ? "BSE" : "NSE"]) {
    try {
      const data = await backoff.getJson(growwUrl(bare, ex), { headers: { "x-app-id": "growwWeb" } });
      const parsed = parseGrowwChart(data, bare);
      if (parsed) return { source: "groww", symbol: bare, raw: data, ...parsed };
    } catch (e) {
      if (isRateLimited(e) && yahooRateLimited) throw e;
    }
  }
  return null;
}

/* ----- storage ----- */

export function upsertCandles(db, symbol, candles) {
  const stmt = db.prepare(
    `INSERT INTO eod_candles (symbol, ts, o, h, l, c, v, adj_factor)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)
     ON CONFLICT (symbol, ts) DO UPDATE SET
       o = excluded.o, h = excluded.h, l = excluded.l, c = excluded.c,
       v = excluded.v`
  );
  const tx = db.transaction((rows) => {
    for (const r of rows) stmt.run(symbol, r.ts, r.o, r.h, r.l, r.c, r.v);
  });
  tx(candles);
  return candles.length;
}

/* storeCandlesReconciled moved to scripts/lib/basis.mjs (TASK-36 hotfix:
 * calendar-day dedup across vendor stamp conventions) and re-exported for
 * existing callers. */

export function epochSecForDate(dateStr) {
  const [y, m, d] = String(dateStr).split("-").map(Number);
  return Math.floor((Date.UTC(y, m - 1, d) - 5.5 * 3600_000) / 1000); // 00:00 IST
}

/* Merge corporate actions (splits/dividends) into corporate_actions, upserting
 * on (symbol, ts, type). payload_json keeps {ratio, raw} for later recomputes. */
export function mergeCorporateActions(db, actions) {
  const stmt = db.prepare(
    `INSERT INTO corporate_actions (symbol, ts, type, payload_json)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (symbol, ts, type) DO UPDATE SET payload_json = excluded.payload_json`
  );
  const tx = db.transaction((rows) => {
    for (const a of rows) {
      if (!["split", "dividend", "bonus"].includes(a.type)) continue;
      stmt.run(a.symbol, epochSecForDate(a.date), a.type,
        JSON.stringify({ ratio: a.ratio ?? null, raw: a.raw ?? { source: "unknown" } }));
    }
  });
  tx(actions);
  return actions.length;
}

/* Rebuild adj_factor end-to-end from corporate_actions (idempotent). Per the
 * canonical convention in docs/data-sources.md: factor = product of split
 * ratios with ex-date <= candle date (multiplication on/after ex-date).
 * Deviation (documented in TASK-09.md): dividends are NOT applied to
 * adj_factor (spec §5); "trivial" dividend adjustment is deferred — the
 * factor stays price-only in v1.
 *
 * PREMISE WARNING (TASK-15): this algorithm assumes eod_candles.c holds RAW
 * prices. Today's chain stores Yahoo's pre-adjusted closes, so factors built
 * here double-adjust and inject cliffs. Callers must not enable it until the
 * storage lineage is fixed (raw vendor or de-adjust on write). Kept exported
 * for its unit tests and the future raw path. */
export function recomputeAdjFactors(db, symbol) {
  const splits = db
    .prepare("SELECT ts, payload_json FROM corporate_actions WHERE symbol = ? AND type = 'split' ORDER BY ts")
    .all(symbol)
    .map((r) => ({ ts: r.ts, ratio: JSON.parse(r.payload_json).ratio }))
    .filter((s) => s.ratio && s.ratio > 0);
  const candles = db.prepare("SELECT ts FROM eod_candles WHERE symbol = ? ORDER BY ts").all(symbol);
  const update = db.prepare("UPDATE eod_candles SET adj_factor = ? WHERE symbol = ? AND ts = ?");
  const tx = db.transaction((rows) => {
    let i = 0, factor = 1;
    for (const c of rows) {
      while (i < splits.length && splits[i].ts <= c.ts) { factor *= splits[i].ratio; i++; }
      update.run(factor, symbol, c.ts);
    }
  });
  tx(candles);
}

export function loadCorpActionFeed() {
  if (!existsSync(CORP_ACTIONS_PATH)) return [];
  try {
    return JSON.parse(readFileSync(CORP_ACTIONS_PATH, "utf8"));
  } catch {
    return [];
  }
}

/* ----- main ----- */

export async function ingest({ universe = "nifty500", years = 10, dbPath = DEFAULT_DB_PATH,
  nowMs = Date.now(), quiet = false, force = false, symbol = null } = {}) {
  const db = openDb(dbPath);
  applyMigrations(db);
  const instruments = loadInstruments();
  const singleMode = symbol != null && String(symbol).trim() !== "";
  const universeRows = singleMode
    ? [resolveSymbolItem(instruments, symbol)]
    : resolveUniverse(instruments, universe);
  if (singleMode) years = Math.max(years, 30); /* one request each — go for max depth */
  const log = (msg) => { if (!quiet) console.error(msg); };

  const feed = loadCorpActionFeed();
  const feedBySymbol = new Map();
  for (const a of feed) {
    if (!["split", "dividend", "bonus"].includes(a.type) || !a.date) continue;
    if (!feedBySymbol.has(a.symbol)) feedBySymbol.set(a.symbol, []);
    feedBySymbol.get(a.symbol).push(a);
  }

  const stats = { fetched: 0, skipped: 0, failed: [], candles: 0, sources: {} };
  mkdirSync(RAW_EOD_DIR, { recursive: true });
  const backoff = new HostBackoff();
  const yahooBreaker = { open: false, failures: 0, threshold: 3, note429() { this.failures++; if (this.failures >= this.threshold) this.open = true; } };
  const started = Date.now();

  for (const item of universeRows) {
    const yahooSym = `${item.symbol}.${item.exchange === "BSE" ? "BO" : "NS"}`;
    try {
      if (!force && isCurrent(db, yahooSym, nowMs)) {
        stats.skipped += 1;
        log(`[skip] ${yahooSym} — already current`);
        continue;
      }
      const got = await fetchEodForSymbol(item, { years, backoff, breaker: yahooBreaker });
      if (!got && !singleMode) {
        stats.failed.push(yahooSym); log(`[fail] ${yahooSym} — all sources exhausted`); continue;
      }
      if (got) {
        stats.fetched += 1;
        stats.sources[got.source] = (stats.sources[got.source] ?? 0) + 1;
        storeCandlesReconciled(db, yahooSym, got.candles, log);
        stats.candles += got.candles.length;

        const actions = got.actions.map((a) => ({ ...a, symbol: yahooSym }));
        const feedActions = feedBySymbol.get(yahooSym) ?? [];
        if (feedActions.length) {
          const have = new Set(actions.map((a) => `${a.type}|${a.date}`));
          actions.push(...feedActions.filter((a) => !have.has(`${a.type}|${a.date}`)));
        }
        if (actions.length) mergeCorporateActions(db, actions);

        try {
          writeFileSync(path.join(RAW_EOD_DIR, `${yahooSym}.json`),
            JSON.stringify({ source: got.source, fetchedAt: Math.floor(started / 1000), raw: got.raw }) + "\n");
        } catch { /* raw cache is best-effort */ }

        log(`[ok] ${yahooSym} — ${got.candles.length} candles via ${got.source}${actions.length ? `, ${actions.length} events` : ""}`);
      }

      /* NSE tail-fill (single-symbol mode only): the bulk chain floors at
       * 2000-01 (MC) or worse; the NextApi proxy reaches the exchange's
       * 1996 archive. Fetch whatever the stored series is still missing. */
      if (singleMode && item.exchange === "NSE") {
        const floorTs = epochSecForDate(NSE_FLOOR);
        /* Measure coverage at/above the archive floor only — stray rows can
         * legally exist below it (e.g. a 31-Dec-1995 session), and MIN(ts)
         * over those would push the seam under fromMs, collapsing the sweep
         * to zero windows. */
        const minRow = db.prepare("SELECT MIN(ts) AS minTs FROM eod_candles WHERE symbol = ? AND ts >= ?").get(yahooSym, floorTs);
        const haveFrom = minRow?.minTs ?? null;
        /* MIN(ts) alone proves recency, not integrity — a legacy segment can
         * occupy these keys on a foreign (adjusted) basis. --force therefore
         * always re-sweeps so raw overwrites whatever sits below the seam. */
        if (!haveFrom || haveFrom > floorTs + 86_400 || force) {
          const jar = await ensureNseSession(backoff, log);
          /* force = rebuild the whole pre-today range raw, whatever MIN(ts)
           * claims; otherwise stop just below the oldest covered session. */
          const tailToMs = force
            ? nowMs
            : Math.max(floorTs * 1000, Math.min((haveFrom - 86_400) * 1000 || nowMs, nowMs));
          const nseCandles = await fetchNseHistory(item.symbol, {
            fromMs: floorTs * 1000, toMs: tailToMs, backoff, log,
            getJson: (url) => backoff.getJson(url, { cookieJar: jar }),
          });
          if (nseCandles.length) {
            /* Replace the whole swept range with the pure NSE series.
             * Plain upsert is NOT enough: (a) legacy segments can sit on
             * foreign bases — MC's deep history is silently split-adjusted
             * even though its recent tail is raw (observed ÷4 @2014); and
             * (b) MC stamps sessions at 00:00 UTC vs our 00:00 IST keys, so
             * both rows survive per session and interleave a sawtooth. The
             * sweep covered every session in range (failures logged), so
             * delete-then-write leaves one coherent raw series behind. */
            /* eod_candles.ts is SECONDS — passing ms here makes BETWEEN an
             * empty range and silently deletes nothing (seen live). */
            db.prepare("DELETE FROM eod_candles WHERE symbol = ? AND ts BETWEEN ? AND ?")
              .run(yahooSym, floorTs, Math.ceil(tailToMs / 1000));
            const inserted = upsertCandles(db, yahooSym, nseCandles);
            if (inserted !== nseCandles.length) {
              log(`[warn] ${yahooSym}: ${nseCandles.length - inserted} duplicate NSE sessions dropped`);
            }
            stats.candles += nseCandles.length;
            stats.sources.nse = (stats.sources.nse ?? 0) + 1;
            log(`[ok] ${yahooSym} — ${inserted} candles via nse (${fmtDmy(nseCandles[0].ts * 1000)}..${fmtDmy(nseCandles[nseCandles.length - 1].ts * 1000)})`);
          } else {
            log(`[warn] ${yahooSym} — NSE tail-fill returned nothing`);
          }
        }
        if (!got && !db.prepare("SELECT 1 FROM eod_candles WHERE symbol = ? LIMIT 1").get(yahooSym)) {
          stats.failed.push(yahooSym);
          log(`[fail] ${yahooSym} — all sources exhausted`);
        }
      } else if (!got) {
        stats.failed.push(yahooSym);
        log(`[fail] ${yahooSym} — all sources exhausted`);
      }

      /* Raw-vendor path (ADR-0002): in single-symbol mode the series comes
       * from MC/NSE — both RAW. With corporate actions present, per-row
       * adj_factor makes the stored series split-safe downstream
       * (toAdjustedCandles). Yahoo-sourced series stay on the TASK-15
       * legacy basis (pre-adjusted closes, factor untouched) to avoid
       * double-adjustment.
       * Recompute runs EVERY time the raw series was rewritten — a rewrite
       * resets rows to adj_factor=1 even when the events themselves are
       * already on file, so "no new events" must never skip the rebuild. */
      if (singleMode && stats.sources.nse) {
        const jar = nseSession.jar;
        const caActions = await fetchNseCorpActions(item.symbol, backoff, log, jar);
        if (caActions.length) {
          mergeCorporateActions(db, caActions.map((a) => ({ ...a, symbol: yahooSym })));
        }
        recomputeAdjFactors(db, yahooSym);
        log(`[adj] ${yahooSym}: adj_factor rebuilt from ${caActions.length} split/bonus events on file`);
      }
      // NOTE (TASK-15): recomputeAdjFactors is intentionally NOT invoked here.
      // The Yahoo v8 chain stores ALREADY split-adjusted closes (verified:
      // stored series is continuous across every split; applying event factors
      // on top injects fake 100–950% cliffs). Multiplying again corrupts the
      // series until a truly-raw vendor lands — see docs/task-reports/
      // TASK-15-adjusted-closes.md and the data-lineage task on the board.
    } catch (e) {
      stats.failed.push(yahooSym);
      log(`[fail] ${yahooSym} — ${String(e?.message ?? e).slice(0, 100)}`);
    }
    await delay(250);
  }

  const size = existsSync(dbPath) ? statSync(dbPath).size : 0;
  const summary = {
    universe: singleMode ? `symbol:${universeRows[0].symbol}` : universe,
    symbols: universeRows.length,
    fetched: stats.fetched, skipped: stats.skipped,
    failed: stats.failed, candles: stats.candles,
    sources: stats.sources, dbSizeBytes: size, tookMs: Date.now() - started,
  };
  db.close();
  return summary;
}

const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const quick = argv.includes("--quick");
  const symbolArg = opt("--symbol", null);
  const universe = quick ? "nifty50" : opt("--universe", "nifty500");
  const years = quick ? 1 : Number(opt("--years", "10")) || 10;
  ingest({ universe, years, force: argv.includes("--force"), symbol: symbolArg })
    .then((s) => {
      console.log(JSON.stringify(s, null, 2));
      if (s.failed.length) console.error(`failed (${s.failed.length}): ${s.failed.join(", ")}`);
    })
    .catch((e) => { console.error("fatal:", e); process.exit(1); });
}
