#!/usr/bin/env node
/* Builds a compact, enriched instrument master for the local search index.

   Sources (all verified from this machine, see docs/task-reports/TASK-07.md):
   1. Upstox CDN instrument masters (NSE + BSE) — base { s, n, e }.
   2. NSE archives index-constituent CSVs (no cookies needed) —
      NIFTY 50 / NEXT 50 / MIDCAP 150 / SMALLCAP 250 / 500 / BANK / FIN SERVICE
      membership + NSE industry taxonomy.
   3. TradingView India scanner (POST batch) — sector + industry per
      NSE:<SYM> / BSE:<SYM> ticker.

   Output: web/src/data/instruments.json — [{ s, n, e, sec?, ind?, idx? }]
   sec/ind/idx are optional => backward compatible with the v1 schema.

   Caches (gitignored via <repo-root>/.gitignore): <repo-root>/data/raw/
     upstox/*.json.gz, nse-indices/*.csv, tradingview/scan.json
   Re-run: node scripts/build-instruments.mjs          (reuse caches)
           node scripts/build-instruments.mjs --refresh (refetch everything)
   Failures per source are tolerated: a dead source degrades coverage, it
   does not crash the build. */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(webRoot, "..");
const RAW = path.join(repoRoot, "data", "raw");
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const REFRESH = process.argv.includes("--refresh");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- HTTP helpers (curl via execFile, no shell) ---------- */

function curlTo(url, out, extra = []) {
  execFileSync(
    "curl",
    ["-sS", "-m", "90", "--compressed", "-o", out, "-H", `User-Agent: ${UA}`, ...extra, url],
    { stdio: "inherit" }
  );
}

function curlStdout(url, extra = []) {
  return execFileSync(
    "curl",
    ["-sS", "-m", "60", "--compressed", "-H", `User-Agent: ${UA}`, "-H", "Accept: application/json", ...extra, url],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  );
}

/* ---------- 1. Upstox masters (base list) ---------- */

function fetchMaster(name) {
  const dir = path.join(RAW, "upstox");
  mkdirSync(dir, { recursive: true });
  const gz = path.join(dir, `${name}.json.gz`);
  if (!REFRESH && existsSync(gz)) {
    console.log(`upstox ${name}: cache hit`);
    return JSON.parse(gunzipSync(readFileSync(gz)));
  }
  console.log(`upstox ${name}: downloading…`);
  curlTo(`https://assets.upstox.com/market-quote/instruments/exchange/${name}.json.gz`, gz);
  return JSON.parse(gunzipSync(readFileSync(gz)));
}

/* ---------- 2. NSE archives index-constituent CSVs ---------- */

const INDEX_LISTS = [
  ["ind_nifty50list", "NIFTY 50"],
  ["ind_niftynext50list", "NIFTY NEXT 50"],
  ["ind_niftymidcap150list", "NIFTY MIDCAP 150"],
  ["ind_niftysmallcap250list", "NIFTY SMALLCAP 250"],
  ["ind_nifty500list", "NIFTY 500"],
  ["ind_niftybanklist", "NIFTY BANK"],
  ["ind_niftyfinancelist", "NIFTY FIN SERVICE"],
];

/* Lines: "Company Name,Industry,Symbol,Series,ISIN Code" */
function parseIndexCsv(text) {
  const rows = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("Company Name")) continue;
    const parts = line.split(",");
    if (parts.length < 5) continue;
    const series = parts[parts.length - 2];
    if (series !== "EQ") continue;
    const symbol = parts[parts.length - 3].trim();
    const industry = parts.slice(1, parts.length - 3).join(",").trim();
    if (!symbol || !industry) continue;
    rows.push({ symbol, industry });
  }
  return rows;
}

function fetchIndexList(file) {
  const dir = path.join(RAW, "nse-indices");
  mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `${file}.csv`);
  if (!REFRESH && existsSync(out)) {
    console.log(`nse ${file}: cache hit`);
    return parseIndexCsv(readFileSync(out, "utf8"));
  }
  console.log(`nse ${file}: downloading…`);
  for (const host of ["archives.nseindia.com", "nsearchives.nseindia.com"]) {
    try {
      curlTo(`https://${host}/content/indices/${file}.csv`, out, ["-H", "Referer: https://www.nseindia.com/"]);
      const rows = parseIndexCsv(readFileSync(out, "utf8"));
      if (rows.length) return rows;
    } catch (e) {
      console.warn(`nse ${file} via ${host}: ${String(e.message).split("\n")[0]}`);
    }
  }
  console.warn(`nse ${file}: all hosts failed — skipping list`);
  return [];
}

