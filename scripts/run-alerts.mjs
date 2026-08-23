/**
 * run-alerts.mjs — TASK-59: standalone alert evaluation for scheduled runs
 * (GitHub Actions pipelines.yml, after signals ingest). No server required.
 *
 * Membership alerts (strategy_enter/strategy_exit) diff the two latest
 * signal_snapshot runs per strategy — pure DB work, fully supported here.
 * Price-cross alerts need live quotes; they are evaluated by the runtime
 * route (/api/alerts/evaluate against the cached tape) and are SKIPPED in
 * CLI mode, reported as pending-price so nothing silently stalls.
 *
 * Delivery: logged digest (Resend-shaped adapter fires only when
 * RESEND_API_KEY is set).
 *
 * Usage: node --experimental-strip-types scripts/run-alerts.mjs
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerHooks } from "node:module";
import { openDb, REPO_ROOT } from "./lib/db.mjs";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[a-z0-9]+$/i.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { evaluatePass, membershipDiff, membershipEvents, isMembershipType } = await import(
  "../web/src/lib/alerts.ts"
);

const DB_PATH = process.env.NIFTY_DB_PATH ?? path.join(REPO_ROOT, "db", "data", "app.db");
const db = openDb(DB_PATH);

const rows = db.prepare(`SELECT id, device_id, type, payload_json FROM alerts WHERE active = 1 LIMIT 500`).all();
const now = Math.floor(Date.now() / 1000);
const fired = [];

/* ----- price alerts: pending-price in CLI mode (no live tape here) ----- */
const priceRows = rows.filter((r) => !isMembershipType(r.type));
if (priceRows.length > 0) {
  console.log(`price alerts pending-live-evaluation: ${priceRows.length} (runtime /api/alerts/evaluate handles these)`);
}

/* ----- membership alerts: diff last two snapshot runs per strategy ----- */
const memberRows = rows.filter((r) => isMembershipType(r.type));
const strategies = new Set(
  memberRows.flatMap((r) => {
    try {
      return [JSON.parse(r.payload_json).strategyId].filter(Boolean);
    } catch {
      return [];
    }
  })
);
const membership = new Map();
for (const strategyId of strategies) {
  const asOfs = db
    .prepare(`SELECT DISTINCT as_of FROM signal_snapshots WHERE strategy_id = ? ORDER BY as_of DESC LIMIT 2`)
    .all(strategyId);
  if (asOfs.length < 2) {
    console.log(`${strategyId}: fewer than 2 snapshot runs — no diff yet`);
    continue;
  }
  const top = (asOf) =>
    db
      .prepare(`SELECT symbol FROM signal_snapshots WHERE strategy_id = ? AND as_of = ? ORDER BY rank ASC LIMIT ?`)
      .all(strategyId, asOf.as_of, 50)
      .map((r) => r.symbol);
  membership.set(strategyId, membershipDiff(top(asOfs[1]), top(asOfs[0])));
}
fired.push(...membershipEvents(memberRows, membership, now));

for (const f of fired) {
  db.prepare(`UPDATE alerts SET active = 0, fired_at = ? WHERE id = ? AND active = 1`).run(f.firedAt, f.id);
}

/* ----- delivery digest ----- */
if (fired.length === 0) {
  console.log("alerts: nothing fired this pass");
} else {
  const lines = fired.map((f) => `- ${f.type} ${f.symbol ?? ""} ${f.detail ?? ""}`.trim());
  console.log(`[alerts digest] ${fired.length} fired:\n${lines.join("\n")}`);
  if (process.env.RESEND_API_KEY) {
    console.log(
      `[alerts digest] RESEND_API_KEY present — would POST https://api.resend.com/emails ` +
        `{from:"alerts@nifty.term", subject:"${fired.length} alert(s) fired"}`
    );
  }
}
db.close();
