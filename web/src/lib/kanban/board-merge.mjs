/**
 * CANONICAL board merge implementation (TASK-24) — single source consumed by
 * POST /api/board (via the typed facade merge.ts) and CLI writers
 * (scripts/board.mjs imports this file directly; stock node cannot load .ts).
 *
 * Ported from TASK-02's original merge.ts. Semantics:
 * - union of task ids; ids on both sides resolve by newest `updatedAt`
 * - persisted deletions[] and "deleted" activity markers hide tasks whose
 *   `updatedAt <= at`; newer edits recreate the task
 * - activities union by id, newest first, capped at MAX_ACTIVITIES
 */

export const MAX_ACTIVITIES = 80;
export const MAX_DELETIONS = 200;
/** TASK-1394: full-board payloads above this are rejected (413 at the route). */
export const MAX_TASKS = 5000;

const COLUMNS = new Set(["backlog", "todo", "doing", "review", "done"]);
const PHASES = new Set(["A", "B", "C", "D", "E"]);
const PRIORITIES = new Set(["P0", "P1", "P2", "P3"]);

/* Canonical persisted fields (types.ts Task). Anything else arriving over
   the wire is junk at best and a prototype-pollution vector at worst —
   `__proto__` arrives as an OWN key from JSON.parse and survives {...spread}. */
const TASK_FIELDS = new Set([
  "id", "title", "desc", "phase", "priority", "status", "assignee",
  "labels", "estimate", "checklist", "createdAt", "updatedAt",
  "rank", "edge", "blocked",
]);
const ACTIVITY_FIELDS = new Set(["id", "taskId", "text", "agent", "at"]);
const TOMBSTONE_FIELDS = new Set(["id", "at"]);

/** Rebuild an object keeping only allowlisted own keys — never spreads, so
    `__proto__`/`constructor` own-keys from hostile JSON cannot survive. */
function pickAllowed(obj, allowed) {
  const out = {};
  for (const k of allowed) {
    if (Object.hasOwn(obj, k)) out[k] = obj[k];
  }
  return out;
}

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
  if (body.tasks.length > MAX_TASKS) return { ok: false, error: "too_many_tasks" };
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
    value: {
      /* TASK-1394: allowlist-rebuild instead of {...spread} — strips unknown
         keys and any __proto__/constructor own-keys from untrusted JSON */
      tasks: body.tasks.map((t) => pickAllowed(t, TASK_FIELDS)),
      activities: activities.map((a) => pickAllowed(a, ACTIVITY_FIELDS)),
      deletions: deletions.map((d) => pickAllowed(d, TOMBSTONE_FIELDS)),
    },
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
export function mergeBoards(server, incoming, now = Date.now()) {
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

  // TASK-27: two writers that minted the SAME id for DIFFERENT tasks (simultaneous
  // creates — both derive "TASK-nn" from their local count) must both survive LWW.
  // Same id + same createdAt = same task lineage (an edit/revision) -> normal LWW.
  // Same id + different createdAt = distinct creations -> the incoming one is
  // re-id'd with a deterministic "-2/-3..." suffix instead of being eaten.
  const takenIds = new Set();
  const refreshTaken = () => {
    takenIds.clear();
    for (const t of byId.values()) takenIds.add(t.id);
  };
  const mangledId = (base) => {
    let n = 2;
    while (true) {
      const candidate = `${base}-${n}`;
      if (!takenIds.has(candidate)) return candidate;
      n += 1;
    }
  };

  for (const t of incoming.tasks) {
    if (!alive(t)) continue;
    const cur = byId.get(t.id);
    if (cur && cur.createdAt !== t.createdAt && alive(cur)) {
      // distinct task colliding on id: place under a fresh suffix
      refreshTaken();
      const renamed = { ...t, id: mangledId(t.id) };
      byId.set(renamed.id, renamed);
      continue;
    }
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
