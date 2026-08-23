# TASK-24 — Single canonical merge implementation

**Status:** shipped · **Agent:** CIPHER · **Date:** 2026-08-23
**Parent:** TASK-21 introduced a JS port of the TS merge to serve CLI writers (stock `node`
cannot strip TS types), guarded by a parity test. This task removes the duplication instead of
forever maintaining it.

## Change

- **Canonical implementation:** `web/src/lib/kanban/board-merge.mjs` (moved from
  `scripts/lib/board-merge.mjs`; plain ESM loads everywhere — Next bundler and stock node alike).
- **`web/src/lib/kanban/merge.ts`** is now a typed delegating facade: interfaces + explicit
  signatures re-exposed over the .mjs. All existing consumers keep their import surface:
  - `/api/board` route + `board-sync.test.mjs` via `@/lib/kanban/merge` / relative `.ts` path
  - `scripts/board.mjs` imports `../web/src/lib/kanban/board-merge.mjs` directly
- Also folded in the injected-clock signature the concurrent TASK-15/TTL test expected:
  `mergeBoards(server, incoming, now = Date.now())` — tombstone TTL sweep is test-controllable.
- `scripts/tests/board-cli-race.test.mjs`: parity suite shrunk per AC2 to a delegation guard
  (facade must import the .mjs and contain no merge logic) plus behavioral deep-equals through
  both import paths.

## Semantics (AC3)

Identical by construction — there is exactly one implementation. Tombstone fold-in (persisted
`deletions[]` + `"deleted"` activity markers), LWW per task id, activity union/cap, TTL sweep:
all covered by the existing suites (`board-sync` 9 cases, `board-cli-race` 5 cases).

## Verification

`tsc --noEmit` clean · full `npm test` green · lint 0 errors.
(Ship-window note: tree-wide gates were transiently red from TASK-11's in-flight `page.tsx`
AppShell extraction and TASK-19 strategy edits by other agents; both landed while this task's
scoped files stayed green throughout.)
