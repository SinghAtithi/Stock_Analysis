#!/usr/bin/env node
/* fetch-corporate-actions.mjs — PoC: corporate actions for NIFTY 50.
 * Primary: Yahoo v8 chart `events=div,split,capitalGain` via the curl-subprocess pattern
 * from web/src/lib/marketData.ts (undici gets TLS-fingerprinted/429'd). 60s+ backoff on
 * 429, one retry per symbol (query1 → query2).
 * Fallback (Yahoo IP-blocked or fetch failure): NSE /api/corporates-corporateActions
 * (verified open; see docs/data-sources.md) — parses subject strings for bonus/split/dividend.
 * Output: data/corporate_actions.json
 * Schema: [{symbol, type: "split"|"dividend"|"bonus", date, ratio, raw}] — ratio is the
 * split factor (e.g. 2 for 2:1) or the dividend amount in INR; raw carries {source, ...}.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function curlJson(url, { timeoutMs = 20_000 } = {}) {
  const { stdout } = await execFileAsync(
    "curl",
    [
      "-sS",
      "-f",
      "-m",
      String(Math.ceil(timeoutMs / 1000)),
      "--compressed",
      "-H",
      `User-Agent: ${UA}`,
      "-H",
      "Accept: application/json, text/plain, */*",
      url,
    ],
    { maxBuffer: 64 * 1024 * 1024, encoding: "utf8" }
  );
  return JSON.parse(stdout);
}

const is429 = (e) => /429|Too Many Requests/i.test(String(e?.message ?? e));

const SYMBOLS = [
  "RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "ICICIBANK.NS", "BHARTIARTL.NS",
  "SBIN.NS", "INFY.NS", "ITC.NS", "LT.NS", "HINDUNILVR.NS",
  "AXISBANK.NS", "BAJFINANCE.NS", "KOTAKBANK.NS", "MARUTI.NS", "M&M.NS",
  "SUNPHARMA.NS", "TITAN.NS", "ULTRACEMCO.NS", "ASIANPAINT.NS", "HCLTECH.NS",
  "NTPC.NS", "POWERGRID.NS", "TATAMOTORS.NS", "ADANIENT.NS", "ADANIPORTS.NS",
  "TATASTEEL.NS", "JSWSTEEL.NS", "TECHM.NS", "WIPRO.NS", "GRASIM.NS",
  "COALINDIA.NS", "ONGC.NS", "BPCL.NS", "HINDALCO.NS", "DRREDDY.NS",
  "CIPLA.NS", "NESTLEIND.NS", "BAJAJFINSV.NS", "EICHERMOT.NS", "HEROMOTOCO.NS",
  "TRENT.NS", "BEL.NS", "TATACONSUM.NS", "HDFCLIFE.NS", "SBILIFE.NS",
  "INDUSINDBK.NS", "SHRIRAMFIN.NS", "APOLLOHOSP.NS", "DIVISLAB.NS", "LTIM.NS",
];

const RETRY_DELAY_MS = 65_000;

function chartUrl(symbol, host = "query1") {
  return (
    `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?range=max&interval=1mo&includePrePost=false&events=div%2Csplit%2CcapitalGain`
  );
}

