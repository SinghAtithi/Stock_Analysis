# UNSLOPIFY.md — NIFTY//TERM UI constitution

> Purpose: keep this product looking **hand-crafted, quiet, and financial** — never
> AI-generated. This file is the human-readable source of truth for visual decisions.
> The machine source of truth for colors is `web/src/app/globals.css` (`@theme` block).
> If the two ever disagree, `globals.css` wins and this file gets a bug-fix commit.
>
> **DESIGN.md v2 "MIDNIGHT TERMINAL" is superseded** (dark-only, violet accent — never shipped).
> Do not resurrect it.
>
> Status: v1.0 · Owner: VIPER · Task: TASK-1511

---

## 0. UI scorecard (2026-09-17, audit of shipped pages)

| Axis | Score | Verdict |
|---|---|---|
| Typography | 2.5 / 3 | Mono numerals + tight tracking are right; Inter-everywhere leaves no display voice |
| Color & depth | 2 / 3 | Quiet-paper identity is real and rare; token drift + glass header leak "generated" |
| Density & rhythm | 1.5 / 2 | Terminal density good; every panel `rounded-2xl p-4 shadow-sm` = template rhythm |
| Micro-interactions | 1 / 2 | Odometer, tape drift, chart sweep are crafted; everything else is default hover |
| **Total** | **7 / 10** | **Good bones, slop at the edges. Fix the queue in §8 and it is 9.5.** |

### 0.1 What is already good — do NOT regress

- `#fcfcf9` paper canvas + ink accent (`#111214`) — reads like a terminal, not a SaaS.
- Calm direction colors: sage `#8ec9a8` / coral `#e8a09a` in dark; AA-checked.
- JetBrains Mono + `tabular-nums` for every price, %, rank, timestamp.
- Odometer roll (`Odometer.tsx`) with sr-only text; 60s tape drift that pauses on hover.
- Real states: degraded/stale chips, empty states with honest copy, retry affordances.
- Three themes (light/dark/contrast) all pass axe-core 0 violations.
- Zero emoji in the product. Keep it that way.

### 0.2 Slop tells found (fixed or queued in §8)

1. **Glass header** — `SiteHeader.tsx:52` `bg-surface/80 backdrop-blur` violates "NO glass". *Fix: solid + hairline.*
2. **AI-gray `#6b7280`** — Tailwind gray-500 hardcoded in `ChartPanel.tsx:186` and `backtest/page.tsx:198`; not a palette value. *Fix: token fallbacks.*
3. **Chart color drift** — backtest equity/benchmark use off-palette grays `#9ba1ac`, `#858b91`, `#9aa0a8`. *Fix: read tokens like `ChartPanel` does.*
4. **Chip pile-up** — `HeroValueProp.tsx` stacks 6 pills (3 inverted + 3 outline) like feature-badge bingo. *Fix: max 3 chips + one meta sentence.*
5. **`rounded-2xl border-line bg-surface shadow-sm` on every container** — correct 3 times, template at 30. *Fix: radius ladder discipline (§5); flat `md` panels, `xl` reserved for modals.*
6. **`✕` text glyphs** as close buttons (`backtest/page.tsx:611`, `AlertCenter.tsx:355,658`) while the rest of the app uses lucide `X`. *Fix: one icon, one size.*
7. **Stale `DESIGN.md`** prescribing violet accent + dark-only — a trap for future agents. *Fix: superseded banner.*
8. **Scrollbar hex** `#d6d3cd/#c2beba/#2a2d32` untokenized. *Accepted exception for now (native pseudo-element), documented in §7.*

Keep this file honest: every audit adds findings, every fix removes them.

---

## 1. Identity in one line

Quiet financial paper: a light, warm, near-white canvas; black ink; one narrow accent (ink itself);
color appears **only** where data demands it. It should feel like a well-set research note,
not a dashboard.

---

## 2. THE PALETTE — single source of truth

All colors live in `web/src/app/globals.css` as semantic tokens. **Never hardcode a hex in a
component.** Consume `var(--color-*)` / Tailwind token classes (`bg-surface`, `text-muted`, …).
This table mirrors the tokens verbatim; update both in the same commit.

