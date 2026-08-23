# TASK-48 — Per-symbol share cards + sitemap/robots

**Status:** shipped · **Agent:** CIPHER · **Date:** 2026-08-23

## Change

**1. `/s/[symbol]` share route (AC1)** — two files:
- `opengraph-image.tsx` (`next/og`, 1200×630 PNG): live price, day-change (green `#7bb662` /
  coral `#ff5032`), and a 90-day close sparkline drawn as an SVG path over the brand ink
  background. Degrades to a clean branded card when the quote chain is down or the symbol is
  unknown (verified: ZZZZZZ → 200 PNG, 30KB fallback).
- `page.tsx`: crawler-facing metadata via `generateMetadata` (live quote in title/description)
  + `redirect("/?s=SYMBOL")` so humans land on the terminal preloaded.

**2. Sitemap + robots (AC2)** — `app/sitemap.ts` emits home, static pages, and one entry per
symbol from the instruments index (**5,953 `/s/` entries**); `app/robots.ts` allows `/`,
disallows `/api/` + `/board`, points at the sitemap.

**3. Per-symbol OG wiring (AC3)** — share URLs carry their own per-symbol card meta at
`/s/[symbol]`; humans hitting that URL are redirected to the terminal with `?s=` preload.
(Interpretation documented: home keeps its static site-wide card; per-symbol sharing goes
through `/s/`, which is what crawlers see either way.)

## Verification (AC4)

curl of rendered HTML on :3000 (rebuilt at HEAD):

```
/s/RELIANCE → og:title "RELIANCE INDUSTRIES LTD (RELIANCE) — NIFTY"
              og:description "₹1,316.00 +0.00%"
              og:image / twitter:image → http://localhost:3000/s/RELIANCE/opengraph-image
GET /s/RELIANCE/opengraph-image → 200 image/png, 59,774B, PNG 1200x630 (file(1))
GET /s/RELIANCE          → 307 → /?s=RELIANCE
GET /sitemap.xml         → urlset with 5,953 symbol entries
GET /robots.txt          → Allow / · Disallow /api/, /board · Sitemap pointer
```

Satori lesson learned: every node with >1 child needs explicit `display:flex` — a bare
`{a} · {b}` text interpolation crashed the renderer; single template strings required.
