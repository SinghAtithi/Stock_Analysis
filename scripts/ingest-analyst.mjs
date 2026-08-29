#!/usr/bin/env node
/* ingest-analyst.mjs — T12: analyst data pipeline (feeds S105 Analyst Revision Drift).
 *
 * Fetches Yahoo quoteSummary (recommendationTrend + earningsTrend + financialData)
 * for a universe (nifty50 | nifty100 | all), flattens the raw modules into a
 * null-safe derived_json, and upserts into analyst_data.
 *
 * Resilience: query1 -> query2 host retry, HostBackoff on 429, per-symbol cache
 * in data/raw/analyst/. Partial failure exits 0 (summary printed).
 * Rate-limited (429) failures park the host for the backoff window and do NOT
 * trip the circuit breaker — the run pauses instead of burning the universe.
 *
 * Auth: Yahoo v10 quoteSummary requires a crumb. getCrumb() (lib/curl.mjs)
 *   bootstraps an A3 session cookie from fc.yahoo.com, exchanges it for a
 *   crumb via v1/test/getcrumb, and caches {crumb, cookieJar} per process.
 *   Crumb TTL: 50 min (A3 session lifetime); expired crumbs are refreshed
 *   lazily on the next fetch. Every quoteSummary URL carries
 *   crumb=...&lang=en-US&region=US and reuses the shared cookie jar.
 *
 * Usage:
 *   node scripts/ingest-analyst.mjs [--universe nifty50|nifty100|all] [--limit N] [--force]
 */

import path from "node:path";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openDb, REPO_ROOT } from "./lib/db.mjs";
import { HostBackoff, isRateLimited, getCrumb, appendCrumb } from "./lib/curl.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const INSTRUMENTS_PATH = path.join(REPO_ROOT, "web", "src", "data", "instruments.json");
const CACHE_DIR = path.join(REPO_ROOT, "data", "raw", "analyst");

export const FRESH_SECONDS = 24 * 3600; /* rows younger than this are skipped unless --force */
const DEFAULT_DELAY_MS = 1200; /* inter-request courtesy delay after a fetch */
const MODULES = "recommendationTrend,earningsTrend,financialData";
export const CIRCUIT_OPEN_AFTER = 3; /* consecutive failures before giving up (sustained 429) */

/* ---------- null-safe helpers ---------- */

function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/* deep-read a numeric field; accepts {raw, fmt} or plain number, else null */
export function numAt(obj, keys) {
  let cur = obj;
  for (const k of keys) {
    if (cur == null || typeof cur !== "object") return null;
    cur = cur[k];
  }
  if (cur == null) return null;
  return num(typeof cur === "object" ? cur.raw : cur);
}

function strAt(obj, keys) {
  let cur = obj;
  for (const k of keys) {
    if (cur == null || typeof cur !== "object") return null;
    cur = cur[k];
  }
  return typeof cur === "string" && cur.length > 0 ? cur : null;
}

/* (new - old) / |old| * 100; null when old is missing or zero */
export function pctChange(current, previous) {
  if (current == null || previous == null || previous === 0) return null;
  return num(((current - previous) / Math.abs(previous)) * 100);
}

/* ---------- universe ---------- */

export function loadInstruments(pathOverride = INSTRUMENTS_PATH) {
  return JSON.parse(readFileSync(pathOverride, "utf8"));
}

export function buildUniverse(instruments, { universe = "nifty100" } = {}) {
  const members = (idxName) =>
    new Set(
      instruments
        .filter((i) => Array.isArray(i.idx) && i.idx.includes(idxName))
        .map((i) => i.s)
    );
  let syms;
  switch (universe) {
    case "nifty50":
      syms = [...members("NIFTY 50")];
      break;
    case "nifty100": {
      const n50 = members("NIFTY 50");
      const nnext = members("NIFTY NEXT 50");
      syms = [...new Set([...n50, ...nnext])];
      break;
    }
    case "all":
      syms = instruments.map((i) => i.s);
      break;
    default:
      throw new Error(`Unknown universe: ${universe} (expected nifty50|nifty100|all)`);
  }
  return syms.map((s) => (/\.NS$/.test(s) ? s : `${s}.NS`));
}

/* ---------- derived flattening (null-safe, no invented values) ---------- */

