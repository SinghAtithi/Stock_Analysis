/**
 * TASK-1394 — board payload sanitizer.
 *
 * POST /api/board bodies are untrusted JSON. The old validator spread tasks
 * verbatim ({...t}), preserving arbitrary attacker keys — including
 * `__proto__` (an OWN key after JSON.parse) — and accepted unbounded task
 * arrays. These pin: allowlist-rebuild strips junk/danger keys, oversized
 * boards reject with too_many_tasks, and legit payloads survive byte-clean.
 *
 * Run: npm test  (from web/)  ·  node --test scripts/tests/board-sanitize.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_TASKS,
  mergeBoards,
  validateBoardPayload,
} from "../../web/src/lib/kanban/merge.ts";

let seq = 0;
const T0 = Date.now() - 60_000;
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

function parse(raw) {
  return JSON.parse(raw); // what a hostile client actually sends
}

test("hostile task: __proto__/constructor/junk own-keys stripped, legit fields kept", () => {
  const raw = parse(`{
    "id":"TASK-9001","title":"evil","desc":"","phase":"A","priority":"P2",
    "status":"todo","assignee":null,"labels":[],"estimate":3,"checklist":[],
    "blocked":false,
    "createdAt":${T0},"updatedAt":${T0},
    "__proto__":{"polluted":true},
    "constructor":{"prototype":{}},
    "junk":{"deep":{"deeper":1}}
  }`);
  const v = validateBoardPayload({ tasks: [raw], activities: [], deletions: [] });
  assert.ok(v.ok, `valid shape must pass: ${v.error ?? ""}`);

  const merged = mergeBoards(null, v.value);
  const t = merged.tasks[0];
  assert.equal(t.title, "evil", "legit field survives");
  assert.equal(Object.hasOwn(t, "__proto__") && t.__proto__?.polluted === true, false, "no proto payload");
  assert.equal(Object.hasOwn(t, "constructor"), false);
  assert.equal(Object.hasOwn(t, "junk"), false);
  assert.deepEqual(Object.keys(t).sort(), [
    "assignee", "blocked", "checklist", "createdAt", "desc", "estimate", "id",
    "labels", "phase", "priority", "status", "title", "updatedAt",
  ].sort(), "exactly the canonical fields");
});

test("pollution cannot reach the persisted object graph via merge", () => {
  const raw = parse(`{
    "id":"TASK-9002","title":"p","desc":"","phase":"A","priority":"P1",
    "status":"doing","assignee":null,"labels":[],"estimate":1,"checklist":[],
    "createdAt":${T0},"updatedAt":${T0},"__proto__":{"isAdmin":true}
  }`);
  const v = validateBoardPayload({ tasks: [raw], activities: [], deletions: [] });
  mergeBoards(null, v.value);
  assert.equal(({}).isAdmin, undefined, "Object.prototype untouched");
  assert.equal(JSON.parse(JSON.stringify({})).isAdmin, undefined);
});

test("activities and tombstones are allowlist-rebuilt too", () => {
  const rawAct = parse(`{"id":"A1","taskId":"TASK-1","text":"x","agent":"CIPHER","at":${T0},"spoofed":true,"__proto__":{}}`);
  const rawDel = parse(`{"id":"TASK-1","at":${T0 + 5},"extra":1}`);
  const v = validateBoardPayload({ tasks: [], activities: [rawAct], deletions: [rawDel] });
  assert.ok(v.ok);
  assert.deepEqual(Object.keys(v.value.activities[0]).sort(), ["agent", "at", "id", "taskId", "text"]);
  assert.deepEqual(Object.keys(v.value.deletions[0]).sort(), ["at", "id"]);
});

test("boards above MAX_TASKS reject with too_many_tasks; just under passes", () => {
  const big = [];
  for (let i = 0; i <= MAX_TASKS; i += 1) big.push(task({ id: `X-${i}` }));
  const over = validateBoardPayload({ tasks: big, activities: [], deletions: [] });
  assert.equal(over.ok, false);
  assert.equal(over.error, "too_many_tasks");

  const under = validateBoardPayload({ tasks: big.slice(0, MAX_TASKS), activities: [], deletions: [] });
  assert.equal(under.ok, true, `${MAX_TASKS} tasks is the documented cap`);
});
