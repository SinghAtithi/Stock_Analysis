# SECURITY.md — NIFTY//TERM

Security posture, threat model, and accepted risks. Maintained by the
security head (callsign CIPHER); findings land on `/board` with the SEC
label cluster (TASK-1370…1478). Last full audit: 2026-08-24.

## Reporting a vulnerability

Use GitHub's **Report a vulnerability** button (Security → Advisories) on
this repository — it is private and notifies maintainers directly. Please
include reproduction steps and affected surface. Do not open a public issue
for an unpatched vulnerability.

## Deployment posture

The product currently runs as a single Node process (`next start`) bound to
**127.0.0.1 by default** (TASK-1447). There is no auth layer yet; anything
reachable from the network interface is effectively public. Before any
public bind or shared-host deployment:

1. Complete the access-control decision (TASK-1413).
2. Set `BOARD_WRITE_TOKEN` (enables board import; see below).
3. If behind a reverse proxy, set `TRUST_PROXY=1` (see Client keys).

## Threat model per surface

| Surface | Untrusted input | Guards |
|---|---|---|
| `POST /api/board` | full-state JSON | rate limit → 1MB body cap (413) → shape validation → `mode:"replace"` requires `x-board-token` matching `BOARD_WRITE_TOKEN` (timing-safe). Payloads are allowlist-rebuilt (`MAX_TASKS=5000`) so `__proto__`/junk keys never persist. TASK-1370/1394. |
| `GET /api/chart`, `/api/analysis` | symbol/exchange/range | symbol charset allowlist + NSE/BSE exchange closed-set before any upstream call (TASK-1371); per-key token bucket (TASK-1403); three cache layers collapse repeats. |
| `GET /api/ticker`, `/api/tracker`, `/api/watchlist-quotes` | symbols lists | token bucket / sliding window + micro-caches; tracker applies its own strict `SYMBOL_RE`. TASK-1403. |
| `GET /api/alerts/evaluate` | none (cron-style) | **CRON_SECRET gate tracked as TASK-1429 — not yet merged.** Until it ships, keep the server off public interfaces. |
| Watchlists / alerts writes | deviceId + entries | deviceId regex `^[a-zA-Z0-9_-]{8,64}$`, entry sanitizer, per-device tier caps. |
| Backtests | config JSON | rate limit + tier cap (3 runs/24h free), strategy/universe allowlists, clamped numerics, single-flight engine lock. |
| Upstream fetches | third-party responses | `execFile` curl (no shell), `-m 20`, `--max-redirs 3`, 8MB buffer, host-scoped concurrency + circuit breaker backoff. TASK-1451. |

## Accepted risks

Each risk is deliberate for now, with a trigger that reopens the question.

1. **`'unsafe-inline'` in script-src CSP** — required by Next.js hydration +
   the pre-paint theme script. Revisit when the client inline budget grows;
   nonce-based middleware is specced in TASK-1395.
2. **In-process limiters and caps** — token buckets, tier counters, and
   caches are per-process memory. Correct for today's single-instance
   deployment; a multi-instance rollout needs a shared store first
   (documented in tiers.ts/upstreamGuards.ts).
3. **Client-minted deviceIds** — any browser can generate unlimited UUIDs,
   so free-tier caps are advisory, not enforced identity. Revisit when
   auth/billing lands (TASK-64 lineage).
4. **Anonymous access to internal board data** — `/board` and its API are
   readable without auth. Acceptable while bound to localhost/LAN for an
   internal team; blocked until gated for anything public (TASK-1413).
5. **Single-proxy TRUST_PROXY assumption** — when `TRUST_PROXY=1`, the
   rightmost XFF hop is trusted as client IP. Valid for exactly one proxy
   layer that appends to X-Forwarded-For; chained proxies need hop-count
   logic first (TASK-1465).

## Hygiene

- Dependency advisories: `npm audit --omit=dev --audit-level=high` blocks CI
  (0 known vulnerabilities at last audit).
- Secrets: gitleaks full-history scan blocks CI; optional local pre-commit at
  `scripts/security/pre-commit-gitleaks.sh`.
- All GitHub Actions pinned to verified commit SHAs; dependabot keeps them
  current (weekly).
