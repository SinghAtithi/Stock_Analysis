#!/usr/bin/env node
/* ingest-smart-money.mjs — TASK-1415: smart-money radar feed.
 *
 * Sources (NSE official publication endpoints, keyless — see
 * docs/data-sources.md §11 for ToS/rate-limit posture):
 *   1. Bulk deals   GET /api/historicalOR/bulk-block-short-deals?optionType=bulk_deals&from=&to=
 *   2. Block deals  same endpoint, optionType=block_deals
 *   3. Insider (SAST) + promoter pledge changes: the rolling corporate
 *      announcements feed GET /api/corporate-announcements?index=equities,
 *      filtered by keyword (SAST/insider/pledge). SAST filings and pledge
 *      intimations are published to that feed on the day they are filed.
 *
 * Normalization: rows are flattened to smart_money_feed with a stable natural
 * key (kind|trade_date|symbol|client|side|qty|price) so re-ingests upsert
 * idempotently. value = qty * trade price. Per-source health lands in
 * smart_money_status so the UI can show an honest "source blocked/offline"
 * empty state (AC5) instead of a bare empty list.
 *
 * Resilience: HostBackoff on 429 (parks www.nseindia.com, does NOT trip the
 * breaker), circuit breaker after 3 consecutive non-throttle failures skips
 * remaining sources fast. Partial failure exits 0 with a summary (house
 * rule). Raw payloads cached to data/raw/smart-money/<source>_<YYYY-MM-DD>.json;
 * a fetch failure falls back to the cached payload (degraded, counted).
 *
 * Usage:
 *   node scripts/ingest-smart-money.mjs [--days N] [--limit N] [--force] [--no-announcements]
 *   --days N  lookback window in calendar days (default 5; deals exist only
 *             on trading days, so a weekend run still sees Friday's deals)
 *   --limit N cap total rows persisted (test runs)
 *   --force   re-fetch even when fresh rows for the window already exist
 *   --no-announcements  skip the SAST/pledge announcement pass
 */

import path from "node:path";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openDb, REPO_ROOT } from "./lib/db.mjs";
import { HostBackoff, isRateLimited } from "./lib/curl.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(REPO_ROOT, "data", "raw", "smart-money");

const BULK_URL = (from, to) =>
  `https://www.nseindia.com/api/historicalOR/bulk-block-short-deals` +
  `?optionType=bulk_deals&from=${from}&to=${to}`;
const BLOCK_URL = (from, to) =>
  `https://www.nseindia.com/api/historicalOR/bulk-block-short-deals` +
  `?optionType=block_deals&from=${from}&to=${to}`;
const ANNOUNCEMENTS_URL = "https://www.nseindia.com/api/corporate-announcements?index=equities";

export const DEFAULT_DAYS = 5;
export const CIRCUIT_OPEN_AFTER = 3; /* consecutive non-throttle failures => skip remaining sources */
export const DEFAULT_DELAY_MS = 800; /* inter-source courtesy delay */

/* SAST filings + pledge intimations reach the announcements feed with these
 * tokens in desc/attchmntText. Keyword match is deliberately conservative —
 * a miss just means the item is not surfaced (it stays in the feed itself).
 * "Trading Window" closure notices quote the SEBI (Prohibition of Insider
 * Trading) Regulations without reporting any insider activity — they are
 * excluded from the insider lane. */
const INSIDER_RE = /\bsast\b|insider (?:trad|transaction|acquisition|sell|buy|disclosure|report)|disclosure (?:of|under).{0,40}insider|acquisition of shares|disposal of shares/i;
const PLEDGE_RE = /\bpledge[sd]?\b|pledging/i;

/* ---------- date helpers ---------- */

function isoDateOfNse(ddMmmYyyy) {
  const m = /^(\d{1,2})-([A-Z]{3})-(\d{4})$/.exec(String(ddMmmYyyy ?? "").trim());
  if (!m) return null;
  const MONTHS = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };
  const mm = MONTHS[m[2].toUpperCase()];
  if (!mm) return null;
  return `${m[3]}-${mm}-${m[1].padStart(2, "0")}`;
}