export function flattenDerived(payload) {
  const result = payload?.quoteSummary?.result?.[0] ?? null;
  const empty = {
    rating: null,
    ratingMean: null,
    numberOfAnalystOpinions: null,
    recommendationKey: null,
    targetMeanPrice: null,
    targetHighPrice: null,
    targetLowPrice: null,
    currentPrice: null,
    targetUpsidePct: null,
    revisionTrend: null,
  };
  if (!result) return empty;

  const rec = result.recommendationTrend?.trend?.[0];
  const fin = result.financialData;
  const et = result.earningsTrend?.trend?.[0];

  const strongBuy = numAt(rec, ["strongBuy"]);
  const buy = numAt(rec, ["buy"]);
  const hold = numAt(rec, ["hold"]);
  const sell = numAt(rec, ["sell"]);
  const strongSell = numAt(rec, ["strongSell"]);
  const total = [strongBuy, buy, hold, sell, strongSell].reduce(
    (acc, v) => acc + (v ?? 0),
    0
  );
  const rating =
    strongBuy == null && buy == null && hold == null && sell == null && strongSell == null
      ? null
      : {
          strongBuy,
          buy,
          hold,
          sell,
          strongSell,
          total,
          rawScore:
            total > 0
              ? num(
                  (5 * (strongBuy ?? 0) +
                    4 * (buy ?? 0) +
                    3 * (hold ?? 0) +
                    2 * (sell ?? 0) +
                    1 * (strongSell ?? 0)) /
                    total
                )
              : null,
        };

  const currentPrice = numAt(fin, ["currentPrice"]);
  const targetMeanPrice = numAt(fin, ["targetMeanPrice"]);
  const revisionTrend = et
    ? {
        period: strAt(et, ["period"]),
        periodEndDate: strAt(et, ["periodEndDate"]),
        growthEstimate: numAt(et, ["growth"]),
        epsEstimate: {
          avg: numAt(et, ["epsEstimate", "avg"]),
          low: numAt(et, ["epsEstimate", "low"]),
          high: numAt(et, ["epsEstimate", "high"]),
          yearAgoEps: numAt(et, ["epsEstimate", "yearAgoEps"]),
          numberOfAnalysts: numAt(et, ["epsEstimate", "numberOfAnalysts"]),
          growth: numAt(et, ["epsEstimate", "growth"]),
        },
        epsRev7dPct: pctChange(numAt(et, ["epsTrend", "current"]), numAt(et, ["epsTrend", "7dAgo"])),
        epsRev30dPct: pctChange(numAt(et, ["epsTrend", "current"]), numAt(et, ["epsTrend", "30dAgo"])),
        epsRev90dPct: pctChange(numAt(et, ["epsTrend", "current"]), numAt(et, ["epsTrend", "90dAgo"])),
      }
    : null;

  return {
    rating,
    ratingMean: numAt(fin, ["recommendationMean"]),
    numberOfAnalystOpinions:
      numAt(fin, ["numberOfAnalystOpinions"]) ?? numAt(rec, ["numberOfAnalystOpinions"]),
    recommendationKey: strAt(fin, ["recommendationKey"]),
    targetMeanPrice,
    targetHighPrice: numAt(fin, ["targetHighPrice"]),
    targetLowPrice: numAt(fin, ["targetLowPrice"]),
    currentPrice,
    targetUpsidePct: pctChange(targetMeanPrice, currentPrice),
    revisionTrend,
  };
}

/* ---------- fetch (query1 -> query2, HostBackoff on 429) ---------- */

export function quoteSummaryUrls(sym, crumb) {
  const enc = encodeURIComponent(sym);
  const pathStr = `/v10/finance/quoteSummary/${enc}?modules=${MODULES}`;
  return [
    `https://query1.finance.yahoo.com${pathStr}`,
    `https://query2.finance.yahoo.com${pathStr}`,
  ].map((url) => (crumb ? appendCrumb(url, crumb) : url));
}

export async function fetchQuoteSummary(backoff, sym, { timeoutMs = 12_000 } = {}) {
  const { crumb, cookieJar } = await getCrumb();
  let lastErr;
  for (const url of quoteSummaryUrls(sym, crumb)) {
    try {
      return await backoff.getJson(url, { timeoutMs, cookieJar });
    } catch (err) {
      lastErr = err;
      if (!isRateLimited(err)) continue; /* try the second host on any failure */
    }
  }
  throw lastErr;
}

/* ---------- upsert ---------- */

const UPSERT_SQL = `INSERT INTO analyst_data (symbol, payload_json, derived_json, fetched_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(symbol) DO UPDATE SET
    payload_json = excluded.payload_json,
    derived_json = excluded.derived_json,
    fetched_at = excluded.fetched_at`;

