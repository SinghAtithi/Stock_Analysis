/**
 * Plain-JS port of web/src/lib/kanban/merge.ts (TASK-02) so CLI writers
 * (scripts/board.mjs, scripts/workflow.mjs) get the same lost-update-safe
 * merge as POST /api/board — TASK-21. Keep the two files semantically in sync;
 * scripts/tests/board-cli-race.test.mjs asserts parity on canonical cases.
 *
 * Merge contract:
 * - union of task ids; ids on both sides resolve by newest `updatedAt`
 * - persisted deletions[] and "deleted" activity markers hide tasks whose
 *   `updatedAt <= at`; newer edits recreate the task
 * - activities union by id, newest first, capped at MAX_ACTIVITIES
 */

export const MAX_ACTIVITIES = 80;
export const MAX_DELETIONS = 200;

const COLUMNS = new Set(["backlog", "todo", "doing", "review", "done"]);
const PHASES = new Set(["A", "B", "C", "D", "E"]);
const PRIORITIES = new Set(["P0", "P1", "P2", "P3"]);

function isObj(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isNum(v) {
  return typeof v === "number" && Number.isFinite(v);
}
function isStr(v) {
  return typeof v === "string";
}
function isTask(v) {
  if (!isObj(v)) return false;
  return (
    isStr(v.id) && v.id.length > 0 &&
    isStr(v.title) &&
    isStr(v.status) && COLUMNS.has(v.status) &&
    isStr(v.phase) && PHASES.has(v.phase) &&
    isStr(v.priority) && PRIORITIES.has(v.priority) &&
    Array.isArray(v.labels) && v.labels.every(isStr) &&
    isNum(v.estimate) &&
    Array.isArray(v.checklist) && v.checklist.every(
      (c) => isObj(c) && isStr(c.id) && isStr(c.text) && typeof c.done === "boolean",
    ) &&
    isNum(v.createdAt) &&
    isNum(v.updatedAt)
  );
}

/** Validate a full-state payload; returns {ok,value}|{ok,error}. */
export function validateBoardPayload(body) {
  if (!isObj(body)) return { ok: false, error: "body must be a JSON object" };
  if (!Array.isArray(body.tasks)) return { ok: false, error: "tasks must be an array" };
  for (const t of body.tasks) {
    if (!isTask(t)) return { ok: false, error: `malformed task ${isObj(t) && isStr(t.id) ? t.id : "(no id)"}` };
  }
  let activities = [];
  if (body.activities !== undefined) {
    if (!Array.isArray(body.activities)) return { ok: false, error: "activities must be an array" };
    for (const a of body.activities) {
      if (!isObj(a) || !isStr(a.id) || !isStr(a.text) || !isNum(a.at)) {
        return { ok: false, error: "each activity needs string id, string text, number at" };
      }
    }
    activities = body.activities;
  }
  let deletions = [];
  if (body.deletions !== undefined) {
    if (!Array.isArray(body.deletions)) return { ok: false, error: "deletions must be an array" };
    for (const d of body.deletions) {
      if (!isObj(d) || !isStr(d.id) || !isNum(d.at)) {
        return { ok: false, error: "each deletion needs string id and number at" };
      }
    }
    deletions = body.deletions;
  }
  return {
    ok: true,
    value: { tasks: body.tasks.map((t) => ({ ...t })), activities, deletions },
  };
}

function tombstonesFromActivities(activities) {
  const out = new Map();
  for (const a of activities) {
    if (a.taskId && a.text === "deleted") {
      out.set(a.taskId, Math.max(out.get(a.taskId) ?? 0, a.at));
    }
  }
  return [...out].map(([id, at]) => ({ id, at }));
}

/** Merge an incoming full-state payload into the current server state (pure). */
export function mergeBoards(server, incoming) {
  const now = Date.now();
  const delAt = new Map();
  const fold = (list) => {
    for (const d of list) delAt.set(d.id, Math.max(delAt.get(d.id) ?? 0, d.at));
  };
  fold(tombstonesFromActivities(server?.activities ?? []));
  fold(tombstonesFromActivities(incoming.activities));
  fold(server?.deletions ?? []);
  fold(incoming.deletions ?? []);

  const alive = (t) => {
    const at = delAt.get(t.id);
    return at === undefined || t.updatedAt > at;
  };

  const byId = new Map();
  for (const t of server?.tasks ?? []) byId.set(t.id, t); // server-only tasks survive verbatim
  for (const t of incoming.tasks) {
    if (!alive(t)) continue;
    const cur = byId.get(t.id);
    if (!cur || !alive(cur) || t.updatedAt >= cur.updatedAt) byId.set(t.id, t);
  }

  const actById = new Map();
  for (const a of [...(server?.activities ?? []), ...incoming.activities]) actById.set(a.id, a);
  const activities = [...actById.values()].sort((a, b) => b.at - a.at).slice(0, MAX_ACTIVITIES);

  const deletions = [...delAt]
    .map(([id, at]) => ({ id, at }))
    .filter((d) => now - d.at < 30 * 24 * 60 * 60 * 1000)
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_DELETIONS);

  return {
    tasks: [...byId.values()]
      .filter(alive)
      .sort((a, b) => a.createdAt - b.createdAt || String(a.id).localeCompare(String(b.id))),
    activities,
    deletions,
  };
}

/** Replace-mode (import snapshot): validated payload becomes the whole board. */
export function replaceBoard(incoming) {
  return {
    tasks: [...incoming.tasks].sort((a, b) => a.createdAt - b.createdAt || String(a.id).localeCompare(String(b.id))),
    activities: [...incoming.activities].sort((a, b) => b.at - a.at).slice(0, MAX_ACTIVITIES),
    deletions: [],
  };
}
