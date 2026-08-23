import { registerHooks } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

registerHooks({
  resolve(specifier, context, nextResolve) {
    const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
    const hasExtension = /\.[a-z0-9]+$/i.test(specifier);
    if (isRelative && !hasExtension) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { openDb, REPO_ROOT } = await import("../lib/db.mjs");
const { s105Strategy } = await import(
  "../../web/src/lib/strategies/strategies/s105-analyst-revision.ts"
);

// Real-data suite: needs the local ingest DB with analyst coverage
// (gitignored). Skips on fresh checkouts / CI — and locally when the
// analyst ingest has not been run yet (table empty).
const DB_PATH = path.join(REPO_ROOT, "db", "data", "app.db");
function analystCoverageCount() {
  try {
    if (!existsSync(DB_PATH) || statSync(DB_PATH).size <= 64_000) return 0;
    const db = openDb(DB_PATH);
    const n = db.prepare("SELECT COUNT(*) AS n FROM analyst_data").get().n;
    db.close();
    return n;
  } catch {
    return 0;
  }
}
const COVERAGE = analystCoverageCount();

test("S105 real-data run over analyst coverage", { skip: COVERAGE < 10 && `requires local analyst ingest (found ${COVERAGE} rows)` }, async () => {
  const db = openDb();
  const rows = db
    .prepare("SELECT symbol, derived_json FROM analyst_data")
    .all();
  assert.ok(rows.length >= 10, `expected analyst coverage, got ${rows.length}`);

  const symbols = rows.map((r) => r.symbol);
  const ctx = {
    getUniverse: () => symbols,
    getAnalyst: async (symbol) => {
      const hit = rows.find((r) => r.symbol === symbol);
      if (!hit) return null;
      try {
        return JSON.parse(hit.derived_json);
      } catch {
        return null;
      }
    },
  };

  const signals = [];
  for (const symbol of symbols) {
    const sig = await s105Strategy.compute(ctx, symbol);
    if (sig) signals.push(sig);
  }

  // Coverage honesty: most rows have a revisionTrend, so a healthy share
  // must produce scores; but nulls are legal and never crash.
  assert.ok(signals.length >= Math.floor(rows.length * 0.5),
    `expected majority coverage, got ${signals.length}/${rows.length}`);

  const scores = signals.map((s) => s.score);
  assert.ok(scores.every((s) => s >= 0 && s <= 100), "scores within 0-100");
  const distinct = new Set(scores.map((s) => Math.round(s)));
  assert.ok(distinct.size > 1, "cross-sectional spread exists (not all identical)");

  const top = [...signals].sort((a, b) => b.score - a.score)[0];
  console.log(`[S105] real-data run: universe=${symbols.length} scored=${signals.length}`);
  console.log(`[S105] top: ${top.symbol} score=${top.score} rev30=${top.components.rev30d} rev90=${top.components.rev90d}`);
});