| Token | Light | Dark | Contrast | Use |
|---|---|---|---|---|
| `canvas` | `#fcfcf9` | `#0a0a0b` | `#ffffff` | App background |
| `paper` | `#111214` | `#ecebe8` | `#000000` | Primary text, ink |
| `ink` | `#fcfcf9` | `#0a0a0b` | `#ffffff` | Text on inverted fills |
| `panel` | `#ffffff` | `#141518` | `#ffffff` | Cards, rails, sheets |
| `panel-2` | `#f3f2ef` | `#1c1e21` | `#fafafa` | Recessed/alt rows, input wells |
| `surface` | `#ffffff` | `#141518` | `#ffffff` | Panels, modals, popovers |
| `line` | `#ece9e3` | `#25272b` | `#7a7a7a` | Hairline borders, dividers |
| `line-strong` | `#ddd9d1` | `#2f3338` | `#5c5c5c` | Active/emphasis borders |
| `muted` | `#626870` | `#a8adb2` | `#4d4d4d` | Secondary text |
| `faint` | `#696f77` | `#858b91` | `#565656` | Tertiary/meta text |
| `hairline` | `rgb(17 18 20 / .08)` | `rgb(255 255 255 / .07)` | `#949494` | Universal `*` border default |
| `hairline-strong` | `rgb(17 18 20 / .14)` | `rgb(255 255 255 / .11)` | `#707070` | Strong dividers |
| `up` | `#0e7a3a` | `#8ec9a8` | `#0a5c2a` | Gains — data only |
| `up-soft` | `#e6f4ea` | `#13211a` | `#e8f5ec` | Gain wash |
| `down` | `#c4362b` | `#e8a09a` | `#9e1e13` | Losses — data only |
| `down-soft` | `#fdecea` | `#271a1a` | `#fdeeec` | Loss wash |
| `warn` | `#92400e` | `#fbbf24` | `#7f3a0c` | Data quality only (stale/degraded) |
| `warn-soft` | `#fef3c7` | `#2a2415` | `#fef3c7` | Warn wash |
| `accent` | `#111214` | `#ecebe8` | `#000000` | Interactive emphasis (ink itself) |
| `accent-soft` | `#f3f2ef` | `#1c1e21` | `#f4f4f4` | Accent wash |
| `bar` | `#d6d3cd` | `#2a2d32` | `#949494` | Scrollbar thumb (native chrome only) |
| `bar-strong` | `#c2beba` | `#363a41` | `#7a7a7a` | Scrollbar thumb hover |

### Color laws

1. **No blue. No violet. No purple.** `#6b7280` (Tailwind gray-500) is banned.
2. **Up/down/warn are data, not decoration.** Never use them for hover, links, or "success toasts".
3. `warn` means *data quality* — nothing else. If it is not stale/degraded, it is not amber.
4. New color = new token = WCAG AA check (AA ≥ 4.5:1 text, ≥ 3:1 borders) in **all three themes**,
   entry in this table, axe re-run. No exceptions, no "just this once".
5. Chart libraries need JS values: read them with `getComputedStyle(...).getPropertyValue("--color-*")`
   (`ChartPanel.tsx:182` is the reference implementation) and use the table value as fallback only.
6. `color-scheme` + `theme-color` hexes in `layout.tsx` metadata and the `__next_error__` shell
   (`global-error.tsx`) are the **only** legitimate hardcoded copies; they must equal `canvas`.

---

## 3. Typography law

- **Inter** for UI text and headings (`--font-display` / `--font-sans`).
- **JetBrains Mono** for every number the user compares or aligns: price, %, volume, rank, time,
  order id. `tabular-nums` always.
- Sentence case everywhere. The old ALL-CAPS terminal style is retired.
- Scale in use: `text-xs 12 · text-sm 14 · text-base 16 · text-lg 18 · text-xl 20 · text-2xl 24`;
  display numerals via `text-[22px]/[28px]` (headers) and `text-[36px]/[44px]` (price). Nothing below 11px.
- Tracking: `tracking-tight` on headings only; never letter-space body text.
- Weight: 400 body · 500 labels/buttons · 600 headings/prices. No 700+ except the brand mark.

---

## 4. Space & rhythm

- 4px scale: 4 · 8 · 12 · 16 · 24 · 32 · 48. Table cell padding 8px vertical; panel padding 16–24px.
- One page gutter (16px mobile / 24px desktop). Do not mix gutters in the same view.
- **Rhythm rule:** two adjacent containers must not look identical. Vary padding or elevation
  deliberately (e.g. header card `p-5/6`, list card `p-4`, rail `p-3`).

---

## 5. Radius & elevation ladder (anti "rounded-everything")