function parseEvents(symbol, data) {
  const out = [];
  const result = data?.chart?.result?.[0];
  const events = result?.events;
  if (!events) return out;
  const fmt = (ts) => {
    const d = new Date(ts * 1000);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  const splits = Object.entries(events?.splits ?? {});
  const divs = Object.entries(events?.dividends ?? {});
  for (const [ts, ev] of splits) {
    out.push({
      symbol,
      type: "split",
      date: fmt(Number(ts)),
      ratio: ev?.numerator && ev?.denominator
        ? Number(ev.numerator) / Number(ev.denominator)
        : null,
      raw: { source: "yahoo", ...ev },
    });
  }
  for (const [ts, ev] of divs) {
    const date = fmt(Number(ts));
    if (Number(ev?.amount) === 0 && splits.some(([t]) => fmt(Number(t)) === date)) continue;
    out.push({
      symbol,
      type: "dividend",
      date,
      ratio: Number(ev?.amount) || null,
      raw: { source: "yahoo", ...ev },
    });
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out;
}

async function fetchWithBackoff(symbol, attempt, breaker) {
  if (breaker.open) throw new Error(`429 circuit open (${breaker.failures} consecutive yahoo failures)`);
  const host = attempt === 1 ? "query1" : "query2";
  const url = chartUrl(symbol, host);
  for (;;) {
    try {
      return await curlJson(url);
    } catch (e) {
      if (is429(e)) {
        breaker.failures += 1;
        if (breaker.failures >= breaker.threshold) breaker.open = true;
        if (attempt === 1) {
          console.error(`[429] ${symbol} — backing off ${RETRY_DELAY_MS / 1000}s (retry once)`);
          await delay(RETRY_DELAY_MS);
          return fetchWithBackoff(symbol, 2, breaker);
        }
        throw e;
      }
      throw e;
    }
  }
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function isoToNse(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}-${MONTHS[Number(m) - 1]}-${y}`;
}

async function nseSubjects(symbol) {
  const nseSymbol = symbol.replace(".NS", "");
  const url = `https://www.nseindia.com/api/corporates-corporateActions?index=equities&symbol=${encodeURIComponent(nseSymbol)}`;
  try {
    const rows = await curlJson(url, { timeoutMs: 15_000 });
    if (!Array.isArray(rows)) return null;
    const map = new Map();
    for (const r of rows) {
      if (r?.exDate && r?.subject) map.set(r.exDate.toUpperCase(), r.subject);
    }
    return map;
  } catch {
    return null;
  }
}

async function classifySplits(actions) {
  const cache = new Map();
  for (const a of actions) {
    if (a.type !== "split" || a.raw?.source !== "yahoo") continue;
    const symbol = a.symbol;
    if (!cache.has(symbol)) cache.set(symbol, await nseSubjects(symbol));
    const subjects = cache.get(symbol);
    const subject = subjects?.get(isoToNse(a.date).toUpperCase());
    if (subject && /bonus/i.test(subject)) {
      a.type = "bonus";
      a.raw = { ...a.raw, nseSubject: subject };
    } else if (subject && /split|sub.?division|consolidation/i.test(subject)) {
      a.raw = { ...a.raw, nseSubject: subject };
    }
  }
  return actions;
}

/* ---------- NSE fallback (Yahoo 429s are common; NSE corporates endpoint verified open) ---------- */

const NSE_MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function nseDateToIso(d) {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(String(d).trim());
  if (!m) return null;
  const month = NSE_MONTHS[m[2].toLowerCase()];
  if (!month) return null;
  return `${m[3]}-${String(month).padStart(2, "0")}-${String(Number(m[1])).padStart(2, "0")}`;
}

function parseNseRow(symbol, row) {
  const subject = String(row?.subject ?? "");
  const date = nseDateToIso(row?.exDate);
  if (!date) return [];
  const out = [];
  const fv = Number(row?.faceVal) || null;

  const bonus = /bonus\s*(\d+)\s*:\s*(\d+)/i.exec(subject);
  const isDebentureBonus = /debenture/i.test(subject);
  const split = /split|sub.?division|consolidation/i.test(subject) && !isDebentureBonus;
  const fvSplit = /(?:from\s*)?R(?:s|e)\.?\s*([\d.]+)\s*(?:\/-)?(?:\s*per\s*share)?\s*to\s*R(?:s|e)\.?\s*([\d.]+)/i.exec(subject);
  const pctDiv = /(?:dividend|div\.?)\s*-?\s*(\d+(?:\.\d+)?)\s*%/i.exec(subject);
  const amt =
    /Rs\.?\s*-?\s*([\d.]+)/i.exec(subject) ??
    /Re\.?\s*-?\s*([\d.]+)/i.exec(subject) ??
    /(?:dividend|div\.?)\s*-?\s*([\d.]+)\s*(?:\/-|per\s*share)?/i.exec(subject);

  if (bonus && !isDebentureBonus) {
    const [_, given, held] = bonus.map(Number);
    out.push({
      symbol,
      type: "bonus",
      date,
      ratio: held ? 1 + given / held : null,
      raw: { source: "nse", ...row },
    });
  }
  if (split && fvSplit) {
    out.push({
      symbol,
      type: "split",
      date,
      ratio: Number(fvSplit[2]) ? Number(fvSplit[1]) / Number(fvSplit[2]) : null,
      raw: { source: "nse", ...row },
    });
  } else if (split) {
    out.push({ symbol, type: "split", date, ratio: null, raw: { source: "nse", ...row } });
  }
  if (/dividend|div\.|div-|div\//i.test(subject) && !isDebentureBonus) {
    let amount = null;
    if (pctDiv && fv) amount = (fv * Number(pctDiv[1])) / 100;
    else if (amt) amount = Number(amt[1]);
    out.push({
      symbol,
      type: "dividend",
      date,
      ratio: amount,
      raw: { source: "nse", ...row },
    });
  }
  return out;
}

async function fetchNseActions(symbol) {
  const nseSymbol = symbol.replace(".NS", "");
  const url = `https://www.nseindia.com/api/corporates-corporateActions?index=equities&symbol=${encodeURIComponent(nseSymbol)}`;
  const rows = await curlJson(url, { timeoutMs: 15_000 });
  if (!Array.isArray(rows)) return [];
  return rows
    .flatMap((r) => parseNseRow(symbol, r))
    .filter(Boolean)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

async function preflightYahoo() {
  try {
    await curlJson(chartUrl("TCS.NS"), { timeoutMs: 15_000 });
    return true;
  } catch (e) {
    if (is429(e)) console.error("[preflight] yahoo 429 — starting with circuit open");
    return false;
  }
}

async function run() {
  const actions = [];
  const failed = [];
  const noEvents = [];
  const sourceCount = { yahoo: 0, nse: 0 };
  const breaker = { failures: 0, threshold: 3, open: false };
  if (process.env.POC_PREFLIGHT === "1" && !(await preflightYahoo())) {
    breaker.open = true;
    breaker.failures = 3;
  }
  for (const symbol of SYMBOLS) {
    try {
      let parsed = null;
      let source = null;
      try {
        const data = await fetchWithBackoff(symbol, 1, breaker);
        if (data?.chart?.result?.length) {
          parsed = parseEvents(symbol, data);
          source = "yahoo";
        }
      } catch (e) {
        if (!breaker.open) console.error(`[warn] ${symbol} — yahoo: ${String(e?.message ?? e).slice(0, 60)}`);
      }
      if (!parsed) {
        parsed = await fetchNseActions(symbol);
        source = "nse";
      }
      if (!parsed.length) noEvents.push(symbol);
      else {
        actions.push(...parsed);
        sourceCount[source] += 1;
      }
      console.error(
        `[ok] ${symbol} — ${parsed.length} events via ${source}` +
          (parsed.length ? ` (${parsed[0].date} .. ${parsed[parsed.length - 1].date})` : "")
      );
    } catch (e) {
      failed.push(symbol);
      console.error(`[fail] ${symbol} — ${String(e?.message ?? e).slice(0, 80)}`);
    }
    await delay(400);
  }
  const outPath = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "corporate_actions.json");
  mkdirSync(dirname(outPath), { recursive: true });
  await classifySplits(actions).catch(() => {});
  writeFileSync(outPath, JSON.stringify(actions, null, 2) + "\n");
  const byType = actions.reduce((m, a) => {
    m[a.type] = (m[a.type] ?? 0) + 1;
    return m;
  }, {});
  console.error(
    `\ncoverage: ${SYMBOLS.length - failed.length}/${SYMBOLS.length} symbols fetched, ` +
      `${actions.length} corporate actions (${JSON.stringify(byType)}) written to ${outPath}` +
      `\nby source: ${JSON.stringify(sourceCount)}` +
      (noEvents.length ? `\nno events: ${noEvents.join(", ")}` : "") +
      (failed.length ? `\nfailed: ${failed.join(", ")}` : "")
  );
}

if (process.env.POC_SELFTEST !== "1") run();

export { parseEvents, parseNseRow, nseDateToIso };
