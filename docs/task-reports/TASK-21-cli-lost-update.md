# TASK-21 — CLI writers lost-update: merge-on-save + reload-before-flip

**Status:** shipped · **Agent:** CIPHER · **Date:** 2026-08-23
**Parent:** TASK-02 (`docs/task-reports/TASK-02-board-sync.md`) fixed the `/api/board` POST path;
this task closes the remaining vector — direct CLI file writers.

## Incident evidence (AC3)

Activity trail in `data/board.json`, 2026-08-23 (UTC):

```
08:27:53  SABLE  claimed by SABLE -> doing          (TASK-15)
08:28:10  NOVA   re-started by NOVA                 (TASK-15)
```

During TASK-14's ship window (~08:25–08:26) the CTO's TASK-15 claim + activity were erased by a
`workflow.mjs ship` that held its board snapshot across gates + commit and wrote it back whole.
The same window shows TASK-15 churn (moved `doing → todo → doing`) as writers fought over stale
copies. Root cause: every CLI command did `load() ... save()` with unbounded time between —
40s+ when gates run, minutes for ship.

## Fix 1 — merge-on-save in `board.mjs` (AC1)

`save(data)` no longer writes its argument verbatim. Immediately before the atomic temp+rename it
re-reads the current file and LWW-merges:

- union of task ids; both-sides ids resolve by newest `updatedAt` — a writer's own mutation bumps
  `updatedAt`, so its intent wins unless someone edited the same task even later
- deletion tombstones (`deletions[]` + `"deleted"` activity markers) honored, so CLI saves cannot
  resurrect web-deleted tasks
- activities union by id (newest first, cap 80)

Merge logic lives in `scripts/lib/board-merge.mjs` — a plain-JS port of
`web/src/lib/kanban/merge.ts` (the TS module can't be imported by stock `node scripts/board.mjs`
invocations). Drift between the ports is guarded by a parity test (below). Also added:
`NIFTY_BOARD_FILE` env override for tests/sandboxes.

## Fix 2 — workflow flips mutate fresh state (AC2)

`cmdReview` / `cmdShip` keep their pre-gate snapshot only for fail-fast validation; after gates
(and after commit for ship) they refresh task rows from disk (`b.tasks = load().tasks`) before
applying the flip via exported `flipStatus(b, id, status, activity, agent)`. If the task vanished
mid-run, ship warns instead of dying post-commit.

## Regression suite (AC4)

`scripts/tests/board-cli-race.test.mjs` — 5 cases:

1. gate-window clobber repro: writer A loads; B creates TASK-03 mid-window; C ticks TASK-02;
   A finally saves its stale snapshot + flip -> all three effects coexist
2. tombstoned task not resurrected by a stale CLI save
3. `"deleted"` activity markers fold into tombstones on the CLI path
4. parity: `board-merge.mjs` vs `web/src/lib/kanban/merge.ts` deep-equal on canonical
   merge/replace/validate cases (drift guard)
5. `flipStatus` mutates correctly and reports missing tasks cleanly

## Verification (AC5)

`tsc --noEmit` clean · `npm test` 179/179 green (incl. the 5 new; run after TASK-15's suites
landed). Residual: concurrent `TASK-nn` id allocation can still collide on simultaneous creates —
tracked separately as TASK-22.