/* ---------- 3. TradingView scanner (sector + industry) ---------- */

const TV_DIR = path.join(RAW, "tradingview");
const TV_FILE = path.join(TV_DIR, "scan.json");
const TV_BATCH = 100;
const TV_PAUSE_MS = 300;

/* Curated sector/industry overrides for tickers TradingView dropped from its
   India scanner. Values follow the TradingView taxonomy (verified against
   peers on the same exchange) so merged data stays consistent.
   - BAJAJ-AUTO: NIFTY 50 auto major; TV peers (MARUTI) => Consumer Durables / Motor Vehicles
   - NAM-INDIA: Nippon Life AMC; TV peers (HDFCAMC, UTIAMC) => Finance / Investment Managers */
const TV_OVERRIDES = {
  "NSE:BAJAJ-AUTO": ["Consumer Durables", "Motor Vehicles"],
  "NSE:NAM-INDIA": ["Finance", "Investment Managers"],
};

function loadTvCache() {
  if (REFRESH) return { tickers: {}, missed: [] };
  try {
    const c = JSON.parse(readFileSync(TV_FILE, "utf8"));
    return { tickers: c.tickers ?? {}, missed: c.missed ?? [] };
  } catch {
    return { tickers: {}, missed: [] };
  }
}

function saveTvCache(cache) {
  mkdirSync(TV_DIR, { recursive: true });
  writeFileSync(TV_FILE, JSON.stringify(cache));
}

async function tvScanBatches(batches) {
  const cache = loadTvCache();
  const known = new Set([...Object.keys(cache.tickers), ...cache.missed]);
  let scanned = 0;
  for (const batch of batches) {
    const todo = batch.filter((t) => !known.has(t));
    if (!todo.length) continue;
    const body = JSON.stringify({
      symbols: { tickers: todo },
      columns: ["sector", "industry"],
    });
    let ok = false;
    for (let attempt = 1; attempt <= 5 && !ok; attempt++) {
      try {
        const raw = curlStdout("https://scanner.tradingview.com/india/scan", [
          "-H",
          "Content-Type: application/json",
          "--data-binary",
          body,
        ]);
        const data = JSON.parse(raw);
        const rows = Array.isArray(data?.data) ? data.data : [];
        const found = new Set();
        for (const row of rows) {
          const t = typeof row?.s === "string" ? row.s : null;
          if (!t) continue;
          const d = Array.isArray(row.d) ? row.d : [];
          const sec = typeof d[0] === "string" && d[0] ? d[0] : null;
          const ind = typeof d[1] === "string" && d[1] ? d[1] : null;
          found.add(t);
          if (sec || ind) cache.tickers[t] = [sec, ind];
          else cache.missed.push(t);
        }
        for (const t of todo) if (!found.has(t)) cache.missed.push(t);
        ok = true;
      } catch (e) {
        const msg = String(e.message);
        const retryable = /429|56|timeout|Failed to connect/i.test(msg);
        if (!retryable) {
          console.warn(`tv scan batch failed, skipping: ${msg.split("\n")[0]}`);
          break;
        }
        console.warn(`tv scan 429/network (attempt ${attempt}/5), backing off…`);
        await sleep(5000 * attempt);
      }
    }
    scanned += todo.length;
    saveTvCache(cache);
    if (scanned % 500 < todo.length) console.log(`tv scan: ${scanned} tickers requested…`);
    await sleep(TV_PAUSE_MS);
  }
  return cache;
}

/* ---------- merge ---------- */

function buildBase() {
  const out = [];
  const seen = new Set();
  const TYPES = {
    complete: new Set(["EQ", "INDEX"]),
    BSE: new Set(["A", "B", "T", "M", "E", "INDEX"]),
  };
  for (const [file, tag] of [
    ["complete", "NSE"],
    ["BSE", "BSE"],
  ]) {
    const data = fetchMaster(file);
    let count = 0;
    for (const r of data) {
      if (!TYPES[file].has(r.instrument_type)) continue;
      const symbol = String(r.tradingsymbol ?? r.trading_symbol ?? "").trim();
      if (!symbol) continue;
      const key = symbol + "|" + tag;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ s: symbol, n: String(r.name ?? symbol).trim(), e: tag });
      count++;
    }
    console.log(`${file}: kept ${count} (${tag})`);
  }
  return out;
}

