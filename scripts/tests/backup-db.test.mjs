import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtempSync, rmSync, writeFileSync, existsSync, utimesSync, readdirSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { openDb } from "../lib/db.mjs";
import { backupDb } from "../backup-db.mjs";

function tempWorkspace(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "niftyterm-backup-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function seededSource(dir) {
  const dbPath = path.join(dir, "app.db");
  const db = openDb(dbPath);
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
  db.prepare("INSERT INTO t (v) VALUES (?)").run("hello");
  db.close();
  return dbPath;
}

test("backup snapshots a seeded db (VACUUM INTO) and copies board.json", (t) => {
  const dir = tempWorkspace(t);
  const dbPath = seededSource(path.join(dir, "src"));
  const board = path.join(dir, "board.json");
  writeFileSync(board, '{"tasks":[]}');

  const outDir = path.join(dir, "backups");
  const res = backupDb({ dbPath, outDir, boardPath: board });

  assert.ok(res.ok && !res.skipped, "backup ran");
  assert.ok(existsSync(res.dbBackup), "db snapshot exists");

  const check = openDb(res.dbBackup);
  try {
    const row = check.prepare("SELECT v FROM t").get();
    assert.equal(row.v, "hello", "row survives snapshot");
    assert.equal(check.prepare("PRAGMA quick_check").get().quick_check, "ok");
  } finally {
    check.close();
  }

  assert.ok(res.boardBackup && existsSync(res.boardBackup), "board.json copied");
});

test("absent source skips cleanly — fresh clone is unaffected", (t) => {
  const dir = tempWorkspace(t);
  const missing = path.join(dir, "nope", "app.db");
  const res = backupDb({ dbPath: missing, outDir: path.join(dir, "backups") });
  assert.deepEqual(
    { skipped: res.skipped, ok: res.ok },
    { skipped: "db-absent", ok: true }
  );
  assert.equal(res.dbBackup, undefined, "no snapshot written");
});

test("retention prunes stale pairs but never the newest", (t) => {
  const dir = tempWorkspace(t);
  const dbPath = seededSource(path.join(dir, "src"));
  const outDir = path.join(dir, "backups");

  const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  mkdirSync(outDir, { recursive: true });
  for (const stem of ["app-20200101-000000.db", "app-20200101-000000.json"]) {
    writeFileSync(path.join(outDir, stem), "x");
    utimesSync(path.join(outDir, stem), old, old);
  }

  const res = backupDb({ dbPath, outDir, boardPath: path.join(dir, "absent-board.json") });

  const files = readdirSync(outDir).sort();
  assert.ok(!files.includes("app-20200101-000000.db"), "old db pruned");
  assert.ok(!existsSync(path.join(outDir, "app-20200101-000000.json")), "old json pruned with pair");
  assert.ok(res.pruned.length >= 2, "prune report lists both files");
  assert.equal(files.filter((f) => f.endsWith(".db")).length, 1, "exactly the new snapshot remains");
});
