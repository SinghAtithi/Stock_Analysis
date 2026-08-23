/**
 * TASK-02 — board sync lost-update guard.
 *
 * Repro of the 2026-08-23 incident (LOG.md): a web /board tab hydrated before
 * the CLI created TASK-02..09; the tab ticked one checklist item and its
 * full-state POST wiped all 8 tasks. mergeBoards() must make that impossible.
 *
 * Run: npm test  (from web/)  ·  node --test scripts/tests/board-sync.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mergeBoards, replaceBoard, validateBoardPayload } from "../../web/src/lib/kanban/merge.ts";

let seq = 0;
const T0 = Date.now() - 60_000; // recent epoch so the 30d tombstone TTL never fires
function task(over = {}) {
  seq += 1;
  return {
    id: `TASK-${String(seq).padStart(2, "0")}`,
    title: `task ${seq}`,
    desc: "",
    phase: "A",
    priority: "P2",
    status: "todo",
    assignee: null,
    labels: [],
    estimate: 3,
    checklist: [],
    createdAt: T0 + seq * 1000,
    updatedAt: T0 + seq * 1000,
    blocked: false,
    ...over,
  };
}
const payload = (tasks, extra = {}) => validateBoardPayload({ tasks, activities: [], deletions: [], ...extra }).value;

test("incident repro: stale full-state POST cannot erase tasks it never saw", () => {
  const serverTasks = [task(), task(), task(), task(), task(), task(), task(), task()];
  const shared = { ...serverTasks[0], status: "doing", updatedAt: serverTasks[0].updatedAt + 5 };
  // stale tab only ever saw the first two tasks; its POST carries just those
  const out = mergeBoards({ tasks: serverTasks, activities: [], deletions: [] }, payload([shared, task()]));
  assert.equal(out.tasks.length, 9, "all 8 CLI tasks + tab's new task survive");
  assert.equal(out.tasks.find((t) => t.id === serverTasks[0].id).status, "doing", "tab's edit applied");
});

test("newer server copy wins when a stale writer re-sends an old revision", () => {
  const serverTask = task({ updatedAt: 5000 });
  const staleCopy = { ...serverTask, title: "old title", updatedAt: 4000 };
  const out = mergeBoards({ tasks: [serverTask], activities: [], deletions: [] }, payload([staleCopy]));
  assert.equal(out.tasks[0].title, serverTask.title, "server's newer revision kept");
});

test("interleaved writers: concurrent create + edit both land, zero lost", () => {
  const base = [task()];
  // writer B creates T2 before writer A's edit lands
  const afterB = mergeBoards({ tasks: base, activities: [], deletions: [] }, payload([...base, task()]));
  const edited = { ...base[0], status: "review", updatedAt: T0 + 60_000 };
  const afterA = mergeBoards(afterB, payload([edited]));
  assert.equal(afterA.tasks.length, 2, "B's new task survived A's full-state POST");
  assert.equal(afterA.tasks.find((t) => t.id === base[0].id).status, "review", "A's edit landed");
});

test("deletion tombstone drops task and blocks resurrection by stale writers", () => {
  const t = task();
  const delAt = t.updatedAt + 10;
  const state = mergeBoards({ tasks: [t], activities: [], deletions: [] }, payload([t], { deletions: [{ id: t.id, at: delAt }] }));
  assert.equal(state.tasks.length, 0, "deleted task dropped");
  assert.ok(state.deletions.some((d) => d.id === t.id), "tombstone persisted");

  const resurrectAttempt = mergeBoards(state, payload([{ ...t, updatedAt: t.updatedAt + 5 }]));
  assert.equal(resurrectAttempt.tasks.length, 0, "stale copy after delete stays deleted");

  const recreated = mergeBoards(state, payload([{ ...t, title: "recreated", updatedAt: delAt + 1 }]));
  assert.equal(recreated.tasks.length, 1, "edit newer than tombstone recreates the task");
});

test("'deleted' activity markers fold into tombstones (client sends no deletions array)", () => {
  const t = task();
  const delAct = { id: "X1", taskId: t.id, text: "deleted", agent: "CIPHER", at: t.updatedAt + 10 };
  const state = mergeBoards({ tasks: [t], activities: [], deletions: [] }, payload([], { activities: [delAct] }));
  assert.equal(state.tasks.length, 0, "activity-derived delete honored");
});

test("tombstone TTL uses injected clock — swept after 30d, task returns next cycle", () => {
  const t = task();
  const delAt = t.updatedAt + 10;
  const DAY = 24 * 60 * 60 * 1000;
  const aged = { tasks: [t], activities: [], deletions: [{ id: t.id, at: delAt }] };
  const s1 = mergeBoards(aged, payload([t]), delAt + 31 * DAY);
  assert.equal(s1.tasks.length, 0, "still hidden while the aged tombstone is in hand");
  assert.equal(s1.deletions.length, 0, "expired tombstone swept from persisted set");
  const s2 = mergeBoards(s1, payload([t]));
  assert.equal(s2.tasks.length, 1, "next sync resurrects once the tombstone is gone");
});

test("activities merge by id, newest first, capped at 80", () => {
  const serverActs = Array.from({ length: 80 }, (_, i) => ({ id: `S${i}`, taskId: "TASK-01", text: "a", agent: "GHOST", at: T0 + i }));
  const incoming = [{ id: "N1", taskId: "TASK-01", text: "b", agent: "CIPHER", at: T0 + 10_000 }, serverActs[0]];
  const out = mergeBoards({ tasks: [], activities: serverActs, deletions: [] }, payload([], { activities: incoming }));
  assert.equal(out.activities.length, 80);
  assert.equal(out.activities[0].id, "N1", "newest first");
  assert.equal(out.activities.filter((a) => a.id === "S0").length, 0, "cap drops oldest");
  assert.equal(out.activities.filter((a) => a.id === "S1").length, 1, "rest kept");
});

test("validation rejects malformed payloads (route would 400)", () => {
  assert.equal(validateBoardPayload(null).ok, false);
  assert.equal(validateBoardPayload({}).ok, false);
  assert.equal(validateBoardPayload({ tasks: "nope" }).ok, false);
  assert.equal(validateBoardPayload({ tasks: [{ id: "X" }] }).ok, false);
  assert.equal(
    validateBoardPayload({ tasks: [{ ...task(), status: "bogus" }] }).ok,
    false,
    "bad column rejected",
  );
  assert.equal(validateBoardPayload({ tasks: [task()], activities: [{ id: "A" }] }).ok, false, "activity missing text/at");
});

test("replace mode (import): snapshot swaps the board and clears tombstones", () => {
  const server = { tasks: [task()], activities: [], deletions: [{ id: "TASK-99", at: 5 }] };
  const snapshot = payload([task()]);
  const out = replaceBoard(snapshot);
  assert.notEqual(out.tasks[0].id, server.tasks[0].id, "old set fully replaced");
  assert.deepEqual(out.deletions, [], "snapshot is authoritative");
});
