# ADR 0001 — Deploy-readiness constraints for TASK-28 (serverless-first)

**Status:** accepted · **Date:** 2026-08-23 · **Agent:** CIPHER (TASK-08 spike)
**Context:** ROADMAP TASK-28 targets a Vercel project + GitHub Actions + cron. This ADR fixes
verdicts on the four runtime assumptions the CTO audit flagged, so TASK-28 plans against reality.
Evidence sources: `web/src/lib/marketData.ts` (curl subprocess), route handlers (caches,
fs writes, sqlite), `db/data/app.db`, `docs/deploy.md`, `docs/task-reports/TASK-13*`.

## Verdict 1 — curl subprocess availability: **do not depend on the platform binary**

`fetchYahooChart` shells out (`execFile("curl", …)`, no shell) because Node's undici is
TLS-fingerprint-429'd by Yahoo while curl passes. On Vercel Node functions the platform *image*
happens to ship `curl`, but that is not a contract we control.

- **Decision:** treat platform curl as opportunistic. The chart fallback chain already degrades
  Yahoo→MC→Google→Groww without user-visible failure, so a missing/broken curl costs freshness,
  not uptime. For determinism when Yahoo matters (daily EOD backfill), run ingest where curl is
  guaranteed: **GitHub Actions cron** (`actions/runner` images ship curl) — which TASK-28 already
  needs for CI. If serverless Yahoo ever becomes mandatory, vendor a pinned static curl binary into
  the bundle (~2MB) and exec by absolute path; explicitly out of scope pre-launch.
- **Consequence:** no code change now; TASK-28 wires ingest-eod/signals crons as GH Actions
  schedules first, Vercel cron only if/when moved off Actions.

## Verdict 2 — module-level caches: **keep in-proc; move enforcement to the edge**

Module-scope state today: marketData payload cache + SWR-stale maps, `/api/signals` + `/api/tracker`
60s response LRUs, per-IP sliding-window limiter (TASK-13), board sync cache. Serverless makes all
of these per-lambda-instance: they still cut upstream load (best-effort correctness), but are not
shared and vanish on scale-out/cold start.

- **Decision:** keep every cache as-is. The only piece whose *correctness* depends on shared state
  is rate limiting → enforce at the edge on deploy (Vercel WAF / firewall rules), per the caveat
  already shipped in docs/deploy.md. Shared-KV (e.g., Upstash Redis) stays a non-goal until a real
  cross-instance requirement appears (multi-region or strict quotas); singleflight/dedupe of
  identical upstream fetches is likewise acceptable to lose across instances.
- **Consequence:** TASK-28 adds edge rate-limit config as a launch checklist item; no app code.

## Verdict 3 — board.json fs writes: **exclude NIFTY//BOARD from production**

`POST /api/board` does temp+rename writes to `data/board.json`; serverless filesystems are
read-only except ephemeral `/tmp`, so the write fails on-deploy. It is also the only fs-writing API
route in `web/src/app/api` (verified).

- **Decision:** the board is agent/dev infrastructure, not product. Do **not** port it to KV.
  Gate both surfaces behind an env flag (`NIFTY_BOARD_ENABLED`) — route returns 503, `/board` page
  renders a "local-only tooling" notice when unset — so a prod deploy neither breaks nor pretends to
  work. Implementation lands with TASK-28 (small, isolated); local/dev usage unaffected (flag
  defaults on when the file is writable). Direct CLI use always works locally regardless.
- **Rejected:** Redis/Vercel-KV port (maintenance cost for zero product value);
  /tmp persistence (misleading multi-instance semantics — exactly the lost-update class TASK-02 fixed).

## Verdict 4 — readonly SQLite packaging: **bundle app.db via build-step copy + file tracing**

`/api/signals` opens `db/data/app.db` read-only through better-sqlite3 (single handle/process since
TASK-04). Two packaging risks on Vercel: (a) the native binding must match the build image —
satisfied because Vercel runs `npm install` during build; (b) the DB file sits **outside** `web/`,
which Next file-tracing will not include.

- **Decision:** CI build step copies `db/data/app.db` → `web/db-snap/app.db` before `next build`,
  plus `outputFileTracingIncludes` mapping for `/api/signals`; the route resolves the snapshot path
  with a fallback chain (repo path → bundled path) so dev keeps working unchanged. At today's size
  (**16MB**) bundling is comfortably inside lambda limits; revisit only past ~100MB with table
  slimming (snapshots+quotes only) or a precomputed-JSON artifact from the daily signals cron.
- **Consequence:** one CI step + small next.config/route path change in TASK-28; readonly access
  means no WAL sidecar files need shipping.

## ROADMAP task-28 amendment

TASK-28 text gains: "Per ADR 0001: ingest/alert crons run as GitHub Actions schedules (curl-guaranteed)
before any Vercel cron migration; edge-level rate limiting replaces per-instance buckets at launch;
board API/page gated behind `NIFTY_BOARD_ENABLED` (excluded from prod); CI copies db/data/app.db into
the bundle with outputFileTracingIncludes for /api/signals."

## Verification

Static analysis only (no runtime claims): greps cited above; sizes measured (`du -h`). Gates not
applicable — documentation-only change.
