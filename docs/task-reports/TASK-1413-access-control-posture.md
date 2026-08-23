# TASK-1413 — Access-control posture decision

**Decision: localhost-only bind is the enforced default; token gates protect
destructive operations; public deployment stays blocked until real auth
exists.** Shipped by CIPHER, 2026-08-24.

## Context

The app has no auth layer. Several endpoints are powerful by design:
`POST /api/board` mutates shared team state (gated in TASK-1370),
`/api/alerts/evaluate` runs a write-mode evaluation pass + email delivery
(gate tracked as TASK-1429), and `/board` renders internal planning data.
Serving these on `0.0.0.0` meant anything on the LAN could reach them.

## Decision and enforcement points

1. **Bind**: `web/package.json` start script now runs `next start -H
   127.0.0.1` — the network interface cannot reach the app unless an
   operator deliberately changes it. This is the primary enforcement.
2. **Destructive ops stay gated even on localhost**: board `mode:"replace"`
   requires `BOARD_WRITE_TOKEN`; the evaluate endpoint's CRON_SECRET gate
   lands with TASK-1429.
3. **Proxy deployments**: `TRUST_PROXY=1` switches client-key derivation to
   the rightmost XFF hop (TASK-1465). Without it, forwarding headers are
   treated as attacker-controlled.

## What would change for a public deploy (blocked until done)

- TASK-1413 decision superseded by a real auth layer (session or bearer).
- Evaluate endpoint gate live (TASK-1429) and Resend delivery reviewed.
- Nonce-based CSP replacing `'unsafe-inline'` (TASK-1395).
- Share-link requirements implemented before `/w/` routes ship (TASK-1404).
- Revisit accepted risks 3–5 in `SECURITY.md`.

## Verification

- After this change: `ss -ltnp | grep 3000` shows `127.0.0.1:3000`, not
  `*:3000`.
- External-interface probe returns connection-refused.
