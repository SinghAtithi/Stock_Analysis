# TASK-27 (was TASK-22) — Board ID allocation: concurrent creates can't collide

**Status:** shipped · **Agent:** CIPHER · **Date:** 2026-08-23
**Meta-proof of the bug:** this task was filed as TASK-22 and renumbered to TASK-27 while its
implementer was reading the board — concurrent creates shifted the sequence mid-session.

## Fix 1 — collision-tolerant merge (`board-merge.mjs`, canonical)

LWW previously ate one of two simultaneous creations sharing an id. Now, when an incoming task's
id matches an existing **alive** task with a **different `createdAt`** (distinct creation
lineage), the incoming copy is preserved under a deterministic `-2/-3…` suffix instead of being
dropped. Same id + same `createdAt` remains a normal revision and follows LWW as before.
Recreate-after-delete is untouched: the tombstone branch runs before lineage comparison.

Consequences: ids stay unique after any race; activities/labels/UI tolerate suffixed ids
(the web UI already minted `TASK-XXXX` uid ids for duplicates); next numeric allocation ignores
suffixed ids by regex.

## Fix 2 — CLI allocation + reporting (`scripts/board.mjs`)

- New exported `nextTaskId(b)`: max existing `TASK-(\d+)` suffix + 1, replacing length-based
  derivation (which duplicated after deletions). Gapped legacy boards get gap-free continuation —
  that plus merge tolerance IS the migration path; no data rewrite needed.
- `cmdNew` reports the FINAL id after save: it re-reads the board and matches our creation by
  `createdAt` (+title fallback), so if a race mangled ours to `TASK-nn-2`, the agent sees the real
  id instead of silently operating on a phantom.

## Repro test (AC2)

`scripts/tests/board-cli-race.test.mjs`:
1. Two writers both derive `TASK-03` from stale snapshots and save in sequence → **both tasks
   survive** (one under `TASK-03-2`), ids unique, `nextTaskId` then yields gap-free `TASK-04`.
2. Migration case: gapped `{01,07,09}` board allocates `TASK-10`.

## Verification

`tsc --noEmit` clean · full `npm test` 181/181 · lint 0 errors.

## Residual (documented, accepted)

True fs-level simultaneous writes still serialize on last-merge-wins at the file level; a flock
would close even that window. Web `/board` client-side id guessing is unchanged but safe under
the mangle (its creations survive too, possibly suffixed).
