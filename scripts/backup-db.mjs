#!/usr/bin/env node
// TASK-1389 — SQLite backup + restore story.
//
// Produces a consistent point-in-time snapshot of the live database via
// `VACUUM INTO` (WAL-safe: reads a committed view regardless of -wal state,
// works identically on the better-sqlite3 and node:sqlite drivers resolved
// by scripts/lib/db.mjs) plus a copy of data/board.json, then prunes stale
// backups beyond the retention window.
//
// Usage:
//   node scripts/backup-db.mjs                       # default paths, fail if DB absent
//   node scripts/backup-db.mjs --if-present          # skip cleanly when DB absent (cron/fresh-clone)
//   node scripts/backup-db.mjs --db X --out Y --retention-days N
//
// Exit codes: 0 ok/skip · 1 failure.

import path from "node:path";
import { existsSync, copyFileSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openDb, DEFAULT_DB_PATH } from "./lib/db.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.join(here, "..");
export const DEFAULT_BOARD_PATH = path.join(REPO_ROOT, "data", "board.json");
export const DEFAULT_OUT_DIR = path.join(REPO_ROOT, "backups");
const FILENAME_RE = /^app-\d{8}-\d{6}\.(db|json)$/;

function stamp(d = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return (
    `${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
  );
}

function uniqueDest(dir, base) {
  let dest = path.join(dir, base);
  let i = 0;
  while (existsSync(dest)) dest = path.join(dir, base.replace(/\.db$/, `-${++i}.db`));
  return dest;
}

/**
 * Snapshot `dbPath` into `outDir` (VACUUM INTO) + copy `boardPath`, then prune
 * backups older than `retentionDays`. Never prunes the newest pair.
 */
export function backupDb({
  dbPath = DEFAULT_DB_PATH,
  outDir = DEFAULT_OUT_DIR,
  boardPath = DEFAULT_BOARD_PATH,
  retentionDays = 14,
  now = new Date(),
} = {}) {
  if (!existsSync(dbPath)) return { ok: true, skipped: "db-absent", pruned: [] };

  mkdirSync(outDir, { recursive: true });
  const stem = `app-${stamp(now)}`;
  const dest = uniqueDest(outDir, `${stem}.db`);

  const src = openDb(dbPath);
  try {
    src.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  } finally {
    src.close();
  }

  // verify snapshot is readable and integral before we trust it
  const check = openDb(dest);
  let integrity;
  try {
    integrity = check.prepare("PRAGMA quick_check").get();
  } finally {
    check.close();
  }
  const okRow = integrity && Object.values(integrity)[0] === "ok";
  if (!okRow) throw new Error(`backup failed quick_check: ${JSON.stringify(integrity)}`);

  // newest pair wins — record before pruning
  let boardBackup = null;
  if (existsSync(boardPath)) {
    boardBackup = path.join(outDir, `${path.basename(boardPath, ".json")}-${stem}.json`);
    copyFileSync(boardPath, boardBackup);
  }

  const pruned = pruneBackups({ outDir, retentionDays, now });

  return {
    ok: true,
    dbBackup: dest,
    boardBackup,
    bytes: statSync(dest).size,
    integrity: "ok",
    pruned,
  };
}

/** Delete paired .db/.json backups older than the retention window. */
export function pruneBackups({ outDir, retentionDays, now = new Date() }) {
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  const stems = new Map(); // stem -> { db?: string, json?: string, mtime: number }
  for (const f of readdirSync(outDir)) {
    if (!FILENAME_RE.test(f)) continue;
    const stem = f.replace(/\.(db|json)$/, "");
    const full = path.join(outDir, f);
    const mtime = statSync(full).mtimeMs;
    const entry = stems.get(stem) ?? { mtime: -1 };
    entry[f.endsWith(".db") ? "db" : "json"] = full;
    entry.mtime = Math.max(entry.mtime, mtime);
    stems.set(stem, entry);
  }
  const ordered = [...stems.entries()].sort((a, b) => b[1].mtime - a[1].mtime);
  const pruned = [];
  for (const [stem, entry] of ordered.slice(1)) {
    if (entry.mtime >= cutoff) continue;
    for (const key of ["db", "json"]) {
      if (entry[key]) {
        rmSyncQuiet(entry[key]);
        pruned.push(path.basename(entry[key]));
      }
    }
    stems.delete(stem);
  }
  return pruned;
}

function rmSyncQuiet(p) {
  rmSync(p, { force: true });
}

// ---------------------------------------------------------------------------
// CLI

function parseArgs(argv) {
  const args = { retentionDays: 14 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--if-present") args.ifPresent = true;
    else if (a === "--db") args.db = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--board") args.board = argv[++i];
    else if (a === "--retention-days") args.retentionDays = Number(argv[++i]);
    else throw new Error(`unknown arg: ${a}`);
  }
  return args;
}

export function main(argv = process.argv) {
  const args = parseArgs(argv);
  const result = backupDb({
    dbPath: args.db ?? DEFAULT_DB_PATH,
    outDir: args.out ?? DEFAULT_OUT_DIR,
    boardPath: args.board ?? DEFAULT_BOARD_PATH,
    retentionDays: args.retentionDays,
  });
  if (result.skipped === "db-absent") {
    if (!args.ifPresent) {
      console.error(`no database at ${args.db ?? DEFAULT_DB_PATH} — nothing to back up (use --if-present to allow this)`);
      return 1;
    }
    console.log("backup skipped: db absent (fresh clone / CI cold cache)");
    return 0;
  }
  console.log(
    `backup ok: ${result.dbBackup} (${(result.bytes / 1024 / 1024).toFixed(1)} MB, quick_check ok)` +
      (result.boardBackup ? ` + ${path.basename(result.boardBackup)}` : "") +
      (result.pruned.length ? ` · pruned ${result.pruned.length}` : "")
  );
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
