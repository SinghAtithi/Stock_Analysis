# TASK-02 — Board sync lost-update guard

**Status:** shipped · **Agent:** CIPHER · **Date:** 2026-08-23
**Incident reference:** LOG.md `2026-08-23 — CTO architecture/design review` — during that session,
ghost's browser tab hydrated before the CTO CLI-created TASK-03..09; a single checklist tick sent a
full-state POST to `/api/board` and **wiped all 8 tasks** (last-writer-wins). The same wipe class had
already killed dummy-task boards twice on 08-22 (commits 3a2f4b5, c2d50b4).

## Problem

`POST /api/board` wrote `body.tasks` verbatim over `data/board.json`. Any writer whose state was
stale — slow tab, debounced sync (600ms), CLI racing the UI — erased everything it hadn't seen.
The task's checklist had been ticked green in a prior session but **the fix did not exist**: review
found no merge logic, no 409 path, no repro script (`web/src/app/api/board/route.ts` was still the
naive full-state write; the only TASK-02 report on disk covered unrelated 08-16 work). Checklist
dishonesty is itself an etiquette violation — see AGENTS.md "keep checklist honest".

## Fix — server-side merge, per-task LWW (`web/src/lib/kanban/merge.ts`)

Pure, fs-free module shared by the route and the test suite:

- **Validate** (`validateBoardPayload`) — body must be `{tasks[], activities?, deletions?}` with
  typed tasks (id/title strings, enum status/phase/priority, finite timestamps, well-formed
  checklist). Malformed ⇒ **400** (AC1's validation half).
- **Merge** (`mergeBoards`) — union of task ids; ids on both sides resolve by newest `updatedAt`;
  ids on one side are always kept ⇒ **a stale writer can never erase what it didn't see**.
- **Deletion tombstones** — deletes must survive merge semantics, so `deleteTask` records
  `{id, at}`; tombstones (plus any activity whose text is `"deleted"`, folded in automatically) hide
  tasks with `updatedAt <= at`. An edit newer than the delete recreates the task. Tombstones cap at
  200 and expire after 30 days.
- **Activities** — union by id, newest-first, capped at 80 (CLI entries no longer vanish).
- **Replace mode** — board JSON import posts `mode:"replace"`: snapshot swaps the board instead of
  merging (and clears tombstones), while ordinary sync keeps merge semantics.

### Route (`web/src/app/api/board/route.ts`)
400 on invalid JSON/shapes · reads current file (missing/corrupt ⇒ empty base, logged) · merges or
replaces · writes via **temp+rename** · responds with the merged board so clients can reconcile.

### Writers hardened
- `scripts/board.mjs save()` — temp+rename atomic write (no torn files for readers/other CLIs).
- `web/src/app/board/page.tsx` — carries `deletions[]` through hydration, localStorage and every
  POST; sets `replaceNextRef` on import. No changes to render paths.

## Repro / regression suite (AC3)

`scripts/tests/board-sync.test.mjs` (node:test, runs under `npm test`) — 8 cases:
incident repro (8 unseen tasks + 1 edit survive a stale full-state POST) · newer-server-wins ·
interleaved create+edit zero-lost · tombstone blocks stale resurrection, post-delete edit recreates ·
activity-derived deletes · activity merge/dedupe/cap · validation rejects · replace-mode import.

## Gate note (concurrent-agent coordination)

First gate run went red for ALL suites: a concurrent agent's half-landed `npm test` refactor pointed
`--import ../scripts/tests/helpers/register.mjs` at a nonexistent `ts-loader.mjs`. Completed the
intent with `scripts/tests/helpers/ts-loader.mjs` (module-hooks resolver: extensionless relative
imports → `.ts`), matching the inline hook pattern already used in `backtest.test.mjs`.

## Verification

- `npx tsc --noEmit` — clean.
- `npm run lint` — 0 errors (6 pre-existing `<img>` warnings in `kalyan/page.tsx`, another agent's file).
- `npm test` — 153/153 (incl. the 8 new).
- Residual known risk (out of scope): both web UI and CLI derive `TASK-nn` ids from local task
  counts — simultaneous creation can collide into an LWW overwrite. Server-side id allocation would
  close this; filed here as follow-up material for TASK-04/05 sessions.
