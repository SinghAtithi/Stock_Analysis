# NIFTY//BOARD — Agent Mission Control

**Route:** `http://localhost:3000/board` · **State:** `data/board.json` ↔ `localStorage:nifty.board.v1` ↔ `GET|POST /api/board`

A cool-as-Jira Kanban for the 30 ROADMAP tasks. Agents pick a callsign, claim, drag, ship. Humans do too.

## Quick start (human)

1. Open `/board` → top-right **YOU: GHOST** → pick a callsign (24 total: GHOST, VIPER, PHANTOM, NOVA, AXIOM, BLADE, CIPHER, ORION, VECTOR, SPECTRE, NEON, RAVEN, FALCON, WRAITH, KITE, HAWK, SABLE, ECHO, FROST, JET, LYNX, MANTIS, VERTEX, QUARK).
2. Click a card → **Claim** → drag to **IN PROGRESS**.
3. Work → tick checklist → `npm run lint` + `npx tsc --noEmit` must pass → drag to **REVIEW**.
4. Reviewer confirms gates → drag to **DONE**.

## Quick start (agent)

### Via UI
- Same as human. Board persists to `data/board.json` (debounced 600ms) + `localStorage`.

### Via file (headless)
- Edit `data/board.json` directly. Schema in `web/src/lib/kanban/types.ts`:
  ```ts
  Task { id, title, desc, phase:A|B|C|D|E, priority:P0…P3, status:backlog|todo|doing|review|done, assignee:string|null, labels:string[], estimate:number, checklist:{id,text,done}[], createdAt, updatedAt, rank?, edge?, blocked? }
  ```

### Via CLI
```bash
# list (filters share the board's logic)
node scripts/board.mjs list
node scripts/board.mjs list --status doing --phase C
node scripts/board.mjs list --assignee ghost

# claim / assign
node scripts/board.mjs claim TASK-15 --agent ghost
node scripts/board.mjs assign TASK-17 --agent sable

# move columns
node scripts/board.mjs move TASK-15 doing
node scripts/board.mjs move TASK-15 review --agent ghost

# block / unblock
node scripts/board.mjs block TASK-23 --on
node scripts/board.mjs block TASK-23 --off

# tick checklist ACs
node scripts/board.mjs tick TASK-15 2        # check item #2
node scripts/board.mjs tick TASK-15 2 --off  # uncheck

# new task (with acceptance criteria)
node scripts/board.mjs new --title "Wire board to Sentry" --phase E --priority P1 --status todo --agent raven --check "dsn set;error breadcrumbs"

# show activity
node scripts/board.mjs log --limit 20

# pick a cool name from the roster
node scripts/board.mjs agents
node scripts/board.mjs agents --free   # only unassigned-heavy
```

- CLI writes to `data/board.json` and adds an activity entry (agent = callsign or `$USER`).
- UI auto-syncs on next reload (polls `/api/board` on mount, then localStorage).
- **OPS RULE:** `next start` servers cache the bundle — after shipping changes to `/api/board`,
  any route, or any writer, **rebuild + restart** whatever serves :3000 (`npm run build` in `web/`,
  then `next start`). A stale server silently runs pre-fix merge/cache semantics. Verify with a
  live probe: POST an empty full-state payload and confirm task count is unchanged.

### Via pipeline CLI (recommended)
```bash
# ADD — instruction becomes a task BEFORE code changes
node scripts/board.mjs new --title "Add CSV export" --phase D --labels ui --check "button on screener;rows match view"

# CLAIM — pick a callsign, task → IN PROGRESS (warns past WIP 6)
node scripts/workflow.mjs start TASK-33 --agent cipher

# WORK — implement, tick ACs as you verify them
node scripts/board.mjs tick TASK-33 1

# REVIEW — automated gates (tsc → lint → test); green ⇒ REVIEW column
node scripts/workflow.mjs review TASK-33 --agent cipher

# VERIFY — reviewer (another agent or human) re-checks, + Playwright sanity for UI

# SHIP — re-runs gates, scoped commit, optional push, flips to DONE
node scripts/workflow.mjs ship TASK-33 --msg "feat(screener): csv export" \
  --files web/src/app/screener/page.tsx,data/board.json --push
```

Ship rules: status must be REVIEW (`--force` overrides) · `--files` scopes staging (multi-agent safe; `--all` stages everything) · push is opt-in and never forced · the DONE flip is written after the commit so it rides the next task's commit.

## Board design

- **5 columns:** BACKLOG · TODO · IN PROGRESS (WIP 6) · REVIEW (WIP 4) · DONE. WIP bars turn amber→red when exceeded.
- **Cards:** mono ID + priority dot + phase pill (A STABILIZE #0e7a3a · B PLATFORM #2563eb · C ENGINE #7c3aed · D TERMINAL #c2410c · E LAUNCH #0891b2), labels, checklist progress, assignee avatar (initials, color per callsign), estimate, rank badge (jury #).
- **Filters:** search (`/`), phase, priority, assignee, clear. View toggle BOARD | LIST (DataTable).
- **Agent dock:** top horizontal roster with task counts. Click to filter by assignee. Current agent ringed as YOU.
- **Stats:** sprint progress %, WIP/review/blocked counts, phase breakdown (5-way), activity feed (last 80 moves).
- **Detail modal:** edit title/desc/phase/priority/estimate/labels/blocked, status dropdown, assignee + Claim, checklist add/toggle/delete, duplicate/delete, Done.

## Persistence & sync

- **Sources:** `data/board.json` is source of truth for agents + CI. `localStorage` for instant UI. `/api/board` bridges them.
- **On load:** board tries `/api/board` → if `tasks` array exists, use it; else fall back to `localStorage` else `INITIAL_TASKS` (seed from `web/src/lib/kanban/data.ts`, which mirrors `ROADMAP.md`).
- **On edit:** `localStorage` immediate, `/api/board` POST debounced 600ms. No auth yet (anon-first, same as watchlist).
- **Export/import:** header Download/Upload JSON (includes activities). Good for snapshotting before big moves.

## Keyboard

- `/` or `Ctrl+K` focus search
- `N` new task
- `?` help
- `Esc` close
- Drag & drop to move; click card to edit

## Tokens & a11y

- Uses the app's light/dark tokens (`canvas`, `surface`, `paper`, `ink`, `line`, `muted`, `faint`). Focus rings, `aria-pressed` on filters, `role="dialog"` modals with focus trap (via `Modal.tsx`), `aria-live` on stats.

## Where things live

- Types: `web/src/lib/kanban/types.ts`
- Callsigns: `web/src/lib/kanban/agents.ts` (24)
- Seed: none — board starts empty (`web/src/lib/kanban/data.ts` exports `[]` for compile compat)
- Page: `web/src/app/board/page.tsx`
- API: `web/src/app/api/board/route.ts`
- CLI: `scripts/board.mjs` · pipeline: `scripts/workflow.mjs`
- Log: `data/board.json` (git-tracked, not ignored)

## Agent etiquette

- Pick **one** callsign per session, keep it consistent in commit messages (`feat(board): TASK-15 — GHOST moves to review`).
- Run the pipeline: `start` → work+`tick` → `review` → reviewer ACK → `ship`. No code without a task; no DONE without green gates.
- Claim before doing. One task at a time in DOING if possible.
- Keep checklist honest — tick only when verified (`npm run lint`, `npx tsc --noEmit`, Playwright when UI).
- Move to REVIEW only when gates green (`workflow.mjs review` enforces). Move to DONE only via `ship` (or reviewer ACK on /board).
- Leave an activity trail — the feed is the audit log.
