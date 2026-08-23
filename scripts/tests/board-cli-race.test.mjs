/**
 * TASK-21 - CLI writers must not lost-update across gate runs.
 *
 * Incident (activity trail, 2026-08-23 ~08:25-08:31Z): TASK-14's ship held a
 * board snapshot through its gate+commit window and wrote it back whole,
 * erasing the CTO's TASK-15 claim + activity that landed mid-window.
 *
 * These tests pin the two fixes:
 *   1. board.mjs save() re-reads + LWW-merges immediately before writing
 *   2. workflow flips are applied to a freshly-loaded board
 * plus parity of scripts/lib/board-merge.mjs against the TS source of truth
 * (web/src/lib/kanban/merge.ts) so the port cannot silently drift.
 *
 * Run: npm test  (from web/)
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const T0 = Date.now() - 60_000;
// board.mjs reads NIFTY_BOARD_FILE at first import; ESM caches the module, so
// every test in this file shares one instance and therefore one file path.
const FILE = path.join(os.tmpdir(), "nifty-board-test-" + process.pid + ".json");

function seedBoard(tasks, extra = {}) {
  fs.writeFileSync(
    FILE,
    JSON.stringify({ tasks, activities: [], deletions: [], ...extra }),
    "utf-8",
  );
}

const task = (id, over = {}) => ({
  id,
  title: "task " + id,
  desc: "",
  phase: "A",
  priority: "P2",
  status: "todo",
  assignee: null,
  labels: [],
  estimate: 3,
  checklist: [],
  createdAt: T0,
  updatedAt: T0,
  blocked: false,
  ...over,
});

async function loadBoardModule() {
  process.env.NIFTY_BOARD_FILE = FILE;
  return import("../../scripts/board.mjs");
}

test("gate-window clobber repro: save() preserves tasks created mid-window", async () => {
  const { load, save } = await loadBoardModule();
  seedBoard( [task("TASK-01"), task("TASK-02")]);

  // writer A loads (then would run 40s+ of gates holding this snapshot)...
  const staleSnapshot = load();
  // ...meanwhile writer B lands a brand-new task
  seedBoard([task("TASK-01"), task("TASK-02"), task("TASK-03")]);
  // ...and a third writer ticks TASK-02
  const midTick = JSON.parse(fs.readFileSync(FILE, "utf-8"));
  const t2 = midTick.tasks.find((t) => t.id === "TASK-02");
  t2.checklist.push({ id: "1", text: "ac", done: true });
  t2.updatedAt = Date.now();
  fs.writeFileSync(FILE, JSON.stringify(midTick), "utf-8");

  // writer A finally saves its stale snapshot with its own flip
  const flipTarget = staleSnapshot.tasks.find((t) => t.id === "TASK-01");
  flipTarget.status = "review";
  flipTarget.updatedAt = Date.now();
  save(staleSnapshot);

  const out = JSON.parse(fs.readFileSync(FILE, "utf-8"));
  assert.equal(out.tasks.length, 3, "mid-window task survived");
  assert.ok(out.tasks.find((t) => t.id === "TASK-03"), "no erasure");
  assert.equal(out.tasks.find((t) => t.id === "TASK-01").status, "review", "writer A's flip applied");
  const ticked = out.tasks.find((t) => t.id === "TASK-02").checklist.some((c) => c.done);
  assert.ok(ticked, "mid-window tick survived");
});

test("web-side deletions are honored: CLI cannot resurrect a tombstoned task", async () => {
  const { load, save } = await loadBoardModule();
  const delAt = T0 + 5_000;
  seedBoard([task("TASK-09")], { deletions: [{ id: "TASK-09", at: delAt }] });

  // stale writer still carries the deleted task in its snapshot
  const stale = load();
  stale.tasks = [task("TASK-09"), task("TASK-10")];
  save(stale);

  const out = JSON.parse(fs.readFileSync(FILE, "utf-8"));
  assert.equal(out.tasks.find((t) => t.id === "TASK-09"), undefined, "tombstone respected");
  assert.ok(out.tasks.find((t) => t.id === "TASK-10"), "other tasks kept");
});

test("'deleted' activity markers fold into tombstones on the CLI path too", async () => {
  const { load, save } = await loadBoardModule();
  const victim = task("TASK-07");
  seedBoard([victim], {
    activities: [{ id: "X1", taskId: "TASK-07", text: "deleted", agent: "CIPHER", at: T0 + 9_000 }],
  });

  const stale = load(); // stale copy still contains TASK-07
  save(stale);

  const out = JSON.parse(fs.readFileSync(FILE, "utf-8"));
  assert.equal(out.tasks.find((t) => t.id === "TASK-07"), undefined, "stays deleted");
});

test("single canonical impl: CLI path and TS facade share one module (TASK-24)", async () => {
  const ts = await import("../../web/src/lib/kanban/merge.ts");
  const mjs = await import("../../web/src/lib/kanban/board-merge.mjs");

  // TASK-24 shrank the old dual-implementation parity suite: there is now one
  // canonical module; merge.ts is a typed delegating facade. Guard that it
  // stayed a pure delegate (no reimplemented merge logic drifting back in).
  const facadeSrc = fs.readFileSync(
    new URL("../../web/src/lib/kanban/merge.ts", import.meta.url),
    "utf-8",
  );
  assert.match(facadeSrc, /from "\.\/board-merge\.mjs"/, "facade must delegate");
  assert.doesNotMatch(facadeSrc, /new Map\(/, "no merge logic in the facade");

  const server = {
    tasks: [task("TASK-01", { updatedAt: T0 + 100 }), task("TASK-02")],
    activities: [{ id: "A1", taskId: "TASK-01", text: "moved todo to doing", agent: "GHOST", at: T0 + 50 }],
    deletions: [{ id: "TASK-99", at: T0 }],
  };
  const incoming = {
    tasks: [task("TASK-01", { status: "done", updatedAt: T0 + 200 }), task("TASK-03")],
    activities: [{ id: "A2", taskId: "TASK-03", text: "created in todo", agent: "CIPHER", at: T0 + 150 }],
    deletions: [{ id: "TASK-98", at: T0 + 10 }],
  };

  // behavior flows through the same underlying functions
  assert.deepEqual(ts.mergeBoards(server, incoming), mjs.mergeBoards(server, incoming));
  assert.deepEqual(ts.replaceBoard(incoming), mjs.replaceBoard(incoming));
  assert.deepEqual(
    ts.validateBoardPayload({ tasks: [task("X")], activities: [] }).value,
    mjs.validateBoardPayload({ tasks: [task("X")], activities: [] }).value,
  );
});

test("TASK-27 repro: simultaneous creators with the same id both survive", async () => {
  const { load, save, nextTaskId } = await loadBoardModule();
  seedBoard([task("TASK-01"), task("TASK-02")]);

  // both writers derive "TASK-03" from their local snapshots
  const a = load(), b = load();
  assert.equal(nextTaskId(a), "TASK-03");
  const ta = { ...task("TASK-03"), title: "writer A's task", createdAt: T0 + 1000, updatedAt: T0 + 1000 };
  const tb = { ...task("TASK-03"), title: "writer B's task", createdAt: T0 + 2000, updatedAt: T0 + 2000 };
  a.tasks.push(ta);
  b.tasks.push(tb);

  save(a); // writer A lands first
  save(b); // writer B must NOT erase A's task (nor lose its own)

  const out = JSON.parse(fs.readFileSync(FILE, "utf-8"));
  const titles = out.tasks.map((t) => t.title).sort();
  assert.ok(titles.includes("writer A's task"), "A's creation survived");
  assert.ok(titles.includes("writer B's task"), "B's creation survived (mangled id)");
  const ids = new Set(out.tasks.map((t) => t.id));
  assert.equal(ids.size, out.tasks.length, "ids remain unique after mangle");

  // max-suffix allocation ignores mangled suffixes and keeps working
  assert.equal(nextTaskId(out), "TASK-04");
});

test("TASK-27 migration: gapped legacy boards get gap-free max+1 allocation", async () => {
  const { nextTaskId } = await loadBoardModule();
  // pre-change board where deletions left gaps in TASK-nn
  const gapped = { tasks: [task("TASK-01"), task("TASK-07"), task("TASK-09")] };
  assert.equal(nextTaskId(gapped), "TASK-10");
});

test("TASK-17: uiInPaths + gateTrail helpers", async () => {
  process.env.NIFTY_BOARD_FILE = FILE;
  const { uiInPaths, gateTrail } = await import("../../scripts/workflow.mjs");

  assert.deepEqual(
    uiInPaths(["web/src/app/page.tsx", "docs/x.md", "web/src/components/ChartPanel.tsx", "src/other.ts"]),
    ["web/src/app/page.tsx", "web/src/components/ChartPanel.tsx"],
  );
  // prefix discipline: web/src/apples.ts is NOT a UI surface
  assert.deepEqual(uiInPaths(["web/src/apples.ts"]), []);

  const trail = gateTrail([
    { key: "tsc", ms: 9400, ok: true, skipped: false },
    { key: "lint", ms: 21000, ok: true, skipped: false },
    { key: "test", ms: 0, ok: true, skipped: true },
  ]);
  assert.equal(trail, "tsc=9.4s·lint=21.0s·test=skip");
});

test("flipStatus mutates fresh board and reports missing tasks cleanly", async () => {
  process.env.NIFTY_BOARD_FILE = FILE;
  const { flipStatus } = await import("../../scripts/workflow.mjs");
  const b = { tasks: [task("TASK-01")], activities: [] };
  const ok = flipStatus(b, "TASK-01", "review", "review - gates green", "cipher");
  assert.equal(ok.ok, true);
  assert.equal(b.tasks[0].status, "review");
  assert.equal(b.activities.length, 1);
  const miss = flipStatus({ tasks: [] }, "TASK-404", "done", "x", "cipher");
  assert.equal(miss.ok, false);
});
