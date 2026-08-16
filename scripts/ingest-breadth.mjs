#!/usr/bin/env node
/* ingest-breadth.mjs — T13: breadth & flows pipeline.
 * Writes breadth_series rows (name, ts = UTC midnight of the trading day, payload_json).
 *   name 'vix'         — India VIX daily closes (Yahoo v8 chart ^INDIAVIX, 1y). Fallback:
 *                        Google Finance quote scrape (name 'vix_spot', ~1M daily closes).
 *   name 'fiidii'      — NSE /api/fiidiiTradeReact (observed: ONLY the latest trading day,
 *                        two rows FII/FPI + DII; no equity/debt split, no history).
 *   name 'breadth'     — adv/dec/unc + 52W hi/lo computed from eod_candles (rolling 252d
 *                        window). If eod_candles is empty, bootstraps via
 *                        `node scripts/ingest-eod.mjs --universe nifty50 --quick`; if that
 *                        is unavailable/fails, computes spot breadth for the NIFTY 50
 *                        universe (name 'breadth_spot') from Yahoo v8 1d -> Moneycontrol
 *                        priceapi 1y -> Google Finance 1M daily closes.
 * Usage: node scripts/ingest-breadth.mjs [--days N]   (N = newest days to ingest, default 30)
 * Idempotent: dates already present in breadth_series are skipped.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, DEFAULT_DB_PATH, REPO_ROOT } from "./lib/db.mjs";
import { curlJson, HostBackoff, isRateLimited } from "./lib/curl.mjs";
import { applyMigrations } from "./migrate.mjs";

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
export const RAW_DIR = path.join(REPO_ROOT, "data", "raw", "breadth");
export const INSTRUMENTS_PATH = path.join(REPO_ROOT, "web", "src", "data", "instruments.json");
export const INGEST_EOD_PATH = path.join(REPO_ROOT, "scripts", "ingest-eod.mjs");

const DAY_S = 86_400;
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- small helpers ---------- */

export const dayKey = (ts) => Math.floor(Number(ts) / DAY_S) * DAY_S;
export const isoOfDay = (day) => new Date(day * 1000).toISOString().slice(0, 10);
export function nseDateToIso(dateStr) {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(String(dateStr).trim());
  if (!m) return null;
  const mon = MONTHS[m[2].toLowerCase()];
  if (!mon) return null;
  const y = Number(m[3]), d = Number(m[1]);
  if (!(y >= 2000 && d >= 1 && d <= 31)) return null;
  return `${y}-${String(mon).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

async function curlHtml(url, timeoutMs = 20_000) {
  const { stdout } = await execFileAsync("curl", [
    "-sSL", "-f", "--compressed", "-m", String(Math.ceil(timeoutMs / 1000)),
    "-H", `User-Agent: ${UA}`,
    "-H", "Accept: text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
    url,
  ], { maxBuffer: 8 * 1024 * 1024, encoding: "utf8" });
  return stdout;
}

/* ---------- breadth math (pure, exported for tests) ---------- */

/* seriesBySymbol: Map<symbol, Array<{ts, c}>> sorted ascending by ts.
 * Returns per-union-day rows ascending: {ts, date, adv, dec, unc, hi, lo}.
 * - adv/dec/unc compare a symbol's close against ITS OWN previous close (gap-safe).
 * - hi/lo count symbols whose close is the max/min of the trailing `window` closes
 *   (window INCLUDING the current day); symbols with fewer than `window` closes up to
 *   that day do not contribute (e.g. a stock listed mid-window). */
export function computeBreadthSeries(seriesBySymbol, { window = 252 } = {}) {
  const days = new Set();
  const per = new Map(); /* symbol -> { closes: [{day, c}], byDay: Map<day, index> } */
  for (const [symbol, pts] of seriesBySymbol) {
    const closes = [];
    const byDay = new Map();
    for (const p of pts) {
      if (!Number.isFinite(p.c)) continue;
      const day = dayKey(p.ts);
      if (!byDay.has(day)) {
        byDay.set(day, closes.length);
        closes.push({ day, c: p.c });
        days.add(day);
      } else if (closes[byDay.get(day)].c !== p.c) {
        closes[byDay.get(day)].c = p.c; /* dedupe same-day overrides with latest close */
      }
    }
    if (closes.length) per.set(symbol, { closes, byDay });
  }
  const ordered = [...days].sort((a, b) => a - b);
  const out = [];
  for (const day of ordered) {
    let adv = 0, dec = 0, unc = 0, hi = 0, lo = 0;
    for (const { closes, byDay } of per.values()) {
      const i = byDay.get(day);
      if (i === undefined) continue;
      const cur = closes[i].c;
      if (i > 0) {
        const prev = closes[i - 1].c;
        if (cur > prev) adv += 1;
        else if (cur < prev) dec += 1;
        else unc += 1;
      }
      if (i >= window - 1) {
        let mx = -Infinity, mn = Infinity;
        for (let j = i - window + 1; j <= i; j++) {
          if (closes[j].c > mx) mx = closes[j].c;
          if (closes[j].c < mn) mn = closes[j].c;
        }
        if (cur >= mx) hi += 1;
        if (cur <= mn) lo += 1;
      }
    }
    out.push({ ts: day, date: isoOfDay(day), adv, dec, unc, hi, lo });
  }
  return out;
}

/* ---------- storage ---------- */

export function upsertBreadthRows(db, name, rows) {
  const stmt = db.prepare(
    `INSERT INTO breadth_series (name, ts, payload_json)
     VALUES (?, ?, ?)
     ON CONFLICT (name, ts) DO NOTHING`
  );
  let inserted = 0, skipped = 0;
  const tx = db.transaction((all) => {
    for (const r of all) {
      const res = stmt.run(name, r.ts, JSON.stringify(r.payload));
      if (res.changes > 0) inserted += 1;
      else skipped += 1;
    }
  });
  tx(rows);
  return { inserted, skipped };
}

function cacheRaw(name, obj) {
  try {
    mkdirSync(RAW_DIR, { recursive: true });
    writeFileSync(path.join(RAW_DIR, `${name}.json`),
      JSON.stringify({ fetchedAt: Math.floor(Date.now() / 1000), ...obj }, null, 2) + "\n");
  } catch { /* best-effort raw cache */ }
}

/* ---------- VIX ---------- */

export function yahooVixUrl(host = "query1") {
  return `https://${host}.finance.yahoo.com/v8/finance/chart/%5EINDIAVIX` +
    `?range=1y&interval=1d&includePrePost=false&events=div%2Csplit`;
}

