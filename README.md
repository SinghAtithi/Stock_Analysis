# NIFTY//TERM

A stark, keyboard-first terminal for Indian markets (NSE · BSE). Type any stock,
get candles, volume, and key stats — then scan ranked strategy signals, watch
market breadth, and explore the research that powers it.

**Research tool — NOT investment advice.**

## Routes

| Route | What it does |
|---|---|
| `/` | Terminal: chart (1D→MAX, 8 range keys), live tape, watchlist, deep links `?s=&e=&r=` |
| `/screener` | Strategy signal screener (jury-ranked strategies from RANKINGS.md), row → chart |
| `/breadth` | VIX, advance/decline, FII/DII flows, 52W high/low counts |
| `/board` | **NIFTY//BOARD** — Kanban for 30 ROADMAP tasks (pick a callsign, drag, ship) |
| `/disclaimer` `/privacy` `/terms` | Legal |

## Keyboard

`/` search · `1–8` timeframes · `J/K` watchlist · `R` retry · `L` log scale ·
`?` help · `ESC` close · dblclick / `FIT` re-fit.

## Stack

Next.js 16 (Turbopack) · React 19 · Tailwind 4 · lightweight-charts 5 ·
SQLite (better-sqlite3). Data: Yahoo (curl proxy), Google Finance, Moneycontrol,
Groww, NSE — with per-host backoff + stale-while-revalidate.

## Commands

```bash
cd web
npm run dev          # dev server :3000
npx tsc --noEmit     # type gate (must pass)
npm run lint         # lint gate (must pass)
npm test             # data-script tests
node ../scripts/board.mjs list --status doing   # board CLI
node ../scripts/board.mjs claim TASK-15 --agent ghost
node ../scripts/workflow.mjs start TASK-15 --agent ghost   # board-first pipeline: start→review→ship
node ../scripts/ingest-eod.mjs        # EOD candle store
node ../scripts/ingest-breadth.mjs    # breadth series
node ../scripts/run-signals.mjs       # strategy snapshots
node ../scripts/run-backtest.mjs      # backtests (CLI)
```

UI verification: `scripts/tests/ui/` (Playwright, see its README).

## More

- `ROADMAP.md` — 30-task plan (phases A–E)
- `RANKINGS.md` — 190-strategy jury research (product moat)
- `LOG.md` — full session history (source of truth)
- `AGENTS.md` — working conventions for concurrent agents
- `docs/BOARD.md` — Kanban guide (callsigns, CLI, workflow)
- `docs/task-reports/` — per-task reports incl. `TASK-UI-01` (index fallback gap) and `TASK-UI-02` (screener contract)
