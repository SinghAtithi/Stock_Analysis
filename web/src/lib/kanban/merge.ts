// Typed facade over the canonical JS implementation (board-merge.mjs).
// TASK-24: one merge implementation is consumed by POST /api/board (here, via
// @/lib/kanban/merge) and by CLI writers (scripts/board.mjs imports the .mjs
// directly — stock node cannot strip TS types). Types live only in this file.
//
// Merge contract:
// - task ids present only on one side are always kept (no erasure)
// - ids on both sides: copy with the newer `updatedAt` wins
// - a tombstone {id, at} hides tasks with `updatedAt <= at`; edits made after
//   the delete (`updatedAt > at`) recreate the task
// - activities: union by id, newest first, capped at MAX_ACTIVITIES

import {
  validateBoardPayload as validateBoardPayloadJs,
  mergeBoards as mergeBoardsJs,
  replaceBoard as replaceBoardJs,
  MAX_ACTIVITIES as MAX_ACTIVITIES_JS,
  MAX_DELETIONS as MAX_DELETIONS_JS,
  MAX_TASKS as MAX_TASKS_JS,
} from "./board-merge.mjs";

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

type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

export const MAX_ACTIVITIES: number = MAX_ACTIVITIES_JS;
export const MAX_DELETIONS: number = MAX_DELETIONS_JS;
export const MAX_TASKS: number = MAX_TASKS_JS;

/** Validate a POST body; returns the normalized payload or an error message. */
export function validateBoardPayload(body: unknown): Validated<BoardPayload> {
  return validateBoardPayloadJs(body) as Validated<BoardPayload>;
}

/**
 * Merge an incoming full-state payload into the current server state.
 * Pure fs-free function; `now` is injectable for tombstone-TTL tests.
 */
export function mergeBoards(
  server: BoardState | null,
  incoming: BoardPayload,
  now: number = Date.now()
): Required<BoardState> {
  return mergeBoardsJs(server, incoming, now) as Required<BoardState>;
}

/** Replace-mode (import snapshot): validated payload becomes the whole board. */
export function replaceBoard(incoming: BoardPayload): Required<BoardState> {
  return replaceBoardJs(incoming) as Required<BoardState>;
}
