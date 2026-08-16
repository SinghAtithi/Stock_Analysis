import path from "node:path";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openDb } from "./lib/db.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

export const MIGRATIONS_DIR = path.join(here, "..", "db", "migrations");

export function migrationFiles(dir = MIGRATIONS_DIR) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

export function ensureSchemaMigrations(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    applied_at INTEGER NOT NULL
  )`);
}

function runMigration(db, sql, name) {
  const apply = () => {
    db.exec(sql);
    db.prepare(
      "INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)"
    ).run(name, Date.now());
  };
  if (typeof db.transaction === "function") {
    db.transaction(apply)();
  } else {
    apply();
  }
}

export function applyMigrations(db, { dir = MIGRATIONS_DIR } = {}) {
  ensureSchemaMigrations(db);
  const applied = new Set(
    db.prepare("SELECT name FROM schema_migrations").all().map((r) => r.name)
  );
  const result = { applied: [], skipped: [] };
  for (const file of migrationFiles(dir)) {
    if (applied.has(file)) {
      result.skipped.push(file);
      continue;
    }
    const sql = readFileSync(path.join(dir, file), "utf8");
    runMigration(db, sql, file);
    result.applied.push(file);
  }
  return result;
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const db = openDb();
  try {
    const result = applyMigrations(db);
    for (const file of result.applied) console.log(`applied  ${file}`);
    for (const file of result.skipped) console.log(`skipped  ${file} (already applied)`);
    if (result.applied.length === 0 && result.skipped.length === 0) {
      console.log("no migrations found in", MIGRATIONS_DIR);
    }
    console.log(
      `migrate: ${result.applied.length} applied, ${result.skipped.length} skipped`
    );
  } finally {
    db.close();
  }
}
