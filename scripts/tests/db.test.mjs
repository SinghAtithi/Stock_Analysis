import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { openDb, DRIVER } from "../lib/db.mjs";
import { applyMigrations, migrationFiles } from "../migrate.mjs";

function tempDb() {
  const dir = mkdtempSync(path.join(tmpdir(), "niftyterm-db-test-"));
  const db = openDb(path.join(dir, "test.db"));
  return { dir, db };
}

test("migrations apply once and re-run is a no-op", (t) => {
  const { dir, db } = tempDb();
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  assert.ok(migrationFiles().length >= 1, "at least one migration file exists");

  const first = applyMigrations(db);
  assert.equal(first.applied.length, migrationFiles().length, "all files applied");
  assert.equal(first.skipped.length, 0, "nothing skipped on first run");

  const second = applyMigrations(db);
  assert.equal(second.applied.length, 0, "second run applies nothing");
  assert.deepEqual(second.skipped, first.applied, "second run skips previously applied");

  const rows = db.prepare("SELECT name FROM schema_migrations ORDER BY name").all();
  assert.deepEqual(
    rows.map((r) => r.name),
    first.applied,
    "schema_migrations tracks applied names"
  );
});

test("eod_candles insert roundtrip and upsert", (t) => {
  const { dir, db } = tempDb();
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  applyMigrations(db);

  const row = {
    symbol: "RELIANCE.NS",
    ts: 1755225000,
    o: 3000.0,
    h: 3050.5,
    l: 2990.25,
    c: 3040.75,
    v: 1234567,
    adj_factor: 1,
  };
  const insert = db.prepare(
    `INSERT INTO eod_candles (symbol, ts, o, h, l, c, v, adj_factor)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insert.run(
    row.symbol,
    row.ts,
    row.o,
    row.h,
    row.l,
    row.c,
    row.v,
    row.adj_factor
  );

  const got = db
    .prepare("SELECT * FROM eod_candles WHERE symbol = ? AND ts = ?")
    .get(row.symbol, row.ts);
  assert.equal(got.symbol, row.symbol);
  assert.equal(got.ts, row.ts);
  assert.equal(got.o, row.o);
  assert.equal(got.h, row.h);
  assert.equal(got.l, row.l);
  assert.equal(got.c, row.c);
  assert.equal(got.v, row.v);
  assert.equal(got.adj_factor, row.adj_factor);

  const upsert = db.prepare(
    `INSERT INTO eod_candles (symbol, ts, o, h, l, c, v, adj_factor)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (symbol, ts) DO UPDATE SET
       o = excluded.o, h = excluded.h, l = excluded.l, c = excluded.c,
       v = excluded.v, adj_factor = excluded.adj_factor`
  );
  upsert.run(row.symbol, row.ts, 3010, 3060, 3005, 3055, 999, 1.5);

  const updated = db
    .prepare("SELECT * FROM eod_candles WHERE symbol = ? AND ts = ?")
    .get(row.symbol, row.ts);
  assert.equal(updated.c, 3055);
  assert.equal(updated.v, 999);
  assert.equal(updated.adj_factor, 1.5);

  const count = db.prepare("SELECT COUNT(*) AS n FROM eod_candles").get();
  assert.equal(count.n, 1, "upsert did not create a duplicate row");
});

test("openDb enables WAL and foreign_keys", (t) => {
  const { dir, db } = tempDb();
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const journal = db.prepare("PRAGMA journal_mode").get();
  assert.equal(journal.journal_mode, "wal");
  const fk = db.prepare("PRAGMA foreign_keys").get();
  assert.equal(fk.foreign_keys, 1);
});

test("driver resolves", () => {
  assert.ok(["better-sqlite3", "node:sqlite"].includes(DRIVER.name));
});
