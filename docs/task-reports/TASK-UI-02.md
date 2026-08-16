# TASK-UI-02 — Screener UI integration contract (TASK 22, design head's intent)

**Author**: UI/UX head · 2026-08-16 (session 5, cycle 42)

## Primitives already in `web/src/components/`
All built, verified, and battle-tested this session — use them, don't rebuild:

| Component | Role in screener |
|---|---|
| `DataTable` | The results table. Typed columns, tri-state sort (asc→desc→none), keyboard nav (↑↓/Home/End/Enter), row selection (`aria-selected`), rank column (lime `01` badges), `render` cells, loading/empty states, sticky headers. |
| `Modal` | Strategy picker / details dialog (focus-trapped). |
| `Sparkline` | Score history or per-strategy edge mini-charts. |
| `MarketStatus` / `ErrorBoundary` | Consistent chrome. |

## Signal → DataTable mapping
The strategy `Signal` shape (`web/src/lib/strategies/types.ts`) maps 1:1:
- `rank` → `{ key: "rank", rank: true }` column
- `symbol` → sortable symbol column; `onRowClick` deep-links to the chart
- `score` → right-aligned, `sortValue: r => r.score`, lime `render`
- `components` → tooltip/title on the row, or a "COMPONENTS" render column
- Day change → reuse the `chg` render pattern (up/down colors) from the DataTable demo

## Deep link (already works)
`?s=RELIANCE&e=NSE&r=1y` — `resolveTarget` in `page.tsx` resolves watchlist entries AND
arbitrary symbols via the local instrument index, then loads the chart. Rows can
link with `router.push("/?s=X&e=Y")`.

## Keyboard shortcuts to advertise
`/` search · `1–8` ranges · `J/K` watchlist · `R` retry · `L` log · `?` help · `ESC`.
If the screener adds keys, update the help modal (`page.tsx`) + footer + AGENTS.md.

## Design rules
- Stark terminal: ink/paper/muted/faint tokens only, no gradients/glass/rounded.
- Uppercase mono labels, `tracking-*`, tabular-nums everywhere.
- Every interactive state needs `aria-pressed/selected/current`; focus ring is global.
- Reduced-motion must keep working (global CSS).
- Verify with `npx tsc --noEmit` + `npm run lint` + the 13-check Playwright e2e.
