#!/usr/bin/env node
/**
 * fill-universe.mjs — TASK-57 AC1 orchestrator.
 *
 * Expands eod_candles toward the full index universe by invoking the
 * TASK-30 single-symbol NSE path for symbols that have NO candles yet,
 * bounded per invocation so a cron step always finishes:
 *
 *   node scripts/fill-universe.mjs [--universe nifty50|nifty500] [--max 20] [--budget-min 50]
 *
 * One path per symbol, permanently: symbols filled here are RAW-basis +
 * adj_factor-rebuilt (NSE data); the nightly Yahoo batch only covers its own
 * universe labels, so bases never mix mid-series. Convergence: each run fills
 * up to --max missing symbols; schedule daily and the universe fills over
 * ~ceil(missing/max) nights.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { openDb, REPO_ROOT } from "./lib/db.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const INSTRUMENTS_PATH = path.join(REPO_ROOT, "web", "src", "data", "instruments.json");

const argv = process.argv.slice(2);
const opt = (flag, dflt) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : dflt;
};
const universe = opt("--universe", "nifty500");
const max = Math.max(1, Number(opt("--max", "20")) || 20);
const budgetMin = Math.max(5, Number(opt("--budget-min", "50")) || 50);
const label = universe === "nifty50" ? "NIFTY 50" : "NIFTY 500";

const instruments = JSON.parse(readFileSync(INSTRUMENTS_PATH, "utf8"));
const members = [
  ...new Set(
    instruments
      .filter((r) => Array.isArray(r.idx) && r.idx.includes(label) && (r.e === "NSE" || r.e === "BSE"))
      .map((r) => r.s)
  ),
];

const db = openDb();
const have = new Set(db.prepare("SELECT DISTINCT symbol FROM eod_candles").all().map((r) => r.symbol));
db.close();

const key = (s) => (have.has(s) ? s : have.has(`${s}.NS`) ? `${s}.NS` : have.has(`${s}.BO`) ? `${s}.BO` : null);
const missing = members.filter((s) => !key(s)).sort();
console.log(`[fill] universe=${universe} members=${members.length} have=${members.length - missing.length} missing=${missing.length} (this run: ≤${max})`);

if (missing.length === 0) {
  console.log("[fill] nothing to do");
  process.exit(0);
}

const deadline = Date.now() + budgetMin * 60_000;
let ok = 0, failed = 0;
const done = [];
for (const sym of missing.slice(0, max)) {
  if (Date.now() > deadline) {
    console.log(`[fill] budget exhausted (${budgetMin}m) — resuming next run`);
    break;
  }
  console.log(`[fill] -> ${sym}`);
  const r = spawnSync(
    process.execPath,
    ["--experimental-strip-types", path.join(here, "ingest-eod.mjs"), "--symbol", sym],
    {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      cwd: path.join(here, ".."),
      timeout: 10 * 60_000,
      // NSE sweeper prints a progress line per 70-row window; deep history
      // blows past spawnSync's 1MB default and kills the child mid-fill
      maxBuffer: 32 * 1024 * 1024,
    }
  );
  if (r.status === 0) ok++;
  else {
    failed++;
    console.log(`[fill] fail ${sym}: ${(r.stderr ?? "").split("\n").slice(0, 6).join(" | ").slice(0, 800)}`);
  }
  done.push(sym);
}
console.log(`[fill] summary: ok=${ok} failed=${failed} remaining≈${missing.length - done.length}`);