async function main() {
  const base = buildBase();

  /* index membership + NSE industry */
  const idxMap = new Map();
  const nseIndustry = new Map();
  for (const [file, index] of INDEX_LISTS) {
    for (const { symbol, industry } of fetchIndexList(file)) {
      if (!idxMap.has(symbol)) idxMap.set(symbol, []);
      if (!idxMap.get(symbol).includes(index)) idxMap.get(symbol).push(index);
      if (!nseIndustry.has(symbol)) nseIndustry.set(symbol, industry);
    }
  }
  console.log(
    `nse indices: ${idxMap.size} symbols with membership, ${nseIndustry.size} with industry`
  );

  /* tradingview scan — NIFTY 500 members first so core coverage wins on throttling */
  const nifty500 = new Set(
    [...idxMap.entries()].filter(([, idx]) => idx.includes("NIFTY 500")).map(([s]) => s)
  );
  const ordered = [
    ...base.filter((b) => b.e === "NSE" && nifty500.has(b.s)),
    ...base.filter((b) => b.e === "NSE" && !nifty500.has(b.s)),
    ...base.filter((b) => b.e === "BSE"),
  ];
  const batches = [];
  for (let i = 0; i < ordered.length; i += TV_BATCH) {
    batches.push(ordered.slice(i, i + TV_BATCH).map((b) => `${b.e}:${b.s}`));
  }
  console.log(`tv scan: ${batches.length} batches (${ordered.length} tickers)`);
  const tv = await tvScanBatches(batches);
  for (const [t, v] of Object.entries(TV_OVERRIDES)) {
    if (!tv.tickers[t]) {
      tv.tickers[t] = v;
      console.log(`tv scan: applied curated override ${t}`);
    }
  }
  let tvHits = 0;
  for (const v of Object.values(tv.tickers)) if (v[0] || v[1]) tvHits++;
  console.log(`tv scan: ${Object.keys(tv.tickers).length} cached, ${tvHits} with sector/industry`);

  /* merge */
  const merged = [];
  let secCount = 0;
  let indCount = 0;
  let idxCount = 0;
  for (const r of base) {
    const entry = { s: r.s, n: r.n, e: r.e };
    const tvKey = `${r.e}:${r.s}`;
    const own = tv.tickers[tvKey];
    let sec = own?.[0] ?? null;
    let ind = own?.[1] ?? null;
    if (r.e === "NSE" && !ind) ind = nseIndustry.get(r.s) ?? null;
    const mirror = tv.tickers[`${r.e === "NSE" ? "BSE" : "NSE"}:${r.s}`];
    if (mirror && (!sec || !ind)) {
      sec ??= mirror[0];
      ind ??= mirror[1];
    }
    if (sec) {
      entry.sec = sec;
      secCount++;
    }
    if (ind) {
      entry.ind = ind;
      indCount++;
    }
    const idx = idxMap.get(r.s);
    if (idx?.length) {
      entry.idx = idx;
      idxCount++;
    }
    merged.push(entry);
  }

  merged.sort((a, b) => a.s.localeCompare(b.s));
  const outFile = path.join(webRoot, "src", "data", "instruments.json");
  writeFileSync(outFile, JSON.stringify(merged));
  const kb = (readFileSync(outFile).length / 1024).toFixed(0);

  /* coverage report (unique symbols, either exchange) */
  const secBySym = new Map();
  for (const m of merged) if (!secBySym.get(m.s)) secBySym.set(m.s, Boolean(m.sec));
  const countWithSec = (syms) => syms.filter((s) => secBySym.get(s)).length;
  const n50Syms = [...idxMap.entries()]
    .filter(([, idx]) => idx.includes("NIFTY 50"))
    .map(([s]) => s);
  const n500Syms = [...idxMap.entries()]
    .filter(([, idx]) => idx.includes("NIFTY 500"))
    .map(([s]) => s);
  const n50Sec = countWithSec(n50Syms);
  const n500Sec = countWithSec(n500Syms);
  const pct = n500Syms.length ? ((n500Sec / n500Syms.length) * 100).toFixed(1) : "0.0";
  console.log(`\nTotal: ${merged.length} instruments (${kb} KB)`);
  console.log(`  sec: ${secCount}  ind: ${indCount}  idx: ${idxCount}`);
  console.log(`  NIFTY 50 sector coverage: ${n50Sec}/${n50Syms.length}`);
  console.log(`  NIFTY 500 sector coverage: ${n500Sec}/${n500Syms.length} (${pct}%)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