function isoDateOfAnnouncement(a) {
  const s = String(a?.sort_date ?? a?.an_dt ?? "");
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return isoDateOfNse(s.split(" ")[0]);
}

function isoLookback(days, now = new Date()) {
  const d = new Date(now);
  d.setDate(d.getDate() - (days - 1));
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}

/* ISO (YYYY-MM-DD) lookback — used for SQL date comparisons, where the
 * DD-MM-YYYY URL format would compare wrong lexically. */
function isoDateLookback(days, now = new Date()) {
  const d = new Date(now);
  d.setDate(d.getDate() - (days - 1));
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* ---------- normalization (bulk/block deal rows) ---------- */

export function dealRowToItem(row, kind) {
  const qty = Number(row?.BD_QTY_TRD);
  const price = Number(row?.BD_TP_WATP);
  if (!Number.isFinite(qty) || qty <= 0) return null;
  const symbol = String(row?.BD_SYMBOL ?? "").trim().toUpperCase();
  if (!symbol) return null;
  const date = isoDateOfNse(row?.BD_DT_DATE);
  if (!date) return null;
  const side = String(row?.BD_BUY_SELL ?? "").trim().toUpperCase();
  return {
    kind,
    symbol,
    securityName: String(row?.BD_SCRIP_NAME ?? "").trim() || null,
    client: String(row?.BD_CLIENT_NAME ?? "").trim() || null,
    buySell: side === "BUY" || side === "SELL" ? side : null,
    qty,
    price: Number.isFinite(price) && price > 0 ? price : null,
    value: Number.isFinite(price) && price > 0 ? qty * price : null,
    tradeDate: date,
    source: kind === "block_deal" ? "nse-block" : "nse-bulk",
    remarks: String(row?.BD_REMARKS ?? "").trim() && row?.BD_REMARKS !== "-" ? String(row.BD_REMARKS).trim() : null,
  };
}

/* ---------- normalization (announcements -> insider / pledge) ---------- */

export function classifyAnnouncement(a) {
  const hay = `${a?.desc ?? ""} ${a?.attchmntText ?? ""} ${a?.sm_name ?? ""}`;
  if (PLEDGE_RE.test(hay)) return "pledge";
  /* Trading-window closure notices quote the SEBI (Prohibition of Insider
   * Trading) Regulations without reporting any insider activity — exclude
   * them from the insider lane entirely. */
  if (/trading window/i.test(hay)) return null;
  if (INSIDER_RE.test(hay)) return "insider";
  return null;
}

export function announcementToItem(a) {
  const kind = classifyAnnouncement(a);
  if (!kind) return null;
  const symbol = String(a?.symbol ?? "").trim().toUpperCase();
  if (!symbol) return null;
  const date = isoDateOfAnnouncement(a);
  if (!date) return null;
  return {
    kind,
    symbol,
    securityName: String(a?.sm_name ?? "").trim() || null,
    client: null,
    buySell: null,
    qty: null,
    price: null,
    value: null,
    tradeDate: date,
    source: "nse-announcements",
    seqId: String(a?.seq_id ?? "").trim() || null,
    desc: String(a?.desc ?? "").trim() || null,
  };
}

/* Stable natural key — re-ingest of the same event upserts, never duplicates. */
export function itemId(item) {
  const side = item.buySell ?? "na";
  const client = item.client ?? item.seqId ?? "na";
  return [item.kind, item.tradeDate, item.symbol, client, side, item.qty ?? "na", item.price ?? "na"]
    .map((s) => String(s).replace(/\s+/g, "_"))
    .join("|");
}

/* ---------- fetch layer ---------- */

export async function fetchJson(backoff, url, { timeoutMs = 20_000, curlImpl } = {}) {
  return backoff.getJson(url, { timeoutMs, maxRetries: 2, curlImpl });
}

/* Fetch one source; cache the raw payload per day; on failure fall back to
 * the cached payload (degraded). Returns { items, source, ok, degraded,
 * blocked, error, raw }. blocked = hard upstream refusal (403/404/5xx),
 * distinct from empty (weekend / no filings — healthy). */
export async function fetchSource({
  key,
  source = key,
  url,
  parse,
  backoff,
  cacheDir = CACHE_DIR,
  day,
  fetchImpl,
  now = Date.now(),
}) {
  const cachePath = path.join(cacheDir, `${key}_${day}.json`);
  let raw = null;
  let degraded = false;
  let blocked = false;
  let error = null;
  try {
    raw = await (fetchImpl ? fetchImpl(url) : fetchJson(backoff, url));
  } catch (err) {
    error = String(err?.message ?? err);
    blocked = !isRateLimited(err) && !err?.rateLimited;
    if (existsSync(cachePath)) {
      degraded = true;
      try {
        raw = JSON.parse(readFileSync(cachePath, "utf8"));
      } catch {
        raw = null;
      }
    }
  }
  if (raw != null) {
    try {
      mkdirSync(cacheDir, { recursive: true });
      writeFileSync(cachePath, JSON.stringify(raw, null, 2));
    } catch {
      /* cache is best-effort */
    }
  }
  const items = raw == null ? [] : parse(raw);
  return { key, source, items, ok: raw != null, degraded, blocked, error, raw, now };
}

/* ---------- upsert ---------- */

const UPSERT_SQL = `INSERT INTO smart_money_feed
  (id, kind, symbol, security_name, client, buy_sell, qty, price, value,
   trade_date, source, raw_json, ingested_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    qty = excluded.qty,
    price = excluded.price,
    value = excluded.value,
    raw_json = excluded.raw_json,
    ingested_at = excluded.ingested_at`;

export function ingestItems(db, items, { now = Date.now() } = {}) {
  const stmt = db.prepare(UPSERT_SQL);
  const run = () => {
    for (const it of items) {
      stmt.run(
        itemId(it),
        it.kind,
        it.symbol,
        it.securityName,
        it.client,
        it.buySell,
        it.qty,
        it.price,
        it.value,
        it.tradeDate,
        it.source,
        JSON.stringify(it),
        Math.floor(now / 1000)
      );
    }
  };
  (typeof db.transaction === "function" ? db.transaction(run) : run)();
  return items.length;
}

const STATUS_SQL = `INSERT INTO smart_money_status (source, ok, error, fetched_at, detail_json)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(source) DO UPDATE SET
    ok = excluded.ok,
    error = excluded.error,
    fetched_at = excluded.fetched_at,
    detail_json = excluded.detail_json`;

export function recordStatus(db, { source, ok, error = null, blocked = false, rows = 0, now = Date.now() } = {}) {
  db.prepare(STATUS_SQL).run(
    source,
    ok ? 1 : 0,
    error ? String(error).slice(0, 500) : null,
    Math.floor(now / 1000),
    JSON.stringify({ blocked, rows })
  );
}

/* ---------- orchestrator ---------- */

export async function runIngest(db, {
  days = DEFAULT_DAYS,
  limit,
  force = false,
  includeAnnouncements = true,
  backoff = new HostBackoff({ maxRetries: 2 }),
  cacheDir = CACHE_DIR,
  fetchImpl, /* injectable for tests: (url) => payload */
  onLog = () => {},
  now = new Date(),
} = {}) {
  const dayKey = now.toISOString().slice(0, 10);
  const from = isoLookback(days, now);
  const to = isoLookback(1, now);

  /* freshness: if non-empty rows already exist in the window, skip unless --force */
  if (!force) {
    const row = db
      .prepare("SELECT COUNT(*) AS n FROM smart_money_feed WHERE trade_date >= ?")
      .get(isoDateLookback(days, now));
    if (Number(row.n) > 0) {
      onLog(`  fresh rows present in the ${days}-day window — use --force to re-ingest`);
      return { fetched: 0, skipped: 0, degraded: [], failed: [], blocked: [], summaries: [] };
    }
  }

  const sources = [
    { key: "bulk", source: "nse-bulk", url: BULK_URL(from, to), parse: (raw) => (raw?.data ?? []).map((r) => dealRowToItem(r, "bulk_deal")).filter(Boolean) },
    { key: "block", source: "nse-block", url: BLOCK_URL(from, to), parse: (raw) => (raw?.data ?? []).map((r) => dealRowToItem(r, "block_deal")).filter(Boolean) },
  ];
  if (includeAnnouncements) {
    sources.push({
      key: "announcements",
      source: "nse-announcements",
      url: ANNOUNCEMENTS_URL,
      parse: (raw) => (Array.isArray(raw) ? raw : []).map(announcementToItem).filter(Boolean),
    });
  }

  const summary = { fetched: 0, skipped: 0, degraded: [], failed: [], blocked: [], summaries: [] };
  let consecutiveFailures = 0;

  for (const src of sources) {
    if (consecutiveFailures >= CIRCUIT_OPEN_AFTER) {
      summary.failed.push({ source: src.key, error: "circuit open: 3 consecutive failures" });
      onLog(`  SKIP ${src.key}: circuit open`);
      continue;
    }
    const res = await fetchSource({ ...src, backoff, cacheDir, day: dayKey, fetchImpl });
    if (!res.ok) {
      summary.failed.push({ source: src.key, error: res.error });
      summary.summaries.push({ source: src.key, status: res.degraded ? "degraded" : "failed", rows: 0 });
      recordStatus(db, { source: res.source, ok: false, error: res.error, blocked: res.blocked });
      if (res.blocked) summary.blocked.push(src.key);
      if (res.degraded) summary.degraded.push(src.key);
      consecutiveFailures += 1;
      onLog(`  FAILED ${src.key}: ${res.error}${res.degraded ? " (degraded — served from cache)" : ""}`);
      continue;
    }
    consecutiveFailures = 0;
    let items = res.items;
    if (limit != null && Number.isFinite(limit) && limit > 0) items = items.slice(0, limit);
    const n = ingestItems(db, items, { now: Date.now() });
    summary.fetched += n;
    summary.summaries.push({ source: src.key, status: "ok", rows: n });
    recordStatus(db, { source: res.source, ok: true, rows: n });
    onLog(`  OK ${src.key}: ${n} rows`);
    if (n === 0) {
      /* healthy empty (weekend / no filings) — brief pause, not a failure */
      await new Promise((resolve) => setTimeout(resolve, DEFAULT_DELAY_MS));
    }
  }
  return summary;
}

/* ---------- CLI ---------- */

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--days") out.days = Number(argv[++i]);
    else if (arg === "--limit") out.limit = Number(argv[++i]);
    else if (arg === "--force") out.force = true;
    else if (arg === "--no-announcements") out.includeAnnouncements = false;
    else {
      console.error(`ingest-smart-money: unknown flag: ${arg}`);
      process.exit(2);
    }
  }
  return out;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const db = openDb();
  try {
    const backoff = new HostBackoff({ maxRetries: 2 });
    const summary = await runIngest(db, { ...opts, backoff, onLog: console.log });
    const bad = summary.failed.length + summary.blocked.length;
    console.log(
      `smart-money ingest done: fetched ${summary.fetched} | degraded ${summary.degraded.length} | ` +
        `blocked ${summary.blocked.length} | failed ${summary.failed.length}`
    );
    for (const s of summary.summaries) console.log(`  ${s.source}: ${s.status} (${s.rows} rows)`);
    process.exit(bad > 0 && summary.fetched === 0 ? 1 : 0); /* partial success exits 0 */
  } finally {
    db.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`ingest-smart-money: fatal: ${err?.message ?? err}`);
    process.exit(1);
  });
}