import path from "node:path";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = path.resolve(here, "..", "..");
export const DEFAULT_DB_PATH = path.join(REPO_ROOT, "db", "data", "app.db");

function tryRequire(specifier) {
  try {
    return require(specifier);
  } catch {
    return null;
  }
}

export function loadDriver() {
  const betterSqlite3 =
    tryRequire("better-sqlite3") ??
    tryRequire(path.join(REPO_ROOT, "web", "node_modules", "better-sqlite3"));
  if (betterSqlite3) {
    return { name: "better-sqlite3", Database: betterSqlite3 };
  }
  const builtin = tryRequire("node:sqlite");
  if (builtin?.DatabaseSync) {
    return { name: "node:sqlite", Database: builtin.DatabaseSync };
  }
  throw new Error(
    "No SQLite driver available: install better-sqlite3 (npm install better-sqlite3 in web/), " +
      "or use Node >= 22.5 which ships node:sqlite (older versions may need --experimental-sqlite)."
  );
}

export const DRIVER = loadDriver();

export function openDb(dbPath = DEFAULT_DB_PATH) {
  if (dbPath !== ":memory:") {
    mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new DRIVER.Database(dbPath);
  db.exec(
    "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;"
  );
  return db;
}