export async function ingestOne(
  db,
  sym,
  { force = false, fetchImpl = fetchQuoteSummary, backoff, cacheDir = CACHE_DIR, now = Date.now() } = {}
) {
  const row = db.prepare("SELECT fetched_at FROM analyst_data WHERE symbol = ?").get(sym);
  if (row && !force && now / 1000 - row.fetched_at < FRESH_SECONDS) {
    return { symbol: sym, status: "skipped" };
  }
  let payload;
  try {
    payload = await fetchImpl(backoff, sym);
  } catch (err) {
    return {
      symbol: sym,
      status: "failed",
      error: String(err?.message ?? err),
      rateLimited: err?.rateLimited ?? false,
      host: err?.host ?? null,
    };
  }
  if (!payload?.quoteSummary?.result?.[0]) {
    return { symbol: sym, status: "empty", error: "quoteSummary result missing" };
  }
  const derived = flattenDerived(payload);
  db.prepare(UPSERT_SQL).run(
    sym,
    JSON.stringify(payload),
    JSON.stringify(derived),
    Math.floor(now / 1000)
  );
  if (cacheDir) {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(path.join(cacheDir, `${sym}.json`), JSON.stringify(payload, null, 2));
  }
  return { symbol: sym, status: "fetched" };
}

/* ---------- orchestrator ---------- */

export async function runIngest(
  db,
  {
    universe = "nifty100",
    limit,
    force = false,
    delayMs = DEFAULT_DELAY_MS,
    fetchImpl,
    backoff = new HostBackoff(),
    cacheDir = CACHE_DIR,
    instruments = loadInstruments(),
    onLog = () => {},
  } = {}
) {
  let syms = buildUniverse(instruments, { universe });
  if (limit != null && Number.isFinite(limit) && limit > 0) syms = syms.slice(0, limit);
  const summary = { fetched: [], skipped: [], failed: [], empty: [] };
  let consecutiveFailures = 0;
  for (const sym of syms) {
    if (consecutiveFailures >= CIRCUIT_OPEN_AFTER) {
      summary.failed.push({
        symbol: sym,
        status: "failed",
        error: `circuit open: ${consecutiveFailures} consecutive failures (sustained 429?)`,
      });
      onLog(`  FAILED ${sym}: circuit open (${consecutiveFailures} consecutive failures)`);
      continue;
    }
    const res = await ingestOne(db, sym, { force, fetchImpl, backoff, cacheDir });
    summary[res.status].push(res);
    if (res.rateLimited) {
      onLog(`  FAILED ${sym}: ${res.error} (parking ${res.host ?? "host"} for backoff window)`);
      if (backoff && res.host) await backoff.waitIfNeeded(res.host);
      continue; /* throttled — park the host, do not trip the circuit breaker */
    }
    consecutiveFailures = res.status === "fetched" || res.status === "skipped" ? 0 : consecutiveFailures + 1;
    if (res.status === "failed" || res.status === "empty") {
      onLog(`  ${res.status.toUpperCase()} ${sym}: ${res.error}`);
    } else {
      onLog(`  ${res.status.toUpperCase()} ${sym}`);
    }
    if (delayMs > 0 && res.status === "fetched") {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return summary;
}

/* ---------- CLI ---------- */

function parseArgs(argv) {
  const out = { universe: "nifty100" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--universe") out.universe = argv[++i];
    else if (arg === "--limit") out.limit = Number(argv[++i]);
    else if (arg === "--force") out.force = true;
    else {
      console.error(`ingest-analyst: unknown flag: ${arg}`);
      process.exit(2);
    }
  }
  return out;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const db = openDb();
  const backoff = new HostBackoff({ maxRetries: 2 }); /* 3 attempts/host; circuit breaker covers sustained 429 */
  const summary = await runIngest(db, { ...opts, backoff, onLog: console.log });
  const total =
    summary.fetched.length + summary.skipped.length + summary.failed.length + summary.empty.length;
  const head = summary.fetched
    .slice(0, 5)
    .map((r) => r.symbol)
    .join(", ");
  console.log(
    `analyst ingest done: fetched ${summary.fetched.length} | skipped ${summary.skipped.length} | failed ${summary.failed.length} | empty ${summary.empty.length} | total ${total}`
  );
  if (summary.fetched.length) console.log(`  populated head: ${head}`);
  process.exit(0); /* partial success still exits 0 */
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`ingest-analyst: fatal: ${err?.message ?? err}`);
    process.exit(1);
  });
}
