// Lost-update-safe sync for NIFTY//BOARD (TASK-02).
//
// The 2026-08-23 incident (LOG.md): /api/board POST was full-state
// last-writer-wins — a browser tab that hydrated before the CLI created 8 tasks
// ticked one checklist item and wiped all 8. These pure helpers implement the
// fix: validate the incoming payload, then merge it into the on-disk board
// per-task by `updatedAt` (newest wins), union activities, and honor deletion
// tombstones so deletes still propagate without resurrecting.
//
// Merge contract:
// - task ids present only on one side are always kept (no erasure)
// - ids on both sides: copy with the newer `updatedAt` wins
// - a tombstone {id, at} hides tasks with `updatedAt <= at`; edits made after
//   the delete (`updatedAt > at`) recreate the task
// - activities: union by id, newest first, capped at MAX_ACTIVITIES

import type { Task } from "./types";

export interface Activity {
  id: string;
  taskId?: string;
  text: string;
  agent?: string;
  at: number;
}

export interface Tombstone {
  id: string;
  at: number;
}

export interface BoardState {
  tasks?: Task[];
  activities?: Activity[];
  deletions?: Tombstone[];
}

export interface BoardPayload {
  tasks: Task[];
  activities: Activity[];
  deletions: Tombstone[];
}

export const MAX_ACTIVITIES = 80;
export const MAX_DELETIONS = 200;

const COLUMNS = new Set(["backlog", "todo", "doing", "review", "done"]);
const PHASES = new Set(["A", "B", "C", "D", "E"]);
const PRIORITIES = new Set(["P0", "P1", "P2", "P3"]);

type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
function isStr(v: unknown): v is string {
  return typeof v === "string";
}
function isTask(v: unknown): boolean {
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
      (c) => isObj(c) && isStr((c as Record<string, unknown>).id) && isStr((c as Record<string, unknown>).text) && typeof (c as Record<string, unknown>).done === "boolean",
    ) &&
    isNum(v.createdAt) &&
    isNum(v.updatedAt)
  );
}

/** Validate a POST body; returns the normalized payload or an error message. */
export function validateBoardPayload(body: unknown): Validated<BoardPayload> {
  if (!isObj(body)) return { ok: false, error: "body must be a JSON object" };
  if (!Array.isArray(body.tasks)) return { ok: false, error: "tasks must be an array" };
  for (const t of body.tasks) {
    if (!isTask(t)) return { ok: false, error: `malformed task ${isObj(t) && isStr(t.id) ? t.id : "(no id)"}` };
  }
  let activities: Activity[] = [];
  if (body.activities !== undefined) {
    if (!Array.isArray(body.activities)) return { ok: false, error: "activities must be an array" };
    for (const a of body.activities) {
      if (!isObj(a) || !isStr(a.id) || !isStr(a.text) || !isNum(a.at)) {
        return { ok: false, error: "each activity needs string id, string text, number at" };
      }
    }
    activities = body.activities as Activity[];
  }
  let deletions: Tombstone[] = [];
  if (body.deletions !== undefined) {
    if (!Array.isArray(body.deletions)) return { ok: false, error: "deletions must be an array" };
    for (const d of body.deletions) {
      if (!isObj(d) || !isStr(d.id) || !isNum(d.at)) {
        return { ok: false, error: "each deletion needs string id and number at" };
      }
    }
    deletions = body.deletions as Tombstone[];
  }
  return {
    ok: true,
    value: {
      tasks: body.tasks.map((t) => ({ ...(t as Task) })),
      activities,
      deletions,
    },
  };
}

function tombstonesFromActivities(activities: Activity[]): Tombstone[] {
  const out = new Map<string, number>();
  for (const a of activities) {
    if (a.taskId && a.text === "deleted") {
      out.set(a.taskId, Math.max(out.get(a.taskId) ?? 0, a.at));
    }
  }
  return [...out].map(([id, at]) => ({ id, at }));
}

/**
 * Merge an incoming full-state payload into the current server state.
 * Pure — no fs; callers stamp top-level updatedAt. Pass `now` in tests;
 * defaults to Date.now() for the tombstone TTL sweep.
 */
export function mergeBoards(
  server: BoardState | null,
  incoming: BoardPayload,
  now: number = Date.now(),
): Required<BoardState> {
  // tombstones: persisted ones + derived from every activity we have ever seen
  // ("deleted" markers survive activity-feed rolloff once folded in here)
  const delAt = new Map<string, number>();
  const fold = (list: Tombstone[]) => {
    for (const d of list) delAt.set(d.id, Math.max(delAt.get(d.id) ?? 0, d.at));
  };
  fold(tombstonesFromActivities(server?.activities ?? []));
  fold(tombstonesFromActivities(incoming.activities));
  fold(server?.deletions ?? []);
  fold(incoming.deletions);

  const alive = (t: Task) => {
    const at = delAt.get(t.id);
    return at === undefined || t.updatedAt > at;
  };

  const byId = new Map<string, Task>();
  for (const t of server?.tasks ?? []) byId.set(t.id, t); // server-only tasks survive verbatim
  for (const t of incoming.tasks) {
    if (!alive(t)) continue;
    const cur = byId.get(t.id);
    if (!cur || !alive(cur) || t.updatedAt >= cur.updatedAt) byId.set(t.id, t);
  }

  const actById = new Map<string, Activity>();
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
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)),
    activities,
    deletions,
  };
}

/** Replace-mode (import snapshot): validated payload becomes the whole board. */
export function replaceBoard(incoming: BoardPayload): Required<BoardState> {
  return {
    tasks: [...incoming.tasks].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)),
    activities: [...incoming.activities].sort((a, b) => b.at - a.at).slice(0, MAX_ACTIVITIES),
    deletions: [],
  };
}
