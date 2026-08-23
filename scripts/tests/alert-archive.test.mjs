import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../scripts/lib/db.mjs";
import { applyMigrations } from "../../scripts/migrate.mjs";
import { alertDeletePlan } from "../../web/src/lib/alerts.ts";

/* ---------- alertDeletePlan (TASK-963) ---------- */

test("fired rows archive instead of hard-deleting", () => {
  assert.equal(alertDeletePlan({ active: 0, fired_at: 1787500000 }), "archive");
});

test("active and manually-deactivated rows keep hard delete", () => {
  assert.equal(alertDeletePlan({ active: 1, fired_at: null }), "hard");
  assert.equal(alertDeletePlan({ active: 1, fired_at: 1787500000 }), "hard");
  assert.equal(alertDeletePlan({ active: 0, fired_at: null }), "hard");
});

/* ---------- migration 0002 + archive round-trip ---------- */

test("0002 migration adds dismissed_at; archived row is retained and queryable", () => {
  const dir = mkdtempSync(join(tmpdir(), "nifty-alert-archive-"));
  const dbPath = join(dir, "app.db");
  try {
    const db = openDb(dbPath);
    try {
      applyMigrations(db);
      const cols = db.prepare(`PRAGMA table_info(alerts)`).all().map((c) => c.name);
      assert.ok(cols.includes("dismissed_at"), "dismissed_at column exists");

      db.prepare(
        `INSERT INTO alerts (id, device_id, type, payload_json, active, created_at, fired_at)
         VALUES ('run1', 'abcd1234-5678', 'price_above', '{"symbol":"RELIANCE","price":100}', 0, 1, 2)`
      ).run();

      // the route's archive branch
      const row = db
        .prepare(`SELECT active, fired_at FROM alerts WHERE id = ? AND device_id = ?`)
        .get("run1", "abcd1234-5678");
      assert.equal(alertDeletePlan(row), "archive");
      db.prepare(`UPDATE alerts SET dismissed_at = ? WHERE id = ? AND device_id = ?`).run(
        3,
        "run1",
        "abcd1234-5678"
      );

      const kept = db
        .prepare(
          `SELECT id, active, fired_at, dismissed_at FROM alerts WHERE device_id = ?`
        )
        .all("abcd1234-5678");
      assert.equal(kept.length, 1, "archived row retained");
      assert.equal(kept[0].dismissed_at, 3);

      // GET mapping shape used by the route (dismissedAt surfaces to clients)
      assert.equal(kept[0].fired_at, 2);
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
