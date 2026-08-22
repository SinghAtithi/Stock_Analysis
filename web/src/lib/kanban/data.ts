import type { Task } from "./types";

// Board starts from scratch — no seed tasks. `data/board.json` (server) is the
// single source of truth; an empty board is authoritative and stays empty.
// Kept as empty exports so existing imports keep compiling.
export const INITIAL_TASKS: Task[] = [];

export const INITIAL_TASKS_BY_ID = Object.fromEntries(INITIAL_TASKS.map((t) => [t.id, t]));
