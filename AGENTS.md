# AGENTS.md — NIFTY//TERM

Working conventions for any agent (human or AI) operating in this repo.

## Repo map
- `web/` — Next.js 16 (Turbopack) app: `src/app` routes, `src/components`, `src/lib` (data layer), `src/data/instruments.json` (search index, built by `scripts/build-instruments.mjs`).
- `scripts/` — build + data ingest tools. `db/` — SQLite (better-sqlite3) schema/migrations.
- `ROADMAP.md` — 30-task plan (phases A–E). `RANKINGS.md` — 190-strategy jury research (product moat). `LOG.md` — append every session/change (newest at top, `## YYYY-MM-DD` headings). `docs/task-reports/` — per-task reports.
- `data/board.json` — Kanban source of truth · `web/src/lib/kanban/` types/agents/data · `web/src/app/board` UI · `web/src/app/api/board` sync · `scripts/board.mjs` CLI.
- Multiple agents may edit concurrently. Check `git status` + `git log` before touching shared files (`web/src/lib/marketData.ts` is owned by the data agent).

## Board — NIFTY//BOARD (Kanban, Jira-like)

Every agent **must** pick a cool callsign before touching code. Open `/board` → top-right **YOU** → choose one of 24: GHOST, VIPER, PHANTOM, NOVA, AXIOM, BLADE, CIPHER, ORION, VECTOR, SPECTRE, NEON, RAVEN, FALCON, WRAITH, KITE, HAWK, SABLE, ECHO, FROST, JET, LYNX, MANTIS, VERTEX, QUARK. Stay consistent in activity + commits.

**Flow (board-first pipeline):** every instruction becomes a task on the board **before** any code changes. `ADD` (`node scripts/board.mjs new --title "..." --check "ac one;ac two"`) → `CLAIM` (`node scripts/workflow.mjs start TASK-ID --agent ghost` — callsign required, WIP-aware) → `WORK` (edit + `node scripts/board.mjs tick TASK-ID <n>` on each AC) → `REVIEW` (`node scripts/workflow.mjs review TASK-ID --agent ghost` — runs gates `npx tsc --noEmit` + `npm run lint` + `npm test`, green ⇒ moves to REVIEW) → `VERIFY` (reviewer re-checks; Playwright sanity when UI changed) → `SHIP` (`node scripts/workflow.mjs ship TASK-ID --msg "feat(scope): ..." --files p1,p2 [--push]` — scoped commit, optional push, flips to DONE). All state lives in `data/board.json` + `localStorage:nifty.board.v1` and syncs via `POST /api/board`. See `docs/BOARD.md` for full CLI + pipeline.

## Mandatory verification (every task)
1. `cd web && npx tsc --noEmit` — must pass.
2. `npm run lint` — must pass (React 19 compiler rules are strict: no setState-in-effect, no render-phase ref writes, no `aria-sort` on buttons).
3. UI changes: Playwright sanity (dev server on :3000). Reference scripts live in `scripts/tests/ui/*.py` (Python playwright) — re-run the 13-check e2e after UI work.

## Design system (do not drift)
- **Identity**: quiet financial paper. Light default (`canvas #fcfcf9`, white panels, ink accent `#111214`) with an opt-in true-dark theme (`html.dark`: canvas `#0a0a0b`, panels `#141518`/`#1c1e21`). Direction colors are calm data, not decoration: light up `#0e7a3a` / down `#c4362b`; dark up `#8ec9a8` / down `#e8a09a`. NO glass, NO gradients, NO blue accent. NO emoji.
- **Tokens** (`web/src/app/globals.css`): semantic CSS vars — `canvas/paper/ink/panel/panel-2/surface/line/line-strong/muted/faint/hairline/hairline-strong/up/up-soft/down/down-soft/accent/accent-soft` + `radius-sm…xl` (6–16px) and soft `shadow-sm/md`. Never hardcode hex in components — consume tokens; don't add colors without a WCAG AA contrast check.
- **Theme switching**: `ThemeToggle` persists `localStorage['nifty-theme']`; inline script in `layout.tsx` applies `.dark` pre-paint (no FOUC). Both themes must keep axe-core at 0 violations.
- **Type**: Inter for display + UI text (`--font-display/--font-sans`), JetBrains Mono with tabular numerals for all prices/%/timestamps. Sentence case labels (the old all-caps terminal style is retired).
- **Motion**: 150–200ms ease-out for state changes; respect `prefers-reduced-motion` (global CSS handles it); odometer roll + chart reveal sweep remain the signature moments.
- **Accessibility**: focus-visible ring (token-driven), `aria-pressed/selected/current` on interactive state, combobox semantics in Search, sr-only chart summary + live price region, modals (`src/components/Modal.tsx`) trap focus, skip-to-content link.

## Keyboard shortcuts (page-level, `web/src/app/page.tsx` + `ChartPanel`)
`/` search · `1–8` ranges · `J/K` watchlist step · `R` retry · `L` log scale · `?` help · `ESC` close · dblclick/FIT chip re-fit chart. Update the help modal + footer when adding keys.

## Data layer notes
- Chart fallback chain: Yahoo (curl subprocess — Node undici gets TLS-fingerprint-429'd) → Moneycontrol intraday (5m/15m/1h, equities) → Google Finance (intraday) → Moneycontrol daily → Groww. Circuit-breaker backoff in `web/src/lib/backoff.ts`. Payload carries `source`, `degraded`, `stale` — the UI must surface these (STALE/DAILY chips exist).
- Indices: Yahoo tickers differ (`NIFTY 50`→`^NSEI`, `SENSEX`→`^BSESN` — see `INDEX_MAP`). Index fallback chain: Yahoo → Google intraday → Moneycontrol index/history (T31).
- URL deep links: `?s=&e=&r=` are consumed on load and synced via pushState (StrictMode race fixed — don't replaceState in a mount effect).

## UX primitives (build Phase-D UIs from these)
- `DataTable` — sortable terminal table (tri-state sort asc→desc→none, keyboard nav, rank badges).
- `Sparkline` — dependency-free SVG sparkline (NaN-safe, gradient fill).
- `Modal` — focus-trapped dialog (centered or bottom-sheet).
- `MarketStatus` — IST session indicator. `ErrorBoundary` — crash screen. `Odometer` — rolling price (sr-only text!).

## Testing
- `web/scripts/tests/` — node:test suites for data scripts (`npm test`).
- No in-repo Playwright project yet (Phase E task 29) — use the Python playwright CLI against :3000.
