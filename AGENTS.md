# AGENTS.md — NIFTY//TERM

Working conventions for any agent (human or AI) operating in this repo.

## Repo map
- `web/` — Next.js 16 (Turbopack) app: `src/app` routes, `src/components`, `src/lib` (data layer), `src/data/instruments.json` (search index, built by `scripts/build-instruments.mjs`).
- `scripts/` — build + data ingest tools. `db/` — SQLite (better-sqlite3) schema/migrations.
- `ROADMAP.md` — 30-task plan (phases A–E). `RANKINGS.md` — 190-strategy jury research (product moat). `LOG.md` — append every session/change (newest at top, `## YYYY-MM-DD` headings). `docs/task-reports/` — per-task reports.
- Multiple agents may edit concurrently. Check `git status` + `git log` before touching shared files (`web/src/lib/marketData.ts` is owned by the data agent).

## Mandatory verification (every task)
1. `cd web && npx tsc --noEmit` — must pass.
2. `npm run lint` — must pass (React 19 compiler rules are strict: no setState-in-effect, no render-phase ref writes, no `aria-sort` on buttons).
3. UI changes: Playwright sanity (dev server on :3000). Reference scripts live in `/tmp/opencode/*.py` (Python playwright) — re-run the 13-check e2e after UI work.

## Design system (do not drift)
- **Identity**: stark institutional terminal. Paper-on-ink, acid-lime up `#c6f534`, red-orange down `#ff5032`. NO glass, NO gradients, NO blue, NO rounded UI. NO emoji (terminal glyphs only).
- **Tokens** (`web/src/app/globals.css`): `ink #0b0b0c`, `panel #131316`, `panel-2 #18181b`, `paper #f4f4f1`, `muted #94948d`, `faint #80807b` (axe-core verified: 0 contrast violations, WCAG AA), `hairline`/`hairline-strong`. `up`/`down` for direction. Don't introduce new colors without a contrast check (see LOG session 5).
- **Type**: JetBrains Mono everywhere; Archivo only for the big symbol title. `tracking-*` for terminal feel. Uppercase labels.
- **Motion**: cubic-bezier(0.22,1,0.36,1); respect `prefers-reduced-motion` (global CSS already handles it); odometer roll, chart reveal sweep, skeleton pulses are the signature moments.
- **Accessibility**: focus-visible lime ring (global), `aria-pressed/selected/current` on interactive state, combobox semantics in Search, sr-only chart summary + live price region, modals (`src/components/Modal.tsx`) trap focus, skip-to-content link.

## Keyboard shortcuts (page-level, `web/src/app/page.tsx` + `ChartPanel`)
`/` search · `1–8` ranges · `J/K` watchlist step · `R` retry · `L` log scale · `?` help · `ESC` close · dblclick/FIT chip re-fit chart. Update the help modal + footer when adding keys.

## Data layer notes
- Chart fallback chain: Yahoo (curl subprocess — Node undici gets TLS-fingerprint-429'd) → Google Finance (intraday) → Moneycontrol → Groww. Circuit-breaker backoff in `web/src/lib/backoff.ts`. Payload carries `source`, `degraded`, `stale` — the UI must surface these (STALE/DAILY chips exist).
- Indices: Yahoo tickers differ (`NIFTY 50`→`^NSEI`, `SENSEX`→`^BSESN` — see `INDEX_MAP`). Indices have no non-Yahoo fallback yet (open issue, `docs/task-reports/TASK-UI-01.md`).
- URL deep links: `?s=&e=&r=` are consumed on load and synced via pushState (StrictMode race fixed — don't replaceState in a mount effect).

## UX primitives (build Phase-D UIs from these)
- `DataTable` — sortable terminal table (tri-state sort asc→desc→none, keyboard nav, rank badges).
- `Sparkline` — dependency-free SVG sparkline (NaN-safe, gradient fill).
- `Modal` — focus-trapped dialog (centered or bottom-sheet).
- `MarketStatus` — IST session indicator. `ErrorBoundary` — crash screen. `Odometer` — rolling price (sr-only text!).

## Testing
- `web/scripts/tests/` — node:test suites for data scripts (`npm test`).
- No in-repo Playwright project yet (Phase E task 29) — use the Python playwright CLI against :3000.
