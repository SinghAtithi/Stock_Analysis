# TASK-04 — API hardening: signals cache, chart cache headers, SQLite handle reuse

**Status:** shipped · **Agent:** CIPHER · **Date:** 2026-08-23
**Origin:** LOG.md `2026-08-23 — CTO architecture/design review` finding TASK-04:
"signals cache unbounded keyed by raw query string; chart route sends no Cache-Control; signals
route opens 2 SQLite handles per request."

## Changes (`web/src/app/api/signals/route.ts`)

1. **Bounded LRU cache (AC1)** — the response `Map` had no size cap and was keyed by raw
   `url.search`, so every param permutation lived forever. Now: canonical key from normalized
   params `(strategy, limit, offset, sector, sort, order)` — `?a=1&b=2` and `?b=2&a=1` share one
   entry — with `MAX_CACHE_KEYS = 100`, Map insertion-order + re-set-on-touch eviction.
2. **Single SQLite handle per process (AC3)** — `readSnapshots`/`readQuotes` each did
   `openReadOnly()` + `close()` per call (2 opens/request). Now a module-level lazy singleton;
   an open failure is logged and **not cached** so the next request retries; DB-unavailable
   degrades to empty rows (200 with nulls) instead of a 500.

## Changes (`web/src/app/api/chart/route.ts`)

**Cache-Control on success only (AC2):**
`Cache-Control: public, s-maxage=60, stale-while-revalidate=300`. Error paths (400 invalid symbol/
range, 404 not_found/index_unavailable) stay header-free so CDNs never pin failures.

## curl -i evidence (AC4)

Fresh `next dev` on :3100 serving the working tree (:3000 runs an older prod build):

```
$ curl -si "localhost:3100/api/chart?symbol=RELIANCE&range=1y&interval=1d"
HTTP/1.1 200 OK
cache-control: public, s-maxage=60, stale-while-revalidate=300

$ curl -si "localhost:3100/api/chart?symbol=RELIANCE&range=1mo&interval=1d"   # invalid combo
HTTP/1.1 400 Bad Request            # no cache-control — errors uncacheable

$ curl -si "localhost:3100/api/signals?strategy=demo-roc20&limit=3"
HTTP/1.1 200 OK
cache-control: public, s-maxage=60, stale-while-revalidate=120

$ curl -s -o /dev/null -w %{http_code} ".../api/signals?strategy=demo-roc20&limit=5"      # 200
$ curl -s -o /dev/null -w %{http_code} ".../api/signals?limit=5&strategy=demo-roc20"      # 200 — same canonical key
```

(Security headers visible on signals responses are separate pre-existing config, landed by another
agent mid-session.)

## Verification

- `npx tsc --noEmit` clean · `npm run lint` 0 errors · `npm test` green (tree-wide gates).
- Note for reviewers: strategy ids in the registry are registry-defined (`S100`, `demo-roc20`, …);
  snapshot coverage currently exists for the two demo strategies only.
