# NIFTY//TERM — Design System v2 "MIDNIGHT TERMINAL"

> Source of truth for visual design. Approved designs live in Figma first; code follows.
> Status: DRAFT v2.0 · Owner: VERTEX · Task: TASK-31 · Replaces the acid-lime terminal spec (AGENTS.md) and the soft light theme (globals.css pre-v2).

---

## 1. Design principles

1. **Data is the interface.** Chrome recedes, numbers lead. Every pixel of decoration must justify itself against a price, a signal, or a rank.
2. **Dark, not gray.** True near-black canvases with layered panels for depth — depth comes from elevation steps, never from shadows alone or lifted-gray washes.
3. **One accent, two directions.** A single violet accent for interaction. Green/red are reserved exclusively for market direction — they are data, not decoration.
4. **Numbers wear mono.** All tickers, prices, percentages, timestamps render in JetBrains Mono with tabular figures. UI labels/body use Inter. Never mix.
5. **Motion answers intent.** 150–200ms ease-out for state changes; one signature moment per surface (odometer roll, chart reveal sweep). `prefers-reduced-motion` collapses everything to opacity.

---

## 2. Tokens

### 2.1 Color — dark (default, only theme)

| Token | Value | Usage |
|---|---|---|
| `canvas` | `#0A0B0D` | App background |
| `panel` | `#121317` | Cards, rails, sheets |
| `panel-2` | `#17181D` | Elevated: modals, dropdowns, hovers |
| `line` | `rgba(255,255,255,0.07)` | Hairlines, dividers, card borders |
| `line-strong` | `rgba(255,255,255,0.12)` | Active borders, input focus ring base |
| `paper` | `#F2F3F5` | Primary text |
| `muted` | `#9BA1AC` | Secondary text (4.5:1 on panel) |
| `faint` | `#62666F` | Tertiary/meta text (AA on canvas for large/mono only) |
| `accent` | `#8B7CFF` | Interactive: links, selected states, focus rings, CTA fills |
| `accent-dim` | `rgba(139,124,255,0.14)` | Accent wash backgrounds |
| `up` | `#34D399` | Gains, bullish deltas, positive signals |
| `up-wash` | `rgba(52,211,153,0.10)` | Gain row/cell background |
| `down` | `#F97066` | Losses, bearish deltas, drawdowns |
| `down-wash` | `rgba(249,112,102,0.10)` | Loss row/cell background |
| `warn` | `#FBBF24` | Degraded/stale data chips, WIP overflow |

Rules:
- No gradients on surfaces. Glow (`box-shadow: 0 0 0 1px line, 0 0 24px accent-dim`) allowed **only** on focus-visible and the primary CTA.
- No blue anywhere. Violet accent ≠ blue; contrast-checked at 7.1:1 on canvas.
- `warn` is the only yellow; it always means "data quality", never "attention pretty".

### 2.2 Typography

| Role | Face | Size/Line | Notes |
|---|---|---|---|
| Display symbol | Archivo SemiBold | 32/36, tracking -1% | One per view (active ticker) |
| H1 section | Inter Semibold | 18/24, tracking -1% | Uppercase NOT required; sentence case |
| Label / overline | Inter Medium | 11/16, tracking +6%, uppercase, `muted` | Column headers, rail captions |
| Body | Inter Regular | 13/20 | Default UI text |
| Data / numeric | JetBrains Mono Medium | 13/20, tabular-nums | Prices, %, volume, ranks, IDs |
| Data small | JetBrains Mono Regular | 11/16, tabular-nums | Axis ticks, meta |

- Tabular numerals (`font-feature-settings: "tnum"`) mandatory wherever numbers align vertically.
- No font below 11px. Ever.

### 2.3 Spacing & radius

- Scale: 4 · 8 · 12 · 16 · 24 · 32 · 48. Nothing between.
- Density: table cell padding 8px vertical; panel padding 16px; page gutter 24px.
- Radius: `sm 6` (inputs, chips) · `md 10` (cards, panels) · `lg 14` (modals). Pills are 999 except direction chips.

### 2.4 Motion

| Token | Value | Use |
|---|---|---|
| `fast` | 150ms cubic-bezier(0.22,1,0.36,1) | Hover, chip toggles, sort flips |
| `base` | 200ms same curve | Panels, dropdowns, odometer roll |
| `reveal` | 400ms same curve | Chart sweep, board column entry |

Reduced motion: all durations → 1ms; keep opacity fades ≤150ms.

### 2.5 Elevation

Depth = panel layering + 1px hairline. Shadows are whisper-level:
- `e1` (cards): none — hairline only
- `e2` (dropdown/popover): `0 8px 24px rgba(0,0,0,0.5)`
- `e3` (modal): `0 16px 48px rgba(0,0,0,0.6)`

---

## 3. Component inventory (v2 scope)

Build order maps to foundation-first migration:

1. **Primitives:** Chip (state/source/degraded/stale), Button (primary=accent fill / ghost=hairline), Input+Combobox, Toggle, Tooltip, Skeleton (shimmer on panel-2).
2. **Data display:** DataTable v2 (sticky header, mono numerals, up/down wash rows, tri-state sort arrows), Sparkline (1.5px stroke, area wash at 8%), Stat block (label overline + mono value + delta chip).
3. **Composite:** ChartPanel v2 (toolbar hairline-separated, range keys as segmented control), WatchlistRail v2 (row: ticker mono · sparkline · delta), SearchOverlay (command-palette style, e3, accent focus glow), MarketStatusPill.

Accessibility contract unchanged from v1: focus-visible ring = 2px accent + offset 2, aria states on all interactive elements, sr-only summaries for charts/live regions, focus-trapped modals, skip link.

---

## 4. Voice

- Terminal-brief. Labels are nouns ("RANK", "VOL Δ"), never marketing ("Amazing returns!").
- Status chips scream only when broken: `STALE`, `DEGRADED → MC`, else quiet source label.
- Numbers before words: `+2.41%` then "gainers".

## 5. Do / Don't

- DO keep one accent glow per viewport. DON'T glow cards, rows, or logos.
- DON'T introduce color outside this table without a WCAG AA check logged in LOG.md.
- DON'T round past `lg`. DON'T drop shadows heavier than `e3`.
- DON'T set body text in mono; DON'T set prices in Inter.

---

## 6. Figma workflow

- File: **NIFTY//TERM — DS v2 MIDNIGHT** (single file; pages: `00 Foundations`, `01 Components`, `02 Screens`, `03 Archive v1`).
- Styles named 1:1 with tokens above (`canvas`, `accent/up`, `text/muted`, `radius/md`, etc.) so code tokens map mechanically.
- Flow: mock in Figma → user approves frame → implement in `globals.css @theme` + components → Playwright 13-check → LOG.md.
- Tooling: Talk-to-Figma MCP (websocket :3055, channel set per session). Agent builds/edits frames directly; human tweaks freely after.

## 7. Migration plan (code)

1. Replace `@theme` block in `web/src/app/globals.css` with §2 tokens; delete light theme + `html.dark` split (dark-only product).
2. Swap fonts in `layout.tsx` (keep Archivo for display symbol).
3. Migrate primitives in order §3.1 → screens: Home/ChartPanel → WatchlistRail → Board (board adopts tokens automatically via CSS vars).
4. Update AGENTS.md design section to point here; archive old spec text.