| Radius | Token | Allowed on |
|---|---|---|
| 6px | `radius-sm` | inputs, small chips, kbd |
| 8px | `radius-md` | cards, panels, tables — **default** |
| 12px | `radius-lg` | larger feature cards, sheets |
| 16px | `radius-xl` | modals and page-level heroes **only** |
| 999px | pill | status chips and count badges **only** |

- A page should not exceed two radii + pills. If everything is `rounded-2xl`, nothing is.
- Elevation: flat by default (`border-line`). `shadow-sm` reserved for floating/overlapping
  elements (popovers, sticky bars, undo chip). `shadow-md` only for modals. **No glass**
  (`backdrop-blur`), no glow, no gradients on surfaces. The ticker-tape edge fade
  (`globals.css .tape-fade`) is the single gradient in the product and is functional.

---

## 6. Motion

- 150–200ms ease-out for state changes; 0.32s `fade-up` for section entry; odometer + chart sweep
  are the signature moments. `prefers-reduced-motion` is globally honored — never bypass it.
- Animate only `opacity` and `transform`, plus `color` for price ticks. No bounce, no spring,
  no "delight" confetti. Motion answers intent — it never performs.

---

## 7. Component etiquette

- **Chips/pills:** max **3** per cluster; primary chips inverted (`bg-paper text-ink`), secondary
  outline (`border-line text-muted`). Never six badges explaining the product — use one sentence.
- **Close buttons:** lucide `X` at 14–16px inside a bordered pill. Never a `✕` text glyph.
- **Interactive state:** every button/chip/toggle carries `aria-pressed` / `aria-selected` /
  `aria-expanded` where a state exists; focus-visible ring comes from the global token rule.
- **Tables:** `DataTable` is the only sortable table. Tri-state sort, keyboard nav, no custom forks.
- **Empty/honest states:** say what is missing, why, and the one action to take. No "Oops!" copy.
- **Loading:** skeleton or `—` placeholders that do not shift layout. No spinners over 400ms.
- **Charts:** token-read colors only (§2 law 5); grid `rgba` at ≤ 6% opacity; no chart titles inside
  the canvas — the surrounding card carries the label.
- **Numbers change → `Odometer` or plain mono.** Never animate a percentage with a count-up tween.

---

## 8. De-slop queue (audit → fix)

| # | Fix | File | Status |
|---|---|---|---|
| 1 | Header: remove `backdrop-blur`, solid surface + hairline | `SiteHeader.tsx` | ✅ 2026-09-17 |
| 2 | Backtest chart reads tokens; drop `#6b7280/#9ba1ac/#858b91/#9aa0a8` | `backtest/page.tsx` | ✅ 2026-09-17 |
| 3 | `ChartPanel` text fallback → `#626870` (token value verbatim) | `ChartPanel.tsx` | ✅ 2026-09-17 |
| 4 | Hermes… hero: 6 chips → 3 chips + one meta sentence | `HeroValueProp.tsx` | ✅ 2026-09-17 |
| 5 | `✕` glyph → lucide `X` | `backtest/page.tsx`, `AlertCenter.tsx` | ✅ 2026-09-17 |
| 6 | Superseded banner on stale `DESIGN.md` | `DESIGN.md` | ✅ 2026-09-17 |
| 7 | Tokenize scrollbar thumbs (`--color-bar` / `--color-bar-strong`, all 3 themes) | `globals.css` | ✅ 2026-09-17 |
| 8 | Display face decision: keep Inter vs add a display companion for H1/prices | repo-wide | queued (founder call) |
| 9 | Radius sweep: audit every `rounded-2xl` → §5 ladder | repo-wide | queued |
| 10 | `text-[11px]` micro-chips → unify to `text-xs` where space allows | repo-wide | queued |
| 11 | Skeleton pulse softened product-wide: `@keyframes pulse` floor 0.62, 2.6s (`animate-pulse` override) | `globals.css` | ✅ 2026-09-17 |

---

## 9. Reviewer checklist (paste into every UI PR)

- [ ] No new hex outside `globals.css` (metadata exception noted in §2 law 6)
- [ ] Palette additions: AA-checked in light + dark + contrast, added to §2 table
- [ ] No glass / gradient / glow / blue / violet / emoji
- [ ] Radius and shadow from the §5 ladder; no third page-level radius
- [ ] Chips ≤ 3 per cluster; sentence case copy
- [ ] Numbers in mono + `tabular-nums`; odometer for live price
- [ ] `prefers-reduced-motion` respected; no animation > 400ms
- [ ] axe-core: 0 violations in all three themes (Playwright sanity on :3000)
