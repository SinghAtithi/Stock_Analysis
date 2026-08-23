#!/usr/bin/env node
/**
 * repair-symbol-basis.mjs — TASK-36 companion tool (ADR-0002).
 *
 * Re-ingests ONE symbol's full history through the reconciled write path,
 * replacing legacy stitched segments with a single-vendor continuous basis.
 *
 *   node scripts/repair-symbol-basis.mjs RELIANCE NSE [--years 30] [--apply]
 *
 * Default is a DRY-RUN: fetches fresh history, prints a continuity report
 * (>40% single-day closes), writes nothing. --apply swaps the stored series
 * inside one transaction after the fetch succeeds. Registered cliff-debt
 * entries for this symbol can then be removed from
 * scripts/tests/fixtures/cliff-debt-registry.json once the sweep is green.
 */
import { parseArgs } from "node:util";
import { openDb, DEFAULT_DB_PATH } from "./lib/db.mjs";
import {
  storeCandlesReconciled,
  mergeCorporateActions,
  loadInstruments,
  resolveUniverse,
  fetchEodForSymbol,
} from "./ingest-eod.mjs";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    years: { type: "string", default: "30" },
    apply: { type: "boolean", default: false },
    db: { type: "string", default: DEFAULT_DB_PATH },
  },
});
const years = Number(values.years);
if (!Number.isFinite(years) || years < 1 || years > 40) {
  console.error(`--years must be 1..40, got "${values.years}"`);
  process.exit(2);
}

const [symbolArg, exchangeArg = "NSE"] = positionals;
if (!symbolArg) {
  console.error("usage: repair-symbol-basis.mjs SYMBOL [NSE|BSE] [--years 30] [--apply]");
  process.exit(2);
}

const db = openDb(values.db);
const instruments = loadInstruments();
const universeRows = resolveUniverse(instruments, "all");
const item =
  universeRows.find((x) => x.symbol === symbolArg && x.exchange === exchangeArg) ??
  { symbol: symbolArg, exchange: exchangeArg, name: symbolArg };

console.log(`fetching ${item.symbol}.${exchangeArg === "BSE" ? "BO" : "NS"} (${years}y)...`);
const got = await fetchEodForSymbol(item, { years });
if (!got) {
  console.error("all sources failed — nothing changed");
  process.exit(1);
}
console.log(`source=${got.source} candles=${got.candles.length} events=${got.actions.length}`);

/* continuity report on the incoming series */
const cliffs = [];
for (let i = 1; i < got.candles.length; i++) {
  const prev = got.candles[i - 1].c;
  if (prev > 0 && Math.abs(got.candles[i].c / prev - 1) > 0.4) {
    cliffs.push(`${new Date(got.candles[i].ts * 1000).toISOString().slice(0, 10)} ${((got.candles[i].c / prev - 1) * 100).toFixed(0)}%`);
  }
}
console.log(cliffs.length ? `cliffs (>40%): ${cliffs.join(", ")}` : "cliffs (>40%): none");

if (!values.apply) {
  console.log("dry-run only — rerun with --apply to replace the stored series");
  db.close();
  process.exit(0);
}

const tx = db.transaction(() => {
  db.prepare("DELETE FROM eod_candles WHERE symbol = ?").run(got.symbol);
});
tx();
const written = storeCandlesReconciled(db, got.symbol, got.candles, console.log);
if (got.actions.length) mergeCorporateActions(db, got.actions.map((a) => ({ ...a, symbol: got.symbol })));
console.log(`applied: deleted old series, wrote ${written} candles, ${got.actions.length} events merged`);

/* post-swap continuity of what is actually stored */
const rows = db.prepare("SELECT ts, c FROM eod_candles WHERE symbol = ? ORDER BY ts").all(got.symbol);
let bad = 0;
for (let i = 1; i < rows.length; i++) {
  if (rows[i - 1].c > 0 && Math.abs(rows[i].c / rows[i - 1].c - 1) > 0.4) bad++;
}
console.log(`stored rows: ${rows.length}, residual cliffs: ${bad}`);
db.close();
