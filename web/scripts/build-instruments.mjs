#!/usr/bin/env node
/* Builds a compact instrument master from Upstox's public CDN files.
   Output: web/src/data/instruments.json — [{ s: symbol, n: name, e: exchange }]
   Run: node scripts/build-instruments.mjs */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = "/tmp/opencode";

function fetchMaster(name) {
  const out = `${tmp}/${name}.json.gz`;
  execFileSync("curl", [
    "-sS", "-m", "90", "-o", out, "-w", "",
    `https://assets.upstox.com/market-quote/instruments/exchange/${name}.json.gz`,
    "-H", "User-Agent: Mozilla/5.0",
  ], { stdio: "inherit" });
  return JSON.parse(gunzipSync(readFileSync(out)));
}

const out = [];
const seen = new Set();

const TYPES = {
  complete: new Set(["EQ", "INDEX"]),
  BSE: new Set(["A", "B", "T", "M", "E", "INDEX"]),
};

for (const [file, tag] of [["complete", "NSE"], ["BSE", "BSE"]]) {
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

out.sort((a, b) => a.s.localeCompare(b.s));
mkdirSync(`${root}/src/data`, { recursive: true });
writeFileSync(`${root}/src/data/instruments.json`, JSON.stringify(out));
console.log(`Total: ${out.length} instruments`);
