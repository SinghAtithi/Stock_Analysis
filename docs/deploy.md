# Deploy notes — security headers & build hygiene

Owner: SABLE (TASK-14) · 2026-08-23. Applies to `web/next.config.ts`.

## Headers shipped

Applied to every route via `next.config.ts → headers()`:

| Header | Value | Why |
|---|---|---|
| `Content-Security-Policy` | see below | Blocks injected third-party script/style; mitigates XSS blast radius |
| `X-Frame-Options` | `DENY` | No framing/clickjacking |
| `X-Content-Type-Options` | `nosniff` | Stops MIME confusion |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Don't leak URLs cross-origin |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` | Force HTTPS once behind TLS (no-op on localhost) |
| `Permissions-Policy` | camera/mic/geolocation/interest-cohort disabled | We use none of them |

## CSP policy and why it's safe here

```
default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';
img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none';
base-uri 'self'; form-action 'self'; frame-ancestors 'none'
```

The client bundle is fully same-origin:
- Fonts: self-hosted at build by `next/font` (Inter + JetBrains Mono) — no Google requests at runtime.
- Images: local only (`/kalyan/*.png`, `/icon.svg`, `/og.svg`).
- Market data hosts (Yahoo, Moneycontrol, Google Finance, Groww) are contacted **server-side** in route handlers — never from the browser.
- `'unsafe-inline'` on script/style is required by Next.js hydration bootstrap and the pre-paint theme script (`layout.tsx`). If inline budget grows, move to nonce-based middleware.

## Rollout path (report-only → enforce)

Shipped **enforced** directly because a Playwright pass (axe + e2e + console-error capture) shows zero violations on `/`, `/screener`, `/breadth`, `/kalyan`, legal pages. When adding new client-side origins (analytics, chart libs), extend `connect-src`/`img-src` deliberately — or flip to `Content-Security-Policy-Report-Only` for one deploy cycle first if the change is risky.

## T21_DISTDIR isolated builds

`T21_DISTDIR=1 next build && T21_DISTDIR=1 next start -p 3001` compiles into `.next-t21/` so agents verify changes against a live server without disturbing whatever serves :3000. Kept deliberately (documented in next.config.ts); zero effect in normal dev/prod.

## Rate-limit caveat (related: TASK-13)

Per-IP limiting in `/api/tracker` is per-instance in-memory — fine for single-node deploys; on serverless/multi-instance, enforce at the edge (Vercel WAF / Cloudflare / nginx `limit_req`) instead of app code.