export function parseYahooVix(data) {
  const result = data?.chart?.result?.[0];
  if (!result?.timestamp || !Array.isArray(result.indicators?.quote?.[0]?.close)) return null;
  const ts = result.timestamp, closes = result.indicators.quote[0].close;
  const rows = [];
  for (let i = 0; i < ts.length; i++) {
    const close = Number(closes[i]);
    if (!Number.isFinite(close)) continue;
    rows.push({ ts: dayKey(ts[i]), close });
  }
  return rows.length ? rows : null;
}

/* Parse Google Finance embedded AF_initDataCallback JSON; find the record whose
 * [0] pair matches [ticker, exch] and extract the 1M daily close series:
 * rec[3] = [ [1], [ [ [y,m,d,hh,mm,...], [close, change, changePct, ...] ], ... ] ] */
export function parseGoogleDaily(html, ticker, exch = "NSE") {
  const blocks = html.matchAll(
    /AF_initDataCallback\((\{key: 'ds:\d+'[\s\S]*?\})\);(?:, ?(?:true|false))?(?=<\/script>)/g
  );
  let best = null;
  for (const block of blocks) {
    const dm = /data:([\s\S]*?), sideChannel/.exec(block[1]);
    if (!dm) continue;
    let data;
    try { data = JSON.parse(dm[1]); } catch { continue; }
    if (!Array.isArray(data) || !Array.isArray(data[0])) continue;
    for (const rec of data[0]) {
      if (!Array.isArray(rec) || !Array.isArray(rec[0])) continue;
      const pair = rec[0];
      if (!(pair[0] === ticker && pair[1] === exch)) continue;
      const inner = rec[3];
      if (!Array.isArray(inner) || !Array.isArray(inner[0])) continue;
      const block = inner[0]; /* [ [1], [ [dateArr, tuple], ... ] ] */
      if (!Array.isArray(block[1])) continue;
      const rows = [];
      for (const entry of block[1]) {
        if (!Array.isArray(entry) || !Array.isArray(entry[0]) || !Array.isArray(entry[1])) continue;
        const dateArr = entry[0], tuple = entry[1];
        const close = Number(tuple[0]);
        if (dateArr.length < 5 || !Number.isFinite(close)) continue;
        const y = Number(dateArr[0]), m = Number(dateArr[1]), d = Number(dateArr[2]);
        /* NSE/INDEXNSE daily bars are stamped 15:30 IST; intraday bars vary — keep only daily. */
        if (Number(dateArr[3]) !== 15 || Number(dateArr[4]) !== 30) continue;
        if (!(y >= 2015 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) continue;
        rows.push({ ts: dayKey(Date.UTC(y, m - 1, d) / 1000), close });
      }
      if (rows.length > (best?.length ?? 0)) best = rows;
    }
  }
  if (!best) return null;
  const byDay = new Map();
  for (const r of best) byDay.set(r.ts, r.close); /* same-day: keep latest occurrence */
  return [...byDay.entries()].map(([ts, close]) => ({ ts, close }));
}

export async function fetchVix({ days, log, yahooBackoff } = {}) {
  let rows = null, source = null, raw = null;
  try {
    const data = await yahooBackoff.getJson(yahooVixUrl(), { timeoutMs: 15_000 });
    rows = parseYahooVix(data);
    if (rows) { source = "yahoo"; raw = data; }
  } catch (e) {
    if (isRateLimited(e)) log("[vix] yahoo 429 — falling back to google finance");
    else log(`[vix] yahoo failed (${String(e?.message ?? e).slice(0, 60)}) — falling back to google finance`);
  }
  if (!rows) {
    try {
      const html = await curlHtml("https://www.google.com/finance/quote/INDIA_VIX:INDEXNSE?hl=en");
      rows = parseGoogleDaily(html, "INDIA_VIX", "INDEXNSE");
      if (rows) { source = "google"; raw = { note: "google finance INDIA_VIX:INDEXNSE page, 1M daily block" }; }
    } catch (e) {
      log(`[vix] google finance failed (${String(e?.message ?? e).slice(0, 60)})`);
    }
  }
  if (!rows) { log("[vix] no data from any source"); return { name: null }; }
  const name = source === "yahoo" ? "vix" : "vix_spot";
  const recent = rows.slice(-days).map((r) => ({ ts: r.ts, payload: { ts: r.ts, close: r.close } }));
  cacheRaw(name, { source, points: rows.length, raw });
  return { name, recent, points: rows.length, source };
}

/* ---------- FII/DII ---------- */

/* Observed response (2026-08-16, /api/fiidiiTradeReact):
 * [ {"buyValue":"14295.49","category":"DII","date":"14-Aug-2026","netValue":"356.4","sellValue":"13939.09"},
 *   {"buyValue":"12854.44","category":"FII/FPI","date":"14-Aug-2026","netValue":"508.12","sellValue":"12346.32"} ]
 * Only the latest trading day is returned (JSON and ?csv=true); no equity/debt split,
 * no history. fii_total/di_total are net ₹ Cr; equity/debt fields stay null. */
export function parseFiiDii(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const byCat = {};
  for (const r of rows) {
    const cat = String(r?.category ?? "");
    if (cat === "FII/FPI") byCat.fii = Number(r?.netValue);
    else if (cat === "DII") byCat.dii = Number(r?.netValue);
  }
  const date = nseDateToIso(rows[0]?.date);
  if (!date || byCat.fii === undefined || byCat.dii === undefined) return null;
  return {
    ts: dayKey(Date.parse(`${date}T00:00:00Z`) / 1000),
    payload: {
      date,
      fii_equity: null, fii_debt: null, di_equity: null, di_debt: null,
      fii_total: byCat.fii, di_total: byCat.dii,
    },
  };
}

export async function fetchFiiDii({ log } = {}) {
  try {
    const data = await curlJson("https://www.nseindia.com/api/fiidiiTradeReact", { timeoutMs: 20_000 });
    const row = parseFiiDii(data);
    if (!row) { log(`[fiidii] unexpected shape: ${JSON.stringify(data).slice(0, 120)}`); return null; }
    cacheRaw("fiidii", { raw: data, note: "NSE fiidiiTradeReact — latest trading day only" });
    return row;
  } catch (e) {
    log(`[fiidii] fetch failed (${String(e?.message ?? e).slice(0, 80)})`);
    return null;
  }
}

/* ---------- breadth (eod_candles path) ---------- */

export function loadCandleSeries(db, cutoffDay) {
  const rows = db.prepare(
    "SELECT symbol, ts, c FROM eod_candles WHERE ts >= ? ORDER BY symbol, ts"
  ).all(cutoffDay);
  const bySymbol = new Map();
  for (const r of rows) {
    const c = Number(r.c);
    if (!Number.isFinite(c)) continue;
    if (!bySymbol.has(r.symbol)) bySymbol.set(r.symbol, []);
    bySymbol.get(r.symbol).push({ ts: r.ts, c });
  }
  return bySymbol;
}

export async function bootstrapEodCandles({ log } = {}) {
  if (!existsSync(INGEST_EOD_PATH)) { log("[breadth] ingest-eod.mjs not found — skipping bootstrap"); return false; }
  log("[breadth] bootstrapping eod_candles via ingest-eod (nifty50, quick)...");
  try {
    const { stdout, stderr } = await execFileAsync("node",
      [INGEST_EOD_PATH, "--universe", "nifty50", "--quick"],
      { cwd: REPO_ROOT, timeout: 20 * 60_000, maxBuffer: 64 * 1024 * 1024, encoding: "utf8" });
    const tail = (stderr || stdout).split("\n").filter(Boolean).slice(-6).join("\n");
    log(tail);
    return true;
  } catch (e) {
    log(`[breadth] ingest-eod bootstrap failed (${String(e?.message ?? e).slice(0, 80)})`);
    return false;
  }
}

/* ---------- breadth_spot (universe spot path) ---------- */

export function moneycontrolSpotUrl(symbol, years = 1) {
  const now = Math.floor(Date.now() / 1000);
  const from = now - Math.ceil(years * 365.25) * DAY_S;
  return `https://priceapi.moneycontrol.com/techCharts/indianMarket/stock/history` +
    `?symbol=${encodeURIComponent(symbol)}&resolution=1D&from=${from}&to=${now}` +
    `&countback=${Math.min(years * 260 + 50, 400)}&currencyCode=INR`;
}

export function parseMoneycontrolCloses(data) {
  if (data?.s !== "ok" || !Array.isArray(data?.t)) return null;
  const rows = [];
  for (let i = 0; i < data.t.length; i++) {
    const close = Number(data.c?.[i]);
    const ts = Number(data.t?.[i]);
    if (Number.isFinite(close) && Number.isFinite(ts) && ts > 946_684_800) {
      rows.push({ ts: dayKey(ts), close });
    }
  }
  return rows.length ? rows : null;
}

export function yahooSpotUrl(symbol, host = "query1") {
  return `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?range=1y&interval=1d&includePrePost=false&events=div%2Csplit`;
}

export async function loadUniverseSymbols() {
  const base = JSON.parse(await readFile(INSTRUMENTS_PATH, "utf8"));
  const rows = base.filter((x) =>
    x?.e === "NSE" && Array.isArray(x?.idx) && x.idx.includes("NIFTY 50") && !/[\^]/.test(x.s ?? ""));
  if (!rows.length) return base.filter((x) => x?.e === "NSE").slice(0, 50).map((x) => x.s);
  return rows.map((x) => x.s);
}

/* Spot chain per symbol: Yahoo v8 1d (if preflight passed) -> Moneycontrol priceapi
 * 1y -> Google Finance 1M. Returns { closes, source } or null. */
export async function fetchSpotSeries(symbol, { yahooAlive, backoff } = {}) {
  if (yahooAlive) {
    try {
      const data = await backoff.getJson(yahooSpotUrl(`${symbol}.NS`), { timeoutMs: 12_000 });
      const closes = parseYahooVix(data); /* same shape: {ts, close} rows */
      if (closes) return { closes, source: "yahoo" };
    } catch { /* fall through */ }
  }
  try {
    const data = await backoff.getJson(moneycontrolSpotUrl(symbol), { timeoutMs: 15_000 });
    const closes = parseMoneycontrolCloses(data);
    if (closes) return { closes, source: "moneycontrol" };
  } catch { /* fall through */ }
  try {
    const html = await curlHtml(`https://www.google.com/finance/quote/${encodeURIComponent(symbol)}:NSE?hl=en`);
    const closes = parseGoogleDaily(html, symbol, "NSE");
    if (closes) return { closes, source: "google" };
  } catch { /* fall through */ }
  return null;
}

/* ---------- main ---------- */

export async function ingestBreadth({ days = 30, dbPath = DEFAULT_DB_PATH, log = console.error } = {}) {
  const db = openDb(dbPath);
  applyMigrations(db);
  const started = Date.now();
  const summary = { days, vix: null, fiidii: null, ad: null };

  const yahooBackoff = new HostBackoff({ baseDelayMs: 1_000, maxDelayMs: 30_000, maxRetries: 1 });

  /* 1. VIX */
  {
    const rows = await fetchVix({ days, log, yahooBackoff });
    if (rows.name) {
      const stored = upsertBreadthRows(db, rows.name, rows.recent);
      summary.vix = { name: rows.name, ...stored, points: rows.points };
      log(`[vix] ${rows.points} daily closes via ${rows.source} -> ${rows.name} (${stored.inserted} new, ${stored.skipped} skipped)`);
    } else summary.vix = { name: null };
  }

  /* 2. FII/DII */
  {
    const row = await fetchFiiDii({ log });
    if (row) {
      const stored = upsertBreadthRows(db, "fiidii", [row]);
      summary.fiidii = { name: "fiidii", ...stored, date: row.payload.date };
      log(`[fiidii] ${row.payload.date} fii_total=${row.payload.fii_total} di_total=${row.payload.di_total} (${stored.inserted} new, ${stored.skipped} skipped)`);
    } else summary.fiidii = { name: null };
  }

  /* 3. Breadth */
  {
    const maxRow = db.prepare("SELECT MAX(ts) AS m FROM eod_candles").get();
    const cutoff = (maxRow?.m ? dayKey(maxRow.m) : Math.floor(Date.now() / 1000)) - 500 * DAY_S;
    let series = null, name = null, spotMeta = null;
    if (maxRow?.m) {
      const bySymbol = loadCandleSeries(db, cutoff);
      if (bySymbol.size) {
        series = computeBreadthSeries(bySymbol);
        name = "breadth";
      }
    }
    if (!series) {
      const bootstrapped = await bootstrapEodCandles({ log });
      const maxRow2 = db.prepare("SELECT MAX(ts) AS m FROM eod_candles").get();
      if (bootstrapped && maxRow2?.m) {
        const cutoff2 = dayKey(maxRow2.m) - 500 * DAY_S;
        const bySymbol = loadCandleSeries(db, cutoff2);
        if (bySymbol.size) {
          series = computeBreadthSeries(bySymbol);
          name = "breadth";
        }
      }
    }
    if (!series) {
      log("[breadth] eod_candles unavailable — computing spot breadth from universe quotes");
      const symbols = await loadUniverseSymbols().catch(() => []);
      let yahooAlive = true;
      try {
        await yahooBackoff.getJson(yahooSpotUrl(`${symbols[0]}.NS`), { timeoutMs: 10_000 });
      } catch (e) {
        if (isRateLimited(e)) yahooAlive = false;
      }
      log(`[breadth_spot] yahoo ${yahooAlive ? "alive" : "429 (using moneycontrol/google)"} — ${symbols.length} symbols`);
      const backoff = new HostBackoff({ baseDelayMs: 800, maxDelayMs: 20_000, maxRetries: 1 });
      const bySymbol = new Map();
      const sourceCount = {};
      let failed = [];
      for (const sym of symbols) {
        const got = await fetchSpotSeries(sym, { yahooAlive, backoff }).catch(() => null);
        if (got) {
          bySymbol.set(sym, got.closes);
          sourceCount[got.source] = (sourceCount[got.source] ?? 0) + 1;
        } else failed.push(sym);
        await delay(150);
      }
      spotMeta = { universe: symbols.length, sources: sourceCount, failed: failed.slice(0, 10) };
      if (bySymbol.size) {
        series = computeBreadthSeries(bySymbol);
        name = "breadth_spot";
        cacheRaw("breadth_spot", { universe: symbols.length, symbolsWithData: bySymbol.size, sourceCount, failed });
      }
    }
    if (series?.length) {
      const recent = series.slice(-days).map((r) => ({ ts: r.ts, payload: { date: r.date, adv: r.adv, dec: r.dec, unc: r.unc, hi: r.hi, lo: r.lo } }));
      const stored = upsertBreadthRows(db, name, recent);
      summary.ad = { name, ...stored, spanDays: series.length, spot: spotMeta };
      const last = series[series.length - 1];
      log(`[${name}] ${recent.length} days (${stored.inserted} new, ${stored.skipped} skipped) — ${last.date} adv=${last.adv} dec=${last.dec} unc=${last.unc} hi=${last.hi} lo=${last.lo}` +
        (spotMeta ? ` | spot meta: ${JSON.stringify(spotMeta)}` : ""));
    } else {
      summary.ad = { name: null };
      log("[breadth] no breadth computed (no eod_candles, no spot quotes)");
    }
  }

  db.close();
  summary.tookMs = Date.now() - started;
  return summary;
}

const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const days = Math.max(1, Number(opt("--days", "30")) || 30);
  ingestBreadth({ days })
    .then((s) => { console.log(JSON.stringify(s, null, 2)); })
    .catch((e) => { console.error("fatal:", e); process.exit(1); });
}
