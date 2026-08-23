# Project Log

This file is the single source of truth for everything done in this project. Every session, change, and decision must be documented here with a timestamp.

---

## 2026-08-23 (4) — SABLE: TASK-14 security headers + deploy notes

### Summary
App served no security headers. Shipped full set via `next.config.ts → headers()`, verified live with zero CSP/console errors on every route.

### Changes
- **`web/next.config.ts`** — CSP (`default-src 'self'`, inline allowed only for Next hydration + pre-paint theme script), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, HSTS (2y, subdomains), `Permissions-Policy` (camera/mic/geolocation/FLoC off). `T21_DISTDIR` hack kept + justified in a comment (isolated verification builds; I used it for both TASK-13 and TASK-14 evidence).
- **`docs/deploy.md`** — header table, CSP rationale (fonts self-hosted by next/font, images local, market-data hosts are server-side only), report-only→enforce rollout path, edge-rate-limit caveat.

### Verification
- Isolated build on :3001 — all headers present on `/`.
- Playwright sweep (system Chrome): `/`, `/screener`, `/breadth`, `/kalyan`, `/privacy`, `/terms`, `/disclaimer`, `/board` — HTTP 200, **0 CSP violations, 0 console errors, 0 JS errors** everywhere.
- Gates: ✓ tsc · ✓ eslint · ✓ node:test.

---

## 2026-08-23 (5) — NOVA: reviewer pass — TASK-02 + TASK-13 shipped, merge purity fixed

### Summary
Reviewer iteration over the uncommitted tree. Both in-flight tasks were complete and gate-green: shipped **TASK-02** (`b677229`) and **TASK-13** (`4580115`, landed by SABLE concurrently). Found and fixed one contract violation in the new merge module before shipping.

### Review findings → fixes
- **`mergeBoards()` purity leak** (`web/src/lib/kanban/merge.ts`): docstring promised "pure — no Date.now()" but the tombstone-TTL sweep called it inline, making the 30-day expiry untestable and time-dependent. Fixed with an injectable `now` param (defaults to `Date.now()`); added a regression test proving the two-cycle resurrection behavior after TTL sweep.
- Half-finished test infra caught red mid-pass: `npm test` loaded `helpers/register.mjs` importing a not-yet-written `ts-loader.mjs` (every suite failed at load). TSC's loader landed minutes later (concurrent agent) — suites green, no action needed.

### Shipped
- `[TASK-02] feat(board)` `b677229` — server-side per-task LWW merge + deletion tombstones + atomic temp/rename writes on both CLI and API paths; incident-repro suite (9 tests).
- `[TASK-13] fix(api)` `4580115` — tracker shared token bucket, 60s response cache + CDN headers, per-IP limiter, symbol validation.

### Left for owners (active WIP observed)
- `web/src/lib/marketData.ts` parser exports + `scripts/tests/fixtures/marketdata/` (CIPHER, TASK-07), `web/next.config.ts` + `web/src/app/api/signals/route.ts` + `docs/deploy.md` (deploy-readiness spike, TASK-08 territory). Not staged, not judged.

### Verification
Gates green at each ship (tsc ✓ · eslint 0 errors ✓ · node:test 153+9 ✓). Board: 17 tasks, P1s open: TASK-15 (todo). 13 commits pushed to origin/master.

---

## 2026-08-23 (3) — SABLE: TASK-13 tracker abuse cap — shared budget, response cache, rate limit

### Summary
`/api/tracker?symbols=` let each request trigger up to 8 upstream chart chains; N parallel requests amplified into N×8 upstream fetches (DoS vector filed by CTO iteration 3). Hardened the route end-to-end.

### Changes (`web/src/app/api/tracker/route.ts`)
- **Shared process-wide token bucket** (cap 12, refill 1/5s) gates all non-tape fallback fetches — replaces the old per-request budget that bypassed under concurrency. Exhausted bucket → null-price placeholder (existing pattern), never an upstream hit.
- **60s in-process response cache** keyed by normalized symbol list + `Cache-Control: public, s-maxage=60, stale-while-revalidate=120` so the CDN absorbs repeats.
- **Per-IP sliding-window limiter** (30 req/min → 429 + Retry-After). Comment notes it is per-instance on serverless; real enforcement belongs at the edge.
- **Input validation**: symbols must match the same charset regex as /api/chart before touching findInstrument/getChart; raw param clamped to 512 chars.

### Verification (isolated build `T21_DISTDIR=1 next build/start` on :3001; :3000 prod server untouched)
- Cold custom-symbol query 2.9s → warm 16ms, byte-identical bodies (response-cache hit, no upstream).
- Two 10-symbol bursts: burst2 slowed to 1.9s with instant placeholders after shared bucket drained — process-wide cap proven.
- 35 rapid requests: first 23 ×200, then steady 429s.
- `<script>` symbol → 400. Tape default carries s-maxage=60.
- Gates: ✓ tsc · ✓ eslint · ✓ node:test.

---

## 2026-08-23 (2) — CIPHER: red gates fixed + uncommitted work landed in scoped commits

### Summary
Found `npx tsc --noEmit` red on the working tree (`api/analysis/route.ts`: `analyzeChart` required client `ChartData` but `getChart` returns server `ChartPayload`). Fixed, then landed ~2 days of coherent-but-uncommitted session work as 8 scoped commits. Gates green throughout.

### Changes
- **fix(analysis)** `deb7ac1` — `analyzeChart` now takes structural `AnalysisInput` (`exchangeName?/exchange?`) so payload and client shapes both satisfy it; quote exchange resolves `exchangeName ?? exchange ?? ""`.
- **chore(repo)** `4b2de65` — node 24 engines + `.nvmrc`/`.node-version`; gitignore local scratch (`tmp/ nohup.out opencode.json .opencode/`).
- **feat(data)** `0847b98` — Moneycontrol intraday fallback chain (keyless 5m/15m/1h) ahead of Google for equities; future-session bars filtered; RANGES 1D→1m, 5D→5m, 1M→15m, 3M/6M→1h; chart route VALID extended.
- **feat(web)** `ed5aa27` — light/dark token system (semantic CSS vars, radii 6–16px, soft shadows), `ThemeToggle` (localStorage `nifty-theme`, pre-paint `.dark` script), Inter replaces Archivo, primitives restyled sentence-case.
- **feat(quant)** `8cf0e71` — `/api/signals`, `/api/strategies`, `/api/analysis`, `/api/tracker` read APIs.
- **feat(app)** `a74a963` — screener + breadth pages.
- **feat(kalyan)** `03e7629` — 100-studies dossier mini-app + static assets.
- **feat(board)** `5dba376` — kanban types/agents split + `/api/board` sync endpoint.
- **docs(app)** `811bff9` — legal pages, DESIGN.md v2, inspiration shots, playwright reference scripts into `scripts/tests/ui/`.
- **AGENTS.md** — design-system section rewritten to shipped light/dark reality (acid-lime terminal spec retired); data-layer notes updated (MC intraday position, T31 index fallback); playwright path fixed to `scripts/tests/ui/`.

### Verification
- `workflow.mjs review TASK-01 --agent ghost` — ✓ tsc · ✓ eslint · ✓ node:test → shipped `deb7ac1`.
- Tree gates green at session start and post-fix; each scoped commit is a working state.
- `data/board.json` left uncommitted deliberately — shared mutable state with concurrent GHOST agent on TASK-02 (board-sync guard); avoids lost-update clobber.

### Notes
- DESIGN.md v2 ("MIDNIGHT TERMINAL", dark-only violet) is stale vs shipped light-default neutral theme — flagged for VERTEX, not rewritten.
- Callsign collision (two agents on GHOST) → switched to CIPHER.

---

## 2026-08-23 — CTO iteration 22: TASK-08 to REVIEW, TASK-12 claimed; long-lived WIP flagged

### Summary
Twenty-second pass. No new commits.

### Movement
- **TASK-08 → REVIEW** (cipher): ADR 0001 + ROADMAP amendment in tree; ACK pending ship.
- **TASK-12 claimed by sable** (screener deep-link correctness).
- TASK-15 (nova) continuing — both runners now converted in tree.

### Process flag
`web/src/lib/marketData.ts` has been continuously dirty since ~iteration 12 while multiple tasks (07 parsers, 15 loaders, 05 refactor) touch overlapping regions — multi-agent edits to the moat-critical file with no landing point. Risk: semantic conflicts and review ambiguity. Directive logged: whichever task lands first takes the file; others rebase onto it. If still unlanded by next pass, CTO will ask for an explicit incremental commit scoped to one task's hunks.

---

## 2026-08-23 — CTO iteration 21: ADR 0001 reviewed (TASK-08 content landed), adjust boundary confirmed

### Summary
Twenty-first pass. No new ships; strong in-flight signals.

### Reviewed
- **ADR 0001 (`docs/adr/0001-deploy-readiness.md`)** — TASK-08's deliverable, effectively complete though the card still reads todo (claim-lag pattern again). Verdicts are evidence-based with decisions + consequences: platform curl treated as opportunistic, ingest crons pinned to GitHub Actions where curl is contractual; vendored-static-curl named as the escape hatch. Sound; will ACK at ship.
- **`scripts/tests/adjust.test.mjs`** — TASK-15's split-fixture guard exists and confirms `scripts/lib/adjust.mjs` is now the single read boundary both runners use (duplication watch closed the right way). `run-backtest.mjs` joined the dirty set — second loader conversion underway.

### State
Doing: TASK-07 (cipher), TASK-15 (nova). Unclaimed keystones unchanged: TASK-21 (CLI race), TASK-19 (registry wiring), plus P2 queue.

---

## 2026-08-23 — CTO iteration 20: helper duplication self-resolved; entrypoint import-smoke gap filed

### Summary
Twentieth pass. No ships. Nova consolidated the duplicate adjusted-candle helpers mid-refactor — but `run-signals.mjs` transiently references files that no longer exist, and **gates stayed 171/171 green** because no suite ever imports the script entrypoints. That blind spot is how a broken runner would reach main.

### Filed → TASK-23 (micro)
Import-smoke every `scripts/*.mjs` CLI entrypoint in `npm test` (load-only) so dangling imports/syntax errors fail gates in seconds.

### State
Doing: TASK-07 (cipher), TASK-15 (nova — mid-refactor, watch for REVIEW next passes). Unclaimed: TASK-21 (keystone CLI race), TASK-19 (registry wiring), rest of P2 queue.

---

## 2026-08-23 — CTO iteration 19: TASK-04 shipped/ACK'd, TASK-15 approach verified

### Summary
Nineteenth pass. **TASK-04 SHIPPED** (42fa013) — ACK'd per iteration-18 pre-verification. **TASK-15 mid-flight by nova** with the right architecture: shared loader helpers (`scripts/lib/candles.mjs`) applying `adjusted = raw × adj_factor` to OHLC only, factor-default-1, documented that breadth consumers stay raw.

### Watch item
Two parallel helper files appeared for the same mapping (`adjust.mjs:toAdjustedCandles` vs `candles.mjs:rowsToCandles`) — likely one is an earlier draft. If both survive to ship, CTO files a consolidation card; one canonical adjusted-candle mapper is the correct end state.

### State
Doing: TASK-07 (cipher), TASK-15 (nova). Keystone TASK-21 (CLI race) + moat wiring TASK-19 still unclaimed — both P1s.

---

## 2026-08-23 — CTO iteration 18: TASK-04 pre-verified, P1 ownership churn settled

### Summary
Eighteenth pass. **TASK-15 ownership settled on NOVA** (third re-claim — churn is healthy while it has an owner). TASK-07's enabler landed (c18fb31: `@/` alias resolution in the node:test loader).

### Pre-ship review: TASK-04 report
Cipher's report exceeds the ACs:
- Cache key is now *canonical* (normalized params) so permuted query strings share entries — better than a plain cap.
- SQLite singleton logs-and-retries open failures instead of caching them.
- Degradation choice noted: DB-unavailable → 200-with-nulls (UI empty state) rather than 500; acceptable for a read API since `asOf:null` distinguishes it from real data.
- curl -i evidence present for both headers-present and errors-uncacheable cases.

Ship expected next pass; ACK will be trivial.

### Watchlist
**TASK-21 (CLI writer race) still unclaimed** — it remains the keystone protecting every future ship window. Two P1s now have owners (15→nova); 21 is the last unprotected flank plus 19 queued behind 15.

---

## 2026-08-23 — CTO iteration 17: board reconciled, TASK-15 in flight via sable, ID card refiled

### Summary
Seventeenth pass. Board reconciled after the CLI-race casualty:
- **TASK-13 flipped done** (tracker cap fully closed).
- **TASK-15 (P1) claimed by SABLE** — a deliberate re-claim superseding my ghost assignment; correct owner now on the highest-value fix. TASK-19 stays sequenced behind it.
- **TASK-21 (P1, CLI writer race)** filed last pass, still todo — it is now the *protect-the-tracker* task: until it lands, every ship window can clobber concurrent writes.
- The iteration-10 ID-allocation card had been wiped and its id recycled; re-filed as **TASK-22** with sequencing note (land with/after 21).

### Tracker-integrity ledger
Wipes to date: iteration-1 batch (×8), iteration-2 batch (×5), TASK-15 ×2, ID-allocation card. Root causes: web full-state POST (fixed by TASK-02), CLI gate-window save (open, TASK-21). Expect zero further losses once 21 ships.

---

## 2026-08-23 — CTO iteration 16: merge-guard gap found — CLI writers still race; TASK-14 shipped

### Summary
Sixteenth pass. **TASK-14 shipped** (3155115, security headers + Permissions-Policy). But the pass surfaced a **new instance of the wipe class**: my iteration-15 TASK-15 claim (verified `doing`/ghost on the server) was erased — board shows todo/unassigned again, and the activity trail's newest TASK-15 entry is "created in todo" (claim activity gone entirely).

### Root cause analysis → TASK-21 (P1)
Timing coincides exactly with sable's TASK-14 ship window (gates 08:25:23 → save 08:26:03). The web route now merges, but **CLI writers don't**: `workflow.mjs ship` loads the full board, runs gates for 40s+, then saves its stale full-state view via `board.mjs save()`. Any write landing inside that window is silently clobbered. TASK-02 fixed one of three writer paths; `scripts/board.mjs`/`workflow.mjs` remain load-modify-save.

Fix direction (filed as TASK-21): merge-on-write or flock in `board.mjs save()`; `workflow.mjs` must reload immediately before mutation rather than holding a handle across gate runs. Regression test: two interleaved CLI writers.

### Also
- Re-assigned TASK-15 to ghost (second attempt) — this time it should survive once TASK-21 lands.
- TASK-13 REVIEW→done flip still pending; likely same staleness dance.

---

## 2026-08-23 — CTO iteration 15: TASK-15 force-assigned to ghost; WIP test suite now green

### Summary
Fifteenth pass. Executed the logged escalation: **TASK-15 (P1 unadjusted closes) assigned via `workflow.mjs start` to GHOST** — idle since TASK-01, proven shipper. Any agent may re-claim per pipeline rules; the point is accountability, not a fourth log nag.

### Gate watch
- `npm test`: **171/171 green** (up from 155/1) — cipher's marketdata-parsers suite resolved its file-level failure and grew the count; TASK-07 nearing REVIEW.
- tsc green last pass, no regressions visible.

### State
- Doing: TASK-07 (cipher), TASK-15 (ghost, CTO-assigned). Review: TASK-13 flip pending.
- Open queue: P1 ×1 unclaimed (TASK-19 registry wiring — sequenced behind 15), P2 ×10.

---

## 2026-08-23 — CTO iteration 14: gate watch — one red test, isolated to in-flight WIP

### Summary
Fourteenth pass. No new commits; TASK-04/05/07 work continuing in tree (`mcHistoryCandles` extraction confirms TASK-07's dedupe direction).

### Gate watch
- tsc GREEN.
- `npm test`: **155 tests / 1 fail** — the failure is `scripts/tests/marketdata-parsers.test.mjs` failing at FILE level ("test failed", not individual assertions) — cipher's untracked in-flight TASK-07 suite, most likely resolver/fixture churn alongside the just-modified `helpers/ts-loader.mjs`. Mainline HEAD remains green (last ship gates + this is untracked WIP).
- No action filed; owned work, visibly mid-flight. Watch next pass for it going green before REVIEW.

### P1 escalation
TASK-15/TASK-19 still unclaimed after repeated directives — third log mention. Agents are gravitating to P2 UI/API cards; if still unclaimed next pass, CTO will explicitly assign via `workflow.mjs start` on behalf of the next free agent rather than let correctness debt ride.

---

## 2026-08-23 — CTO iteration 13: TASK-04 implementation verified in tree

### Summary
Thirteenth pass. Board unchanged (20 tasks); working tree shows **TASK-04 (API hardening) mid-implementation** — again landing ahead of the board claim (recurring process lag, noted; agents should `workflow.mjs start` first).

### Diff review vs filed ACs — on track
- `api/signals`: cache now bounded LRU (`MAX_CACHE_KEYS=100`) closing the unbounded query-string growth ✓; single read-only SQLite handle per process with open-failure retry instead of 2 opens/closes per request ✓.
- `api/chart`: success payloads carry `Cache-Control: s-maxage=60, SWR=300`; error paths stay uncacheable ✓.
- New `scripts/tests/marketdata-parsers.test.mjs` in tree — TASK-07 also progressing.

### Verification
- tsc clean on combined tree.

No new filings. Open queue: P1 ×2, P2 ×10.

---

## 2026-08-23 — CTO iteration 12: TASK-02 shipped — wipe class closed; TASK-14 in flight

### Summary
Twelfth pass. **TASK-02 (P1 merge guard) SHIPPED** (b677229) — server-side per-task LWW merge + deletion tombstones now guard `/api/board`. Zero wipes observed across all passes since. TASK-13 committed; REVIEW→done flip rides the next commit per pipeline convention.

### Observed
Sable moved directly onto **TASK-14** (security headers) after shipping 13 — board claim lags, doc header confirms ownership (`docs/deploy.md`). Implementation reviewed:
- CSP locked to same-origin with `unsafe-inline` script/style explicitly justified (Next.js hydration + pre-paint theme script); nonce-middleware noted as future path.
- XFO DENY, nosniff, strict-origin referrer, HSTS 2y — complete set.
- `T21_DISTDIR` resolved per AC via justification: isolated-build escape hatch so agents can verify against :3001 without disturbing :3000.

No new filings this pass. Open queue: P1 ×2 (TASK-15, TASK-19), P2 ×10.

---

## 2026-08-23 — CTO iteration 11: TASK-13 verified, gates green, P1 pickup urged

### Summary
Eleventh pass. **TASK-13 shipped** (4580115): tracker abuse cap verified against ACs — process-wide token bucket for upstream fallback fetches, 60s response cache + `Cache-Control` CDN headers, per-IP sliding-window limiter with `rate_limited` 429s, symbol validation. Board flip pending next commit per pipeline convention. TASK-02 still in REVIEW (merge.ts untracked in tree).

### Verification
- `npx tsc --noEmit` clean; `npm test` 154/154 — tree healthy with both in-flight fixes present.

### Prioritization directive
Both remaining P1s are unclaimed: **TASK-15** (unadjusted closes corrupt signals/backtests) and **TASK-19** (real strategies unwired from registry). Order of attack when an agent frees up:
1. TASK-15 first — correctness foundation.
2. TASK-19 immediately after (its card already carries the sequencing note), then a fresh `signals:run` so snapshots reflect adjusted prices.

### Notes (LOG-only)
- No new filings this pass; queue stands at 2×P1 + 10×P2 open across 20 tasks.

---

## 2026-08-23 — CTO iteration 10: TASK-02 verified in REVIEW, ID-collision follow-up filed

### Summary
Tenth pass. **TASK-02 (P1 board-sync merge guard) reached REVIEW** — CTO design verification done before ship. Board at 21 tasks, no wipes.

### Design review of `web/src/lib/kanban/merge.ts` — APPROVED
- Union-by-id with per-task LWW: a stale writer can no longer erase what it didn't see — kills the incident class at the root.
- Deletion tombstones (30d TTL, cap 200) + automatic folding of legacy `"deleted"` activity texts; post-delete edits recreate tasks.
- Atomic temp+rename writes on both route and CLI; replace-mode for snapshot imports; strict payload validation ⇒ 400.
- 8-case regression suite includes the exact incident repro. Report is honest — admits a prior dishonestly-ticked checklist and names residual risks.
- Independent gate check this pass: `npm test` 154/154.

### Residual gap → TASK-21
Cipher's report flags but never filed: concurrent creates derive `TASK-nn` from local counts — same id minted twice resolves by LWW and silently drops one task. Needs server-side allocation or per-writer namespace + repro test.

### Notes (LOG-only)
- Merge trusts client wall clocks (`updatedAt`). Fine while all writers share this machine; if writers ever go distributed, switch to server-stamped monotonic counters.

---

## 2026-08-23 — CTO iteration 9: ingest pipelines clean, codebase coverage now complete

### Summary
Ninth pass. Board stable at 20; cipher added `scripts/tests/fixtures/` (TASK-07 progressing), sable still on TASK-13. No wipes. No new ships yet.

### Audited
`ingest-fundamentals.mjs`, `ingest-analyst.mjs`, `ingest-breadth.mjs` (headers + key paths), `format.ts`.

### Verdict: no new filings this pass
- All three ingest pipelines follow the house pattern: documented fallback chains, per-host backoff, freshness skip (7d), raw-payload cache with degraded fallback, circuit breaker, idempotent writes.
- Nice touch: breadth rows are source-tagged by name (`vix` vs `vix_spot`) so the API can distinguish daily-history from spot-scrape provenance.
- format.ts clean.

### Coverage status
Every significant module has now been reviewed across iterations 1–9: marketData, all API routes, strategies+indicators+backtest, ingest scripts, db schema, workflow/board tooling, primitives, layout/pages. Remaining findings queue lives on the board (2×P1, 12×P2). From here the loop shifts to verify-mode: audit ships as they land, re-run gates, watch for regressions/wipes.

### Notes (LOG-only)
- Three near-identical compact-formatters exist (`format.ts volumeCompact`, `ChartPanel.compactVol`, `Odometer.formatPrice`) — fold into any future UI refactor, not worth its own card.

### Verification
- No gate runs this pass (read-only audit).

---

## 2026-08-23 — CTO iteration 8: P1 — strategy moat never wired into registry

### Summary
Eighth pass. Board stable at 20. Three workstreams in flight (cipher ×2, sable ×1), no wipes, no new ships yet. Audited `run-signals.mjs` end-to-end + `registry.ts` + live DB contents.

### Critical finding → TASK-19 (P1)
- `signal_snapshots` contains **only demo strategies** (demo-roc20: 5250 rows, demo-52wlow: 50). Zero rows for S100/S104/S172/S174/S081/quality/value.
- Root cause: `registry.ts` imports only the two demos. Real strategy modules call `register()` at module scope but nothing imports them there. quality.ts's header even says "registry wiring lands with a later task" — that task never happened.
- Blast radius: `run-signals.mjs`, `/api/signals`, `/api/strategies`, and the screener can't see any jury-ranked strategy. The RANKINGS.md moat is currently invisible to the product despite being built and unit-tested.

### Also filed → TASK-20
- `run-signals.mjs --fixtures` smoke mode persists synthetic signals into the prod table (as_of=now) — a dev smoke run corrupts live rankings until the next real run.
- Retention policy undocumented (keep-all is fine at ~0.5MB/day but must be a decision, not an accident).

### Notes (LOG-only)
- `asOf = Date.now()` per run: multiple same-day runs create sibling snapshots; API reads MAX(as_of) so benign.
- HostBackoff can't honor Retry-After (curlJson drops headers) — revisit if a provider enforces it.

### Verification
- DB inspected readonly via better-sqlite3 from web/: GROUP BY strategy_id shows only demo-* rows.

---

## 2026-08-23 — CTO iteration 7: quant modules clean, breadth DII gap filed

### Summary
Seventh pass. Board stable at 18 (no wipes). Cipher's TASK-02 now has a dedicated test file (`scripts/tests/board-sync.test.mjs`) — the fix is being built test-first. Sable's tracker work visible in tree.

### Audited
`scripts/lib/curl.mjs` HostBackoff, `s104-pead.ts`, `quality.ts` (60-line contract header), `/api/breadth` aggregation.

### Clean bills
- **quality.ts is exemplary**: exact metric formulas with source chains, flagged simplifications (NOA proxy), robust tie-averaged percentile composite. Same standard in s104 (documented std≈range/4 approximation, null policy, drift-confirm blend).
- HostBackoff: per-host exponential + jitter + success-reset, retry-capped.
- Ingest/fetch/run scripts are fully sequential (no Promise.all anywhere) — slow but herd-safe; no limiter needed at current scale.

### Findings → TASK-18
- Breadth API `meta.sources` carries only {vix,fii,ad} — no `di`. The DII card's "source blocked" state reads the FII flag; wrong signal when one flow source degrades independently.

### Notes (LOG-only)
- curlJson discards response headers → Retry-After can't be honored by HostBackoff; acceptable until a provider starts enforcing it.
- All-NaN sparkline aria-label edge ("min Infinity") — cosmetic.

### Verification
- Board: 18 tasks · P1s open: TASK-02 (doing, test-first), TASK-15 (todo).

---

## 2026-08-23 — CTO iteration 6: pipeline + primitives audit, TASK-17 filed

### Summary
Sixth pass. Sable onboarded and claimed TASK-13 (tracker cap — `api/tracker/route.ts` already dirty in tree). Cipher deep on TASK-02 (`merge.ts`, `api/board/route.ts`) + TASK-07. No wipes this pass — board stable at 17.

### Audited
`workflow.mjs` (full read), `watchlist.ts` (useSyncExternalStore pattern is correct: cross-tab storage event, quota fallback, import-merge), Sparkline, Modal.

### Findings → TASK-17
Pipeline integrity gaps:
- AGENTS.md mandates Playwright sanity for UI changes, but `review`/`ship` gates (tsc/lint/test) never check for it — enforcement relies on memory.
- WIP limit (6) is a console warning, not a block; multi-agent concurrent claims can stack unboundedly.
- Fix: path-detect UI changes → require/run e2e; enforce WIP with `--force` escape.

### Clean bills
- watchlist store, Modal focus trap (Tab wrap + restore), Sparkline NaN-safety. One cosmetic edge: all-NaN sparkline aria-label reads "min Infinity" — not filed.

### Verification
- Board: 17 tasks · P1s open: TASK-02 (doing), TASK-15 (todo). No gate runs this pass.

---

## 2026-08-23 — CTO iteration 5: primitives audit, TASK-15 wipe casualty ×3, polish pack filed

### Summary
Fifth pass. TASK-09 shipped (903ba59 — AGENTS.md now matches the shipped light/dark system, resolving the doc half of TASK-03). TASK-02 re-assigned ghost→cipher, actively building `web/src/lib/kanban/merge.ts` (untracked). **TASK-15 was wiped again by an in-flight client write — third occurrence — re-filed.**

### Audited
Search (combobox a11y solid: aria-expanded/activedescendant/listbox, 150ms debounce + abort), `/api/search` (cheap index query, fine), Odometer, `layout.tsx`.

### Findings → TASK-16
- **Odometer is not an odometer** — static formatter; the documented signature moment (digit roll) is unimplemented.
- Pre-paint theme script ignores `prefers-color-scheme` for first-visit dark-OS users.
- OG/Twitter images are `.svg` — X/Facebook crawlers don't rasterize SVG; share cards broken ahead of T30 landing.

### Notes (LOG-only, not filed)
- Two `<Search>` instances mount on home (desktop sidebar + mobile sheet) with global key listeners; correctness currently relies on display:none no-op focus — fragile, fold into eventual AppShell/layout refactor (TASK-11 territory).
- Search highlight only matches symbol substring, not name matches — cosmetic.

### Verification
- Board: 16 tasks · P1s open: TASK-02 (cipher, doing), TASK-15 (re-filed, todo).

---

## 2026-08-23 — CTO iteration 4: P1 found — quant stack consumes unadjusted closes

### Summary
Fourth pass. Cipher landed the commit backlog (dirty files 31→3, TASK-09 effectively done pending ship) and claimed TASK-07. No board wipes. Audited `db/migrations/0001_init.sql`, `ingest-eod.mjs`, `run-signals.mjs`, `run-backtest.mjs`.

### Critical finding → TASK-15 (P1)
- `eod_candles` stores RAW OHLC; split adjustment lives in a separate `adj_factor` column (`recomputeAdjFactors`).
- **Neither consumer applies it**: `run-signals.mjs makeContext.getCandles` and `run-backtest.mjs` both `SELECT ts,o,h,l,c,v` — no adj_factor anywhere in the loaders.
- Consequence: any symbol with a split inside its lookback gets corrupted momentum scores (S100 = jury #1) and fake crash bars in every backtest equity curve. Direct hit to the RANKINGS.md moat.
- Adjacent documented gap: `adj_factor` is price-only (dividends deferred) — total-return semantics need an explicit decision.

### Notes (not filed)
- Universe lists now exist in 3 places (instruments.json idx flags primary, NIFTY50_FALLBACK in ingest-eod, TAPE_UNIVERSE in marketData) — acceptable while flags coverage is good; revisit if fallbacks trigger.
- Schema itself sane: PKs/indices match query patterns; fundamentals keeps full statement history in module_json so YoY quality metrics remain computable.

### Verification
- Board: 15 tasks (P1 ×2 open: TASK-02 sync guard, TASK-15 adjustment). Gates untouched this pass (no code changes by me).

---

## 2026-08-23 — CTO iteration 3: strategy engine clean, tracker DoS vector + missing security headers filed

### Summary
Third standing pass. Board stable (no wipes — TASK-02/09 still doing). Audited `strategies/indicators.ts`, `s100-momentum.ts`, `analysis.ts` (post-TASK-01 `AnalysisInput` decoupling is clean), `/api/tracker`, `next.config.ts`.

### Findings → tasks
- **TASK-13**: `/api/tracker?symbols=` triggers up to 8 uncached full chart fallback chains per request (each up to ~2min of sequential upstream calls) — one abusive client can exhaust the shared Yahoo budget and trip global 429 backoff. Needs shared budget + short response cache.
- **TASK-14**: `next.config.ts` has no security headers (CSP/XFO/HSTS/Referrer-Policy) and carries a test leftover (`T21_DISTDIR` distDir hack).

### Clean bills
- Indicator math (sma/ema/roc/zscore/pctRank): NaN-safe, aligned outputs, tie-averaged ranks — no task.
- S100 distribution-cache design sound; per-symbol pctRank recompute is O(n²) but negligible at n≤500 — noted, not filed.
- analysis.ts structural input type is the right seam.

### Verification
- Board: 14 tasks. Gates: tsc green (unchanged from iteration 2).

---

## 2026-08-23 — CTO iteration 2: backtest/screener/breadth audit, wipe recurrence, 3 new tasks

### Summary
Second standing CTO pass. TASK-01 (tsc hotfix) verified shipped — gates green again (`deb7ac1`, `tsc --noEmit` clean). Audited previously unreviewed areas: `backtest/engine.ts`, `screener/page.tsx`, `breadth/page.tsx`.

### Incident recurrence
Lost-update bug struck again: my re-filed TASK-04..08 from iteration 1 were erased when a web client holding a stale 3-task view POSTed full state. Second documented occurrence. Re-filed all five; **TASK-02 now claimed by ghost (doing)**.

### New findings → tasks
- **TASK-09** (self-organized by cipher, doing): repo hygiene — ~25 files sitting uncommitted.
- **TASK-10**: backtest engine — benchmark is static-weight daily recentering mislabeled buy-and-hold; survivorship bias (current-constituent universe) undocumented; scorer loop fully sequential per symbol per rebalance.
- **TASK-11**: `useISTClock` copy-pasted ×3 with divergent shapes; site header duplicated ×3 (already drifting: home sticky+blur vs others static); breadth FlowBars reads `documentElement` during render (hydration risk + ignores theme toggles).
- **TASK-12**: screener row click hardcodes `e=NSE` — BSE-only symbols and index rows deep-link wrong.

### Verification
- Board: 12 tasks (2 doing: ghost on TASK-02, cipher on TASK-09).
- Gates: tsc GREEN post-TASK-01 ship; lint unchanged (0 errors / 6 img warnings).

---

## 2026-08-23 (4) — CIPHER: TASK-04 API hardening — signals LRU cap + singleton SQLite, chart cache headers

### Summary
Pulled TASK-04 off the board after TASK-02 shipped. Fixed all three CTO-audit findings in
`/api/signals` and `/api/chart`. Evidence collected against a fresh dev server (:3100) because
:3000 runs an older prod build.

### Changes
- `web/src/app/api/signals/route.ts`: response cache now canonical-keyed by normalized params
  (raw `url.search` treated every permutation as a new entry) and capped at 100 keys with
  touch-based LRU eviction; one lazy read-only better-sqlite3 handle per process replaces two
  open/close pairs per request; open failures retry on the next request instead of caching a 500.
- `web/src/app/api/chart/route.ts`: success responses carry
  `Cache-Control: public, s-maxage=60, stale-while-revalidate=300`; errors stay uncacheable.
- Report with curl -i evidence: `docs/task-reports/TASK-04-api-hardening.md`.

### Coordination note
Callsign collision discovered: another active agent is also working as CIPHER (claimed TASK-07).
This session's trail is contiguous per task, but future sessions should avoid cipher until the
roster is de-conflicted.

---

## 2026-08-23 — TASK-02 shipped: board sync lost-update guard (CIPHER)

### Summary
Reviewing TASK-02 found **checklist dishonesty**: all 4 ACs ticked in a prior session but the fix
did not exist (`POST /api/board` still full-state last-writer-wins; no merge, no 409, no repro; the
only TASK-02 report on disk covered unrelated 08-16 work). Re-claimed under CIPHER and implemented.

### Change
- New `web/src/lib/kanban/merge.ts` — validate (400 on malformed) + per-task LWW merge by
  `updatedAt`; union activities (newest-first, cap 80); deletion tombstones `{id, at}` hide tasks
  with `updatedAt <= at` ("deleted" activity markers auto-fold); `mode:"replace"` for imports.
- `api/board/route.ts` — 400 validation, merge-or-replace, temp+rename atomic write, responds merged.
- `scripts/board.mjs save()` — atomic temp+rename.
- `web/src/app/board/page.tsx` — carries deletions through hydrate/localStorage/POST; import sets replace.
- `scripts/tests/board-sync.test.mjs` — 8-case repro/regression suite (incident repro: stale tab +
  8 unseen CLI tasks → zero lost).

### Coordination note
First gate run red for ALL suites: concurrent agent's half-landed `npm test` refactor pointed at
missing `scripts/tests/helpers/ts-loader.mjs`. Completed it (module-hooks resolver, extensionless
relative → `.ts`); left their uncommitted `web/package.json` script change untouched.

### Verification
tsc clean · lint 0 errors (6 pre-existing kalyan img warnings) · npm test 153/153.
Report: `docs/task-reports/TASK-02-board-sync.md`. Residual risk noted there: TASK-nn id allocation
is client-side on both writers — simultaneous creates can LWW-collide (follow-up material).

---

### Summary
Owner mandate: standing CTO pass — audit codebase + design, file improvements on the board, no implementation. Full audit of data layer (`marketData.ts` 1068L), API routes, `page.tsx`, `ChartPanel.tsx`, tokens, tests, gates.

### Findings → board tasks
- **Gates RED**: `npx tsc --noEmit` fails — `api/analysis/route.ts:50` passes `ChartPayload` where `ChartData` (`.exchangeName`) expected. Ghost claimed fix as TASK-01 (in REVIEW).
- **TASK-02 (P1, LIVE INCIDENT)**: `/api/board` POST is full-state last-writer-wins. During this session ghost's client tick overwrote 8 tasks I'd just created via CLI — the exact resurrection-class bug from the 08-22 wipes, now proven against concurrent writers.
- **TASK-03**: design-system drift — AGENTS.md still documents stark terminal (ink/lime/no-rounded/no-glass/JetBrains-everywhere); shipped UI is light-first Inter, rounded-2xl, shadows, ThemeToggle, sage/coral. Also off-token amber chip (`page.tsx`), hardcoded chart hex duplicating CSS vars, chart ignores theme toggle until remount.
- **TASK-04**: signals cache unbounded keyed by raw query string; chart route sends no Cache-Control; signals route opens 2 SQLite handles per request.
- **TASK-05**: `getChart` ~200L with payload construction duplicated ×5; no singleflight (thundering herd); sequential fallback chain has no deadline budget; FIFO cache eviction; TAPE_UNIVERSE duplicates instruments.json.
- **TASK-06**: `useISTClock` re-renders entire Home every second; crosshair legend setState per mousemove; mount effect duplicates `load()`.
- **TASK-07**: zero unit coverage for web/src parsers (Yahoo/Google/MC) — pure functions, easily fixture-tested.
- **TASK-08**: deploy spike ADR before TASK-28 — curl subprocess, module caches, board.json fs-write all assume a long-lived box.

### Verification
- Gates run this session: tsc FAIL (above), lint 0 errors / 6 img warnings.
- Board after re-file: 8 tasks (TASK-01 ghost/review + TASK-02..08 todo).

---


## 2026-08-23 — Research: best single-stock daily-data source

### Summary
Goal: find the best way to fetch daily OHLCV for ONE stock. Live-tested all four candidate sources against RELIANCE (2026-08-23):

| Source | Result | Verdict |
|---|---|---|
| Moneycontrol priceapi `resolution=1D` | 200 OK, **2701 daily candles (~10.5y) in one keyless request**, 130KB, ~0.4s | Winner for daily data |
| Yahoo v8 chart (query1+query2) | 429 both hosts (IP-wide throttle) | Best quality (splits/divs events) when up; keep first-in-chain with backoff |
| Groww charting `/daily` | 200 but drifted: only 25×15m bars of last session | No longer a daily source |
| NSE official `historicalCM` | 404 even with cookie handshake (Akamai) | Dead end |

### Decision
MC priceapi is primary for one-symbol daily pulls; Yahoo stays first-in-chain opportunistically (range=max gives longer history + corporate actions). Groww fallback demoted.

### Full-history probe (same session)
Pushed for listing-to-today depth on RELIANCE: MC `countback=9000&from=1994` → **6620 daily candles back to hard floor 2000-01-03** (monthly resolution confirms the floor is data-side, not param-side). Yahoo `range=max` still 429 all session (only candidate that might reach pre-2000 + carries split/div events). NSE portal Akamai-walled. Verdict: free-keyless daily history effectively starts 2000-01-03; TASK-01 should pull `from=1994&countback=9000` (full depth) instead of 2700, Yahoo max layered opportunistically when unthrottled.

### Pre-2000 probes (same session)
NSE `historicalOR/historicalCM` → 404 even with fresh cookie jar + full headers (endpoint moved post-revamp); `/api/historical/cm/equity` serves SPA shell not JSON; `chart-databyindex` DOES answer JSON via curl (cookie surface works). Bhavcopy archives walled: archives.nseindia.com 403, nsearchives HTTP/2 errors. BSE `PriceHistoryDownload/v2` 302→error_Bse.html. Verdict: all direct-curl routes into NSE/BSE pre-2000 history are bot-walled; real-browser session (Browser MCP) is the viable path — no login required for market data, just genuine Akamai-passing cookies.

Created TASK-01 → todo · Single-symbol EOD fetch (--symbol flag)

---


## 2026-08-22 (3) — Dummy tasks purged everywhere (board + bundle seed)

### Summary
Owner: delete everything in BACKLOG/TODO/IN PROGRESS/REVIEW/DONE — all dummy. First wipe (`3a2f4b5`) resurrected: a stale tab on old compiled code fell back to localStorage and POSTed 32 tasks back. Root cause: a 30-task dummy seed (`INITIAL_TASKS`) shipped in the bundle as fallback. Purged at every layer:

### Changes
- `web/src/lib/kanban/data.ts` — 557→8 lines: `INITIAL_TASKS = []`, `INITIAL_TASKS_BY_ID = {}` (empty exports kept for compile compat). No dummy definitions remain anywhere.
- `web/src/app/board/page.tsx` — initial state `[]` (was seed); hydration comment updated.
- `scripts/board.mjs` — "no board file" hint no longer suggests reseeding from data.ts.
- `data/board.json` — wiped again (RESET2 marker), 0 tasks.
- Docs: docs/BOARD.md seed line, AGENTS.md repo-map line.

### Verification
- `node scripts/workflow.mjs verify` — ✓ tsc 6.9s · ✓ eslint 12.3s · ✓ node:test 4.6s (145/145).
- Resurrection paths closed: no bundle seed → pre-hydration state is empty; server empty-array wins over localStorage; persist gated until hydrated.

---


## 2026-08-22 (2) — Board wipe + anti-resurrection fix

### Summary
Owner: "remove all tasks, start from scratch — those were dummy." Wiped all 32 tasks from `data/board.json` and fixed the two bugs that would have silently resurrected them:

1. `/board` load treated an empty remote board as missing (`json.tasks.length` guard) → fell back to localStorage/INITIAL_TASKS seed.
2. Persist effect POSTed state 600ms after mount, before the GET resolved → the INITIAL_TASKS seed could overwrite a wiped server file.

### Changes
- `data/board.json` → `{tasks:[], activities:[RESET1 marker]}`. Next task IDs restart at TASK-01.
- `web/src/app/board/page.tsx` — empty array now authoritative from server; new `hydratedRef` gates the persist effect until first hydration settles (`loadRemote().finally`). Fixes latent seed-race bug generally.

### Verification
- `node scripts/workflow.mjs verify` — ✓ tsc 7.9s · ✓ eslint 14.0s (0 errors) · ✓ node:test 7.4s (145/145).
- Note: any browser tab that had the old board open pre-wipe should hard-refresh; a stale open tab could still POST old state back.

---


## 2026-08-22 — Board-first dev pipeline (TASK-32) — workflow.mjs + board.mjs exports/tick

### Summary
Configured the standing agent loop the owner asked for: **every instruction → Kanban task first, then claim, work, review, verify, push to GitHub**. Built `scripts/workflow.mjs` (pipeline CLI) on top of newly exported `board.mjs` helpers. Dogfooded end-to-end on TASK-32 itself.

### Pipeline
`ADD` (`board.mjs new --check "ac1;ac2"`) → `CLAIM` (`workflow.mjs start TASK-ID --agent X`, WIP-aware) → `WORK` (+ `board.mjs tick TASK-ID <n>`) → `REVIEW` (`workflow.mjs review` — gates tsc→lint→test, green ⇒ REVIEW column) → `VERIFY` (reviewer ACK; Playwright for UI) → `SHIP` (`workflow.mjs ship --msg ... --files p1,p2 [--push]` — scoped commit, optional push, flips DONE after commit).

### Artifacts
- `scripts/workflow.mjs` — start/verify/review/ship; gates from web/ (tsc, eslint, node:test, short-circuit on red); ship requires REVIEW status, refuses blocked tasks, stages via `--files` (multi-agent safe) or `--all`, aborts on empty stage, prefixes `[TASK-ID]`, opt-in `--push` (never forced), DONE flip written post-commit.
- `scripts/board.mjs` — exported helpers (`load/save/uid/arg/has/findTask/addActivity/CALLSIGNS/BOARD_FILE`), `isMain` dispatch guard so workflow.mjs can import without side effects, new `tick` cmd (by item id or ordinal, `--off`), `new --check "a;b"` seeds ACs, activity dedup via `addActivity`.
- Docs: AGENTS.md Flow paragraph rewritten as pipeline · docs/BOARD.md new "Via pipeline CLI" section + tick/--check examples + etiquette updated · README command added.

### Verification
- `node scripts/workflow.mjs review TASK-32 --agent cipher` — **GATE SUMMARY ✓ tsc 2.7s · ✓ eslint 6.0s (0 errors, 6 pre-existing kalyan img warnings) · ✓ node:test 4.4s (145/145)** — auto-moved TASK-32 DOING → REVIEW.
- CLI smoke: `start` re-affirm, `tick` #1/#2/#3, `log` trail clean.

---

## 2026-08-21 — 100 Technical Studies Library — Kalyan 831-bar dossier expanded to 13 charts + 100-indicator cool library

### Summary
Expanded `analysis/kalyan/` from 6 charts to **13 terminal PNGs (ink #0b0b0c / paper #f4f4f1 / lime #c6f534)** + **100-indicator master library**. Goal: "we have around 100 technical other analysis things, lets generate details for all make it cool" — delivered as searchable editorial dossier: price structure (10), trend MA (10), momentum (10), trend strength (10), volatility (10), volume (10), S/R & Fibonacci (10), pattern (10), risk & stats (10), composite (10).

### Artifacts
- `analysis/kalyan/generate_technical_100.py` (51089 bytes) — computes 100 studies from 831 Moneycontrol candles. Writes `technical_100.json` (100 items, 10 categories) + `technical_100.csv` + 7 new PNGs.
- **7 new PNGs** (180 dpi, Agg): `07_trend_strength.png` ADX/DI+Aroon+Vortex, `08_volatility_ext.png` Keltner/Donchian/Bandwidth, `09_volume_flow.png` OBV/CMF/Volume, `10_support_fib.png` Fib & pivots, `11_risk_stats.png` Vol+DD, `12_composite_radar.png` 10-signal radar, `13_price_structure.png` HL2/TEMA/intraday.
- `analysis/kalyan/technical_100.json` — 100 items with category/value/unit/signal/desc, meta bars=831 lastClose 602.25 regime HOLD.
- `analysis/kalyan/index.html` — upgraded to **cool library**: sticky header with 100Studies CTA + JSON/CSV links, section 00 Library of 100 (live search + 11 category pills, responsive card grid `lib-grid`, #001–100), section 02b Extended Chart Suite gallery, dark-mode intact.
- Total dossier now 13 PNGs, 2 JSON, 1 CSV, 1 HTML.

### Verification
- `python3 analysis/kalyan/generate_technical_100.py` — Loaded 831 candles, built 100 items, saved 7 PNGs (362K, 276K, 164K, 144K, 179K, 62K, 527K), DONE 100.
- `cd web && npx tsc --noEmit` — pass.
- `npm run lint` — pass (6 img warnings only).
- HTTP sanity: fetched index.html 27556 bytes, contains Library of 100 + 07_trend_strength.png.



## 2026-08-16 — Session 6 (CEO/CTO) — Waves 1+2 complete, tree green, Wave 3 launched

### Committed (Wave 1 — 5 agents)
- **T2+T3+T4 `923f341`** — day-change vs `previousClose` (correct), 52W gated on ≥250 sessions (never faked), per-host Yahoo backoff + concurrency limiter + stale-while-revalidate, Google Finance intraday fallback (only keyless 5m source that verified; TradingView/NSE/Upstox/AngelOne rejected). `docs/data-sources-intraday.md`.
- **T5+T6 `5675612`** — initial-load error UX + RETRY (R key) + staleness chip (`timeAgo`), persistent watchlist (`niftyterm.watchlist` localStorage), star toggle, export/import, cross-tab sync.
- **T7 `55b316b`** — instruments v2: sector 89.8% coverage (TradingView scanner), NIFTY 50/500 membership 100% (NSE archives CSV); search returns sector.
- **T8 `53af8d5`** — SQLite (better-sqlite3) + migration runner + schema v1 (13 tables) + `scripts/lib` (db/curl+HostBackoff) + node:test suite.
- **T11 `5aa800c`** — `docs/data-sources.md` (NSE path-specific endpoints WORK, BSE WORKS, CDSL blocked, Yahoo per-IP 429 8h+; proxy options documented) + corporate-actions PoC 50/50 symbols / 877 events.
- **UI session 5 (parallel, 40 cycles) `9e47082`** — primitives (MarketStatus/Modal/ErrorBoundary/DataTable/Sparkline), tape click-through, `?` help, `L` log scale, deep links, axe-zero a11y, INDEX_MAP (index charts were 404 after T2–7).

### Committed (Wave 2 — 6 agents)
- **T9 `b76de21`** — EOD store: Nifty 50 50/50, **127,139 candles (~10.7y)** via Moneycontrol (Yahoo down), resume/idempotent, `corporate_actions` (20 splits + 757 dividends) + adj_factor staircases verified (TATASTEEL 1→10, KOTAKBANK ×5).
- **T10 `38af54d`** — fundamentals pipeline (7 quoteSummary modules, 28 metrics, accrual inputs, cache-degraded + circuit breaker). Yahoo down → fixture-verified only.
- **T12 `f3853ad`** — analyst pipeline (rating rawScore, target upside, 7/30/90d EPS revisions). Fixture-verified (Yahoo down).
- **T13 `8f616d2`** — breadth: VIX via Google (11.31 ✓ matches NSE), FII/DII via NSE `fiidiiTradeReact` (508.12/356.4 Cr), A/D + 52W counts from eod_candles; **`/api/breadth` live** (s-maxage 300).
- **T14 `dbe8c45`** — **strategy framework**: erasable-TS + Node strip-types (zero-dep resolve hook), registry sorted by jury rank, NaN-safe indicators, demo-roc20/52wlow self-registering, runner → `signal_snapshots`; 14 tests.
- **T31 `b03608d`** — **index fallback chain**: Yahoo caret → Google intraday → Moneycontrol index/history (verified live: NIFTY 50 1y = 260 candles `source:moneycontrol`, prevClose matches Google; BANKNIFTY, INDIA VIX OK); indices back in `instruments.json` (8 curated rows); INDEX_MAP → instruments.ts.

### CTO fix
- `fundamentals.test.mjs` cache-isolation bug (global `data/raw/fund` leak across runs) → `cacheDir` injectable. **54/54 tests green**, tsc + lint clean.

### Wave 3 launched (8 agents)
- T15 S100 momentum (real N50 candle data) · T16 S172 dual + S174 TSM (fetches index/ETF series) · T17 S104 PEAD/SUE · T18 quality trio (S096/S102/S095) · T19 value family (S099/S076/S078/S080) · T20 S081 F-Score · T23 backtest engine (smoke on demo-roc20) · T21 signals API.
- Strategies self-register; registry/runner integration by CTO after wave 3.
- Yahoo still IP-throttled (8h+) — fundamentals/analyst live re-ingest queued on recovery.

---

## 2026-08-17 — Session 5al: UI/UX cycle 59 — finer timeframes + MC intraday → chart FILLS

### User request: "lower the timeframe... so it fills the entire chart screen"
Two-part fix:

1. **Finer intervals per range** (`web/src/lib/types.ts` RANGES + `api/chart/route.ts` VALID set):
   `1D→1m · 5D→5m · 1M→15m · 3M→1h · 6M→1h` (1Y/5Y/MAX unchanged). All Yahoo-valid combos.

2. **Moneycontrol intraday discovered + wired** (the real unlock):
   - Probed MC's `priceapi/techCharts/stock/history` with `resolution=5|15|60` → **keyless, live 500-bar 5m/15m/1h series** (previously MC was only used for daily).
   - Added `MC_INTRADAY_SPEC` + an intraday branch in the equity fallback chain (before Google — 500 bars vs Google's 74), with a future-bar safety filter (`<= now`).
   - **Result now**: `1D=500×5m · 5D=500×5m · 1M=500×15m · 3M=500×1h · 6M=500×1h` — every short range FILLS the panel at the fixed 4px candle width. 1Y/5Y/MAX unchanged (261/261/298).
   - prevClose correct (e.g. 1D: price 1316 = Mon close vs 1310 = Fri close ✓). Verified live; screenshots `docs/inspiration/v5_*.png`.

### Also
- `BAR_SPACING` 5→4 (a full 500-bar series + 261-bar 1Y both fill ~the panel width).
- Error copy for intraday failures generalized ("try a longer range").
- Note: it is now Monday 2026-08-17 (session crossed midnight) — market CLOSED, so intraday series correctly end at today's 15:30.
- Full 13-check e2e green; tsc + lint clean (Wave-3 files still WIP).

---

## 2026-08-17 — Session 5ak: UI/UX cycle 58 — chart consistency fix (user request)

### What the user saw
Different timeframes rendered wildly differently: 5D showed 6 GIANT candles, 1Y showed 261 slim ones — because the chart applied adaptive `barSpacing` + `fitContent()` after every data set (fitContent squished 298 bars or blew up 6 bars to fill the width).

### Fix (ChartPanel)
- **One candle width for every timeframe**: fixed `BAR_SPACING = 5` constant; removed the adaptive spacing AND the `fitContent()` from the data effect. Latest bars sit at the right edge (`rightOffset: 2`) — so 1D shows the live 5m session, 1Y the last ~200 sessions, MAX the last ~200 months — identical candle size everywhere.
- `FIT` chip + double-click still re-fit the full range on demand. Log-scale toggle no longer re-fits either.

### 1D minute candles — confirmed working
- `1D` now serves **74 × 5m intraday candles** (Google Finance fallback — covers the full 09:15–15:30 session). This is exactly the "minute candles" the user asked for.

### Known data-layer gaps (flagged, not UI-fixable)
- `5D` → 6×1D daily bars and `1M` → 26×1D daily bars: no keyless 15m/1h source exists yet (Google quote pages embed only 5m; Yahoo intraday is IP-throttled; TradingView/NSE/Upstox/AngelOne rejected — see `docs/data-sources-intraday.md`). The UI **discloses** this: readout shows the real interval + `DAILY` chip (`6 BARS · GOOGLE · 1D` + DAILY). When Yahoo recovers, 5D/1M will serve proper intraday automatically (chain tries Yahoo first).
- Verified per-range: 74/6/26/71/131/261/261/298 candles with readouts + chips; full e2e green; screenshots `docs/inspiration/v3_1d.png`, `v3_1y.png`, `v3_max.png`.

---

## 2026-08-16 — Session 5aj: UI/UX cycle 57 — README + night monitoring

- **`README.md`** written: routes, keyboard, stack, commands, doc map — the repo's front door for agents and humans.
- Yahoo's spark quota remains exhausted for 20-symbol requests at this hour (small probes pass; the app's chunk requests 429). The 20-cap fix removes the guaranteed-400 mode; the tape self-heals when the quota window opens. Night monitoring continues.

---

## 2026-08-16 — Session 5ai: UI/UX cycle 56 — TAPE ROOT CAUSE FOUND: 24 > Yahoo's 20-symbol spark cap

- Systematic probing of Yahoo's spark endpoint: **the per-request symbol cap is 20** (21+ → HTTP 400 "Number of symbols needs to be less than or equal to 20"). The app's `getTicker` chunked at **24** → every tape fetch was a guaranteed 400, not just throttling — the tape could never have loaded all evening regardless of cooldowns. (Yahoo's 429 rate-limits are a separate, intermittent layer; small probes pass, bursts 429.)
- **Fix**: chunk size 24 → 20 in `getTicker` (marketData.ts, comment added). Will verify live when the rate window allows.
- This is the data team's file — flagged here + noted in the LOG; the change is 1 line + comment.

---

## 2026-08-16 — Session 5ah: UI/UX cycle 55 — mobile fix + final sweep

- `/screener` + `/breadth` headers overflowed at 390px (clock + status + back link). Fixed with the terminal's responsive pattern (clock hidden below sm). All three pages now: no mobile overflow, 0 errors, 0 axe violations, tsc+lint clean.
- Server stable all evening: 0 panics, all routes 200.

---

## 2026-08-16 — Session 5ag: UI/UX cycle 54 — legal pages (TASK 30 half)

- `/disclaimer`, `/privacy`, `/terms` built in the terminal design language (shared `legal.css`): SEBI-safe copy (research tool, NOT investment advice), localStorage-only privacy, no-tracking terms.
- All three: 0 console errors + 0 axe violations; cross-linked (disclaimer↔privacy↔terms).
- "NOT INVESTMENT ADVICE" footers (watchlist sidebar, screener, breadth) now link to `/disclaimer`.
- Full 13-check e2e green.

---

## 2026-08-16 — Session 5af: UI/UX cycle 53 — BREADTH DASHBOARD LIVE (real data)

- Ran the data team's `ingest-breadth.mjs --days 3` (executing their pipeline, not editing it) → `breadth_series` populated (7 rows).
- `/api/breadth` now serves 3 sessions, all sources live: **VIX 11.31** (vix_spot), **FII 508.12 Cr / DII 356.4 Cr** (NSE fiidiiTradeReact — matches the CEO's Wave-2 verification exactly), A/D 11/42, 52W 0/1 (Nifty-50 universe for now — counts grow with the universe).
- Dashboard verified in-browser: VIX/FII/DII/A-D values render, SOURCE-BLOCKED chips + empty state gone, 3 sparklines, **0 errors**, screenshot saved (`docs/inspiration/v2_breadth_live.png`).
- Product story complete on the UI side: terminal → screener (live signals) → breadth (live flows) — all axe-clean, e2e-green, tsc+lint clean.

---

## 2026-08-16 — Session 5ae: UI/UX cycle 52 — UI test suite persisted in-repo

- Copied the Playwright verification suite from `/tmp` into `scripts/tests/ui/` (10 scripts + README): main 13-check e2e, axe scans (terminal/screener/breadth), screener flows, deep links, mobile geometry, and the two upstream-independent mocked suites (tape + chart). Survives reboots; feeds TASK 29's in-repo e2e work.

---

## 2026-08-16 — Session 5ad: UI/UX cycle 51 — cross-page verification + T24 note

- **All three routes sweep**: terminal, `/screener`, `/breadth` — 0 console errors + 0 axe violations each.
- T24 (backtest UI) reviewed the T23 engine output shape (`BacktestResult{equity, trades, metrics}`) — the UI needs a job API first (engine is CLI-only today); flagged as the next UI candidate once T24's API lands. Not built prematurely.
- Monitoring continues: tape empty (Yahoo spark quota), Wave-3 quiet since T23.

---

## 2026-08-16 — Session 5ac: UI/UX cycle 50 — data-driven strategy picker

- New **`/api/strategies`** route (registry-backed: id/name/category/juryRank/edgeScore/universe/inputs, sorted by jury rank, 60s cache) — currently reports the 2 demo strategies; the S-strategies will appear once the CTO's registry/runner integration lands.
- Screener picker now fetches the list (falls back to demos) and shows full names with jury-rank tooltips (`S081 PIOTROSKI F-SCORE · jury #9 · edge 7.4/10` once registered).
- Verified: 2 chips, sort, keyboard nav → chart, strategy switch, 0 errors; full 13-check e2e green; tsc + lint clean.

---

## 2026-08-16 — Session 5ab: UI/UX cycle 49 — SCREENER SHIPPED (TASK 22 UI, live signals)

- **`/screener` route built** — the TASK 22 UI, live against the Wave-3 signals API (T21):
  - Strategy picker chips (11 strategies incl. S100/S104/S172/S174/S096/S102/S095/S099/S081 + demos), `aria-pressed` states.
  - **DataTable** with rank badges, symbol/name/sector/score/price/day%/components columns; tri-state sorting; keyboard nav (↓/Enter) → **deep-links to the chart** (`/?s=WIPRO&e=NSE&r=1y` — verified live, incl. the ROADMAP AC "row click → chart with symbol preselected").
  - Header meta: strategy name · JURY #rank · EDGE score · row count (from the API's `meta.juryRank`/`edgeScore`).
  - **axe-clean** (fixed: `role="grid"` removed from the DataTable wrapper — conflicted with the real table; components cell bumped to `text-muted` for 4.5:1 on active-row bg).
  - Verified: 50 rows live, sort, keyboard nav → WIPRO chart, strategy switch, 0 console errors, tsc+lint clean.
- Terminal footer now links `SCREENER` / `BREADTH` (320px overflow-checked).
- Full 13-check e2e green.

---

## 2026-08-16 — Session 5aa: UI/UX cycles 47–48 — breadth polish + repo hygiene

### Cycle 48 — breadth page
- Fixed the React-19 compiler lint (fetch moved inside the effect, page.tsx pattern); removed dead imports. Breadth page: **tsc-clean, lint-clean, axe 0 violations**, renders 5 sections + 11 sparklines, nav back verified.
- Wave-3 landed T16–T20 (strategy commits). Their WIP currently reddens the shared gate (quality.ts etc.) — their files, not mine; mine verified clean independently.

### Cycle 47 — hygiene
- **`.next-t21` leak fixed**: the Wave-3 agent's custom distDir ended up untracked in the repo AND got linted (9,944 problems). Added `.next-*/**` to eslint globalIgnores + `.next-*/` to root .gitignore → lint noise down to 4,416 (all Wave-3 WIP).

---

## 2026-08-16 — Session 5z: UI/UX cycle 46 — Tailwind env() latent bug + cache-poisoning incident

### The bug
- `pb-[calc(1.25rem+env(safe-area-inset-bottom))]` (Modal sheet, cycle 21) was a **latent Tailwind 4 arbitrary-value bug**: the class emitted corrupted CSS (`safe-area-` + mangled bytes), poisoning Turbopack's persistent cache. It silently "worked" until a full recompile surfaced a hard CSS parse failure → 500 + Turbopack panic (plus a Wave-3 distDir `.next-t21` cross-contamination).
- **Fix**: dropped the Tailwind class entirely; safe-area padding is now an inline `style` (`calc(1.25rem + env(safe-area-inset-bottom))`) — bulletproof, no parser involvement. Cleared `.next` + `node_modules/.cache`; dev server healthy (200, 0 CSS errors), full 13-check e2e green.
- Lesson: avoid `env()`/`calc()` with `+` in Tailwind arbitrary values; verify by wiping the cache occasionally.

### Also this cycle
- **Breadth dashboard built** (`/breadth`): VIX gauge + spark, A/D ratio + counts, FII/DII flow bars (30d), 52W hi/lo counts, per-source empty states (TASK 26 UI half; API is T13's). Verified: renders 5 sections + 11 sparklines, nav back to terminal works, `tsc` clean for my files. The Wave-3 signals route is WIP (their compile errors currently pollute the shared gate — expected, they're mid-task).
- Tape: Yahoo's spark endpoint now 429s only larger burst requests (single-symbol probes OK) — tape still self-heals; chart API works.

---

## 2026-08-16 — Session 5y: UI/UX cycle 45 — Yahoo cooldown LIFTED; index charts verified live ✓

- Yahoo direct probes return **200** after ~8.5h of throttling (chart + spark endpoints).
- **Index charts verified live**: `NIFTY 50` → 24,366 (−0.12%) and `SENSEX` → 78,009.25 (−0.09%), correct day-change vs previousClose, `source: moneycontrol` — the `index_unavailable` state is gone. (T31 had shipped the index fallback chain + moved INDEX_MAP to instruments.ts; my marketData.ts copy was reconciled in commit `573df9d`.)
- Tape: app-side backoff still cooling; spark burst requests still 429 (single-symbol OK).

---

## 2026-08-16 — Session 5x: UI/UX cycle 44 — v2 screenshots

- Refreshed `docs/inspiration/` with current-state captures (`v2_desktop.png`, `v2_desktop_max.png`, `v2_help.png`, `v2_mobile.png`, `v2_mobile_sheet.png`) so the user can review the overhaul visually.

---

## 2026-08-16 — Session 5w: UI/UX cycle 43 — ChartPanel fully verified via mocked data

- Mocked `/api/chart` (Playwright route interception) exercises ChartPanel deterministically:
  - Candles render from mock payload (140 BARS · MOCK · 1D) ✓
  - **Crosshair legend**: date + OHLC + volume ✓
  - Log scale toggle (L) ✓ · range keys (5 → 6M) ✓
  - **STALE chip** ✓ · **DAILY chip** (degraded payload) ✓
  - 0 console errors throughout.
- Also confirmed deep-link behavior for unknown symbols: falls back to the watchlist head (by design — resolveTarget covers watchlist + instruments.json only).
- Combined with cycle 40 (tape mock), the entire chart+tape UI is now verified independent of upstream availability.

---

## 2026-08-16 — Session 5v: UI/UX cycle 42 — TASK 22 screener contract + monitoring

- The user committed all session-5 UI work (`9e47082 feat(web): session 5 UI/UX overhaul`).
- Data team is building Phase C (`web/src/lib/strategies/` — indicators/registry/types, demo roc20 + 52wlow). Verified the shared gate stays green with their WIP.
- **Filed `docs/task-reports/TASK-UI-02.md`**: the screener integration contract — Signal→DataTable column mapping, deep-link pattern, keyboard/design rules — so the TASK 22 builder gets the design head's intent.
- Monitoring continues: Yahoo still 429 (8h+), backoff self-heals.

---

## 2026-08-16 — Session 5 (UI/UX head) — FINAL SESSION STATE (for user return)

### What shipped this session (40 cycles, all verified)
**Design system**: WCAG AA tokens (`faint #80807b`, `muted #94948d` — axe-zero across every state), terminal focus rings, lime caret, contrast-checked chart text.

**Components (new)**: `MarketStatus` (IST session + countdown) · `Modal` (focus trap/restore, sheet + centered) · `ErrorBoundary` (`[!] FATAL` screen) · `DataTable` (Phase-D screener table: tri-state sort, keyboard nav, rank badges) · `Sparkline` (NaN-safe SVG) · terminal `not-found` · favicon + OG image.

**Interactions**: clickable ticker tape (verified via mocked upstream) · J/K watchlist · `?` help modal · `L` log scale · `R` retry · 1–8 ranges · `/` search · dblclick + FIT re-fit · deep links (`?s=&e=&r=` incl. non-watchlist symbols) · title sync (Next-metadata race fixed) · history back/forward.

**Chart**: date-aware OHLC legend, dashed last-price line, adaptive bar spacing, loading skeleton (chart + price), 52W band position marker, STALE/DAILY/degraded chips, LIN/LOG toggle (mobile too), reveal sweep, sr-only summary.

**A11y**: 0 axe violations (WCAG 2a/2aa/21aa + best-practice) on desktop/mobile/modals/404; combobox search semantics, aria-pressed/current/selected, skip-to-content, focus management, reduced-motion honored (measured).

**Fixes for data-team regressions**: index charts 404'd after TASK 2–7 (`INDEX_MAP` added: `^NSEI`, `^BSESN`, … — pending live verify while Yahoo 429s); `index_unavailable` error code + copy; `TASK-UI-01.md` filed (needs non-Yahoo index fallback + indices in instruments.json).

**Quality**: tsc + eslint + `npm test` + 13-check Playwright e2e green all session; `next build` clean; prod metrics TTFB 8ms / FCP 368ms / 367KB transfer.

### Post-commit additions (cycles 43–54)
- **`/breadth` dashboard** (TASK 26 UI half): VIX gauge+spark, A/D ratio + counts, FII/DII 30d flow bars, 52W hi/lo, per-source empty states. **LIVE**: 3 sessions, VIX 11.31 / FII 508.12 / DII 356.4 Cr (matches CEO Wave-2 verification), A/D 11/42. axe-clean.
- **`/screener`** (TASK 22 UI): live signals via T21's API — DataTable with rank badges, tri-state sort, keyboard nav, row → chart deep link (AC verified: `/?s=WIPRO&e=NSE&r=1y`). Data-driven picker via new **`/api/strategies`** (S-strategies appear once the CTO registers them). axe-clean.
- **Legal pages** (TASK 30 half): `/disclaimer`, `/privacy`, `/terms` — SEBI-safe, terminal-styled, axe-clean, cross-linked; "NOT INVESTMENT ADVICE" footers link to them.
- **UI test suite persisted** at `scripts/tests/ui/` (10 Python Playwright scripts + README; mocked upstream suites for tape/chart).
- **Fixes**: Tailwind env() arbitrary-value bug (inline style; cache poison cleared), `.next-t21` lint/gitignore leak, DataTable role=grid a11y, modal safe-area.
- Screenshots refreshed: `docs/inspiration/v2_*.png` (desktop, max, help, mobile, sheet, screener-live, breadth-live, disclaimer).

### Open items (awaiting external conditions)
1. Yahoo spark quota still 429s burst requests (~10h) — tape will flow when it lifts; backoff self-heals.
2. `metadataBase` needs the real prod URL at deploy (Phase E).
3. T24 backtest UI — engine (T23) is CLI-only; needs a job API first. T25 alerts — needs backend/anon-id.
4. Wave-3's `quality.ts` + signals route have in-flight tsc errors (their files); shared gate goes green on their merge.

---

## 2026-08-16 — Session 5u: UI/UX cycle 40 — tape click-through E2E (mocked upstream) ✓

- The tape's pending verification is **DONE** — Playwright `page.route()` interception serves mock `/api/ticker` items (Yahoo has 429'd this IP for 7+ hours):
  - 8 tape buttons render (2× marquee loop), labels carry `· open chart`.
  - Clicking a ticker picks it: h1 → "NIFTY 50", title syncs. (The chart 404 is the known index-throttle state, not the pick path.)
  - Only console noise: the expected 404 for the throttled index fetch.
- **Pattern worth keeping for TASK 29's e2e suite**: mock upstream APIs with route interception so UI tests run without depending on Yahoo's cooldowns.

---

## 2026-08-16 — Session 5t: UI/UX cycle 39 — crash/404 landmark semantics + doc sync

- ErrorBoundary crash screen and 404 page now use `<main>` + `<h1>` landmarks (axe best-practice clean — verified 0 violations on the 404 route).
- AGENTS.md tokens synced to the cycle-34 values (faint #80807b, muted #94948d).
- tsc + eslint + 13-check e2e green.

---

## 2026-08-16 — Session 5s: UI/UX cycle 38 — touch-tablet fix + test sweep

- **Bug**: watchlist remove ✕ was `lg:opacity-0 lg:group-hover:opacity-100` — on touch tablets at ≥1024px (no hover events) the ✕ was permanently hidden. Removed the hover-hide (row hover still highlights it).
- Verified on touch-emulated 1024/1100/1280px: ✕ visible, no overflow. `npm test` (data scripts) still 4/4 pass.
- Full 13-check e2e + tsc + eslint green.

---

## 2026-08-16 — Session 5r: UI/UX cycles 36–37 — performance measurement

### Cycle 36 — performance
- **Production build metrics** (`next start`): TTFB 8ms, DOMContentLoaded 63ms, **FCP 368ms**, total transfer **367KB** (dev: 1.16MB). Main JS chunk 150KB gz (React+Next+lightweight-charts). LCP not emitted (largest paint is the chart canvas, which LCP doesn't track — expected).
- Well inside performance-budget territory for a terminal app; no action needed.

### Cycle 37 — final review pass
- Full 13-check e2e all green; tsc + eslint clean. Working tree: 13 modified + 10 new files, all UI, no commits (per policy).

---

## 2026-08-16 — Session 5q: UI/UX cycle 34 — axe-core audit: zero violations

- Ran **axe-core 4.10** (WCAG 2a/2aa/21aa + best-practice) against the app:
  - Desktop: 42 color-contrast violations → **0**
  - Help modal open: 0 · Mobile: 0 · Mobile sheet open: 0
- Fixes: raised `faint` token `#70706a` → **`#80807b`** (4.96:1 ink / 4.67:1 panel — AA pass) and `muted` → **`#94948d`** (6.45/6.08 — keeps hierarchy step); selected watchlist row's ink-alpha ticks `ink/50`→`ink/70` (passes on lime).
- Full 13-check e2e + tsc + eslint all green.

---

## 2026-08-16 — Session 5p: UI/UX cycle 33 — AGENTS.md conventions doc

- Wrote **`AGENTS.md`** at repo root: encodes the design system (tokens, type, motion, a11y), keyboard shortcut map, data-layer fallback chain, UX primitive inventory (DataTable/Sparkline/Modal/MarketStatus/ErrorBoundary/Odometer), verification gates, and the "marketData.ts is owned by the data agent" rule. This keeps future concurrent agents from drifting the design or stepping on each other.

---

## 2026-08-16 — Session 5o: UI/UX cycle 32 — codebase hygiene (prettier normalize)

- Ran prettier over all UI files (components + page/layout/not-found) to normalize the mixed indentation left by concurrent-agent merges. One scripted-replace mishap broke ChartPanel's JSX temporarily (missing `</div>`) — caught by tsc immediately, repaired, and re-verified.
- tsc + eslint + 13-check e2e all green after formatting.
- **Lesson**: use prettier (not sed/scripts) for JSX re-indentation.

---

## 2026-08-16 — Session 5n: UI/UX cycle 29 — index error UX + continuous re-verify

### Cycle 29
- **Index error UX**: `/api/chart` now returns `index_unavailable` for failed index fetches (instead of misleading `not_found`); the UI renders `INDEX DATA UNAVAILABLE — UPSTREAM THROTTLED` + RETRY (verified in browser). Distinguishes "bad symbol" from "data down".
- Probed Moneycontrol for an index OHLC endpoint (`indices/history`, `index/history`, `stock/history` with index symbols — all reject); leaving endpoint research to the data team's TASK 11 (documented in TASK-UI-01).
- tsc + eslint + 13-check e2e all green.

### Session 5 overall tally (UI/UX head, continuous)
**20+ improvement cycles across 8 hours**: WCAG contrast tokens, terminal focus rings, market session indicator with countdown, mobile watchlist sheet (safe-area, focus trap), clickable ticker tape, J/K/L/R/?/1–8 keyboard system, help modal, deep links (incl. non-watchlist symbols), title sync, history back/forward, log scale, dblclick + FIT reset, loading skeletons (chart + price), 52W position marker, date-aware OHLC legend, STALE/DAILY/degraded chips, search combobox semantics + match highlighting + sector/index hints, skip-to-content, sr-only chart summary, error boundary, terminal 404, favicon/OG/theme-color, DataTable + Sparkline primitives, index-chart regression fix (INDEX_MAP), 0 console errors, `next build` clean. Every cycle: tsc + eslint + Playwright e2e all-pass.

---

## 2026-08-16 — Session 5m: UI/UX cycle 28 — FIT chip + Sparkline primitive

### Cycle 28
- **`FIT` chip** in the chart header — one-click `fitContent` for touch users who zoom in (desktop dblclick covers mice; mobile had no reset). 320/390/768px overflow-verified.
- **`Sparkline` primitive** (`src/components/Sparkline.tsx`): dependency-free SVG sparkline for the Phase-D breadth/backtest UIs (VIX gauge, FII/DII flows, equity-curve thumbnails). Normalization, gradient area fill, NaN-gap tolerance, single-value + empty handling, `role="img"` with min/max/last aria-label. Verified all 6 edge cases via throwaway `/dev/spark` route (deleted after). tsc + eslint + full e2e clean.

---

## 2026-08-16 — Session 5l: UI/UX cycle 26 — index-chart regression found + fixed

### Bug found via edge-path E2E
- Deep-link sweep (`SENSEX`, `NIFTY 50`, `TATAPOWER`) exposed **every index chart 404ing** (`not_found`), while equities work.
- Root cause: the TASK 2–7 refactor's generic index resolution built `^NIFTY_50` / `^SENSEX` — neither is a real Yahoo ticker. Real ones: `^NSEI`, `^BSESN`, `^NSEBANK`, `^NIFTY_FIN_SERVICE`, `^INDIAVIX`, `^NSEMDCP50`, `^NSENEXT50`. Bonus finding: the TASK 7 instruments v2 rebuild dropped indices from `instruments.json` (search + deep links to indices break locally).
- **Fix applied**: `INDEX_MAP` in `marketData.ts` (verified tickers, generic fallback for unknown names) — uncommitted, tsc+lint clean.
- **Filed `docs/task-reports/TASK-UI-01.md`** for the data team: needs (1) a non-Yahoo index fallback (indices have NO fallback chain — equities have MC/Groww; Yahoo is throttled right now so index charts will still 404 until cooldown), (2) indices back in instruments.json.
- Verified equities unaffected: full 13-check e2e all-pass.

---

## 2026-08-16 — Session 5k: UI/UX cycle 25 — screen-reader readthrough

### Cycle 25 — aria-tree audit (Playwright aria snapshot)
- **Found**: the odometer rendered as garbled tokens to screen readers (digit-per-span, SR ignored the label). Fixed with the robust pattern: visuals `aria-hidden`, real text in an `sr-only` span. The price line now reads as a single clean node: `RELIANCE NSE INR 14 Aug 2026 ₹1,310.00 -7.00 -0.53%`.
- Full tree review: skip-link ✓, banner (clock, market status CLOSED + countdown) ✓, combobox ✓, watchlist buttons + remove labels ✓, h1 heading ✓, stats labels ✓, 52W marker img with aria-label ✓, sr-only chart summary ✓, range buttons with pressed state ✓, LIN toggle ✓, footer ✓.
- The trailing empty `alert` node is Chromium hoisting the polite live region (price announcement container) — correct semantics, kept.
- tsc + eslint + 13-check e2e all green.

---

## 2026-08-16 — Session 5j: UI/UX cycles 22–23 — stale chip + data-correctness surfacing

### Cycle 23 — surfacing the data team's fixes
- Data agent committed TASKs 2–7 (day-change vs `previousClose`, 52W correctness, Yahoo backoff + stale-while-revalidate, intraday fallback, error retry, instruments enrichment). Re-verified whole stack: tsc + eslint + 13-check e2e all-pass on the merged tree.
- **New `STALE` chip** in the chart header readout: surfaces the payload's new `stale` flag (was never rendered before) — neutral terminal styling (hairline + muted, tooltip "Press R to retry").
- **Verified in-browser** that the corrected data flows into the UI: RELIANCE badge `-7.00  -0.53%` (vs prevClose 1317, not first-vs-last candle), PREV CLOSE 1317.00, VOLUME 1.05 Cr, 52W 1250–1612, and the 52W position marker at 17% of band.

### Status
- Ticker tape still empty — Yahoo IP cooldown has held the whole session (backoffs up to ~15min per host, all protected). Click-through E2E remains the one pending live check; the code path is identical to the verified search pick.
- Worked alongside the data agent on shared files all session without collision (my `TickerItem` exchange/type addition survived their commits; merged the StatsRail `previousClose` refactor cleanly).

---

## 2026-08-16 — Session 5i: UI/UX cycle 21 — Modal focus management

### Cycle 21 — Modal component + focus traps
- New `src/components/Modal.tsx` — shared dialog shell used by BOTH the help modal and the mobile watchlist sheet (DRYs ~40 lines of duplicated overlay markup):
  - **Focus trap**: Tab/Shift+Tab cycle within the dialog; focus moves to the first focusable on open.
  - **Focus restore**: returns focus to the opener on close.
  - Escape-to-close, backdrop click-to-close, `role="dialog" aria-modal`, safe-area sheet variant.
- Verified with Playwright: help modal initial-focus/trap/Escape/restore; sheet trap in-bounds. Full 13-check e2e all-pass; tsc + eslint clean.

### Next
Cycle 22 — tape click-through E2E when Yahoo cooldown lifts (polling `/api/ticker`); Cycle 23 — continuous re-verification after data-agent merges.

---

## 2026-08-16 — Session 5h: UI/UX cycles 19–20 — interaction audit + session wrap

### Cycle 20 — interaction audit
- Chart gets an **sr-only screen-reader summary** (symbol, range, candle count, source, last close) — the canvas itself is otherwise opaque to AT.
- Help modal + mobile sheet **autoFocus the close button** on open (focus management start; full trap deferred).
- `metadataBase` set from `NEXT_PUBLIC_SITE_URL` (defaults localhost) — silences the build warning; prod URL will slot in at deploy (Phase E).
- **Production build verified**: `next build` clean (7 static pages + 3 dynamic API routes + icon). Note for Phase E: build output will deploy as-is.

### Session wrap — full UI/UX session 5 tally (cycles 1–20)
- **Design system**: WCAG contrast token pass (faint 2.21→3.95:1, muted→5.74:1), global terminal focus rings, caret color.
- **New components**: `MarketStatus` (IST session + countdown), `ErrorBoundary`, `DataTable` (screener-ready), `not-found` page, terminal favicon + OG image.
- **Interactions**: clickable ticker tape, J/K watchlist nav, `?` help modal, `L` log scale, `R` retry, 1–8 ranges, `/` search, `Esc` close, dblclick re-fit, deep links (`?s=&e=&r=`, incl. non-watchlist symbols), title sync, history back/forward.
- **Chart**: date-aware OHLC legend, last-price dashed line, loading skeleton (chart bars + price bar), 52W position marker in stats rail, LIN/LOG toggle (mobile too), reveal sweep.
- **Responsive**: mobile watchlist bottom-sheet (safe-area aware), 320px overflow fixes, readout compression, WL counter button.
- **A11y**: combobox/listbox search, aria-selected/pressed/current, skip-to-content, sr-only chart summary, reduced-motion honored (measured), 0 console errors.
- **Quality**: `tsc` + `eslint` clean every cycle; 13-check Playwright suite all-pass every cycle; `next build` clean.
- **Open items**: (1) tape click-through E2E pending Yahoo cooldown (items empty all session — backoff protecting the IP); (2) `metadataBase` wants the real prod URL; (3) modals lack full focus traps (next a11y cycle).

---

## 2026-08-16 — Session 5g: UI/UX cycles 17–18 — DataTable primitive + price skeleton

### Cycle 17 — price skeleton
- First-load price area shows a pulsing panel-2 skeleton bar (fixed `0.9em` height, `5.5em` width) instead of a bare `—`; existing price stays during symbol switches (continuity).

### Cycle 18 — DataTable primitive (TASK 22 dependency, built ahead)
- `src/components/DataTable.tsx`: generic, typed, **terminal-styled sortable table** for the Phase-D screener/backtest/alerts UIs. Features: tri-state sorting (`asc → desc → none`, verified; `aria-sort` on `th`), right-align + `sortValue` support, rank column (lime `01` badges), `render` cells, sticky headers, row selection (`aria-selected`), hover/active states, keyboard nav (↑↓/Home/End/Enter with scroll-into-view), loading + empty states, controlled or internal sort state.
- Exercised via a throwaway `/dev/table` route (10 rows, sort/keyboard/loading checks, 0 console errors) — **route deleted after verification** to keep the repo clean.
- Fixed two React 19 compiler-lint violations during development: `setState` in effect (solved by clamping active index during render) and `aria-sort` on a `button` (moved to `th`).

### Verified
- tsc + eslint clean; full 13-check e2e all-pass. Tape still empty (Yahoo cooldown persists — backoff doing its job).

---

## 2026-08-16 — Session 5f: UI/UX cycles 14–16 — detail polish + regression

### Cycle 14 — watchlist/status detail
- Watchlist provenance copy updated to the real chain: `DATA · YAHOO / GOOGLE / NSE / BSE`; footer keys now complete (`1–8 · R · J/K · L · ? · /`).
- Stats rail cells get a subtle `hover:bg-panel-2` tactility.
- Mobile WL sheet gets `bare` mode — the info footer is dropped inside the sheet (redundant there).
- **Double-click on chart re-fits the visible range** (terminal convention; listener cleaned up properly).
- Stale crosshair legend no longer lingers during symbol-switch loading (derived from `loading`, no extra effect — React 19 lint prefers derivation over setState-in-effect).
- iOS **safe-area inset** on the bottom sheet (`pb-[calc(...+env(safe-area-inset-bottom))]`).
- Help modal adds `TAPE · CLICK A TICKER TO OPEN` row.

### Cycle 16 — regression
- tsc + eslint clean; full 13-check Playwright e2e all-pass. Zero failed network requests on load. 320/390/768/1440px geometry clean.

### Status
- Yahoo IP throttle persisted the entire session (backoff self-heals); ticker tape empty → click-through E2E still pending live verification (code path identical to search pick). Market closed (Sunday) — MarketStatus correctly shows CLOSED + countdown to Monday 09:15.
- Working tree: 9 files modified, 5 new files (all UI). Data team on TASK-11.

---

## 2026-08-16 — Session 5e: UI/UX cycles 12–13 — search richness, mobile parity

### Cycle 12 — search result richness
- Dropdown rows now show `SYMBOL · NAME · SECTOR · INDEX` hints (e.g. `INFY INFOSYS LIMITED · Technology Services · NIFTY 50`) with the matched prefix **underlined + bolded**; added `indices?` to `SearchResult`.
- Full combobox semantics verified live (aria-activedescendant tracks keyboard nav).

### Cycle 13 — mobile parity + clipping fixes
- **LIN/LOG toggle now on mobile** — previously `hidden sm:flex` meant touch users had no log-scale access; readout is compacted on mobile (`298B · MONEYCONTROL`).
- Active-range underline was being clipped by the range row's `overflow-x-auto` (overflow-x computes overflow-y to auto) — fixed with `pb-1` on the row; geometry verified (button + 2px underline fully inside).
- Tape breathing room py-1 → py-1.5.
- Verified 320/390/768px: no horizontal overflow anywhere, log toggle visible.
- Zero failed network requests on load (no favicon.ico 404 — `icon.svg` covers it).

### Verified
- tsc + eslint clean; full 13-check e2e all-pass.

### Next
Cycle 14+ — continuous polish: watchlist index hover states, market-status edge polish, and re-verification of tape click-through when Yahoo cooldown lifts.

---

## 2026-08-16 — Session 5d: UI/UX cycles 9–11 — a11y pass, boundary, detail audit

### Cycle 9 — accessibility deep pass (Search)
- Proper **combobox/listbox semantics**: `role="combobox"` + `aria-expanded/controls/activedescendant` on input, `role="listbox"` + `role="option"` with `aria-selected` on results, `role="status"` on the "scanning" indicator.
- Skip-to-content link (sr-only → visible on focus, jumps to `#chart`).

### Cycle 10 — error boundary
- `ErrorBoundary` (class component) in root layout: terminal-styled `[!] FATAL` crash screen with RESTART button; local state (watchlist) survives.

### Cycle 11 — detail audit
- **52W range position marker** in the stats rail: `[——●——]` track showing where price sits in the 52W band (pure CSS, aria-label with % position). Verified: RELIANCE at 17% of band.
- Terminal **404 page** (`not-found.tsx`): big `404_` + RETURN TO TERMINAL, verified in-browser incl. navigation home.
- **OG image** `public/og.svg` (1200×630 terminal-branded) + twitter card metadata.
- Geometry audit: header 45px, aside fills viewport with pinned watchlist footer, chart 584px at 1440×900 — no scroll, no overflow. Grep audit: zero `backdrop-blur` remnants, zero stale color tokens.
- Fixed a merge collision: data agent's StatsRail `previousClose` refactor (payload field) vs my edits — reconciled to `data.previousClose`.
- Verified: tsc + eslint clean; full e2e all-pass (13 checks).

### Next
Cycle 12 — search result richness (sector/industry), then a fresh-eyes design review pass and further polish. Also worth noting: Yahoo tape has been throttled all session (backoff self-heals) — tape interactivity verified at code level, full click-through test pending upstream recovery.

---

## 2026-08-16 — Session 5c: UI/UX cycles 7–8 — interactivity, deep links, log scale

### Cycle 7 — interactive tape + keyboard nav
- **Ticker tape items are now clickable** → open that symbol's chart (extended `TickerItem` with `exchange`/`type` derived in `getTicker`; `tabIndex={-1}` on marquee buttons to keep Tab flow sane).
- **J/K step through the watchlist** (wraps around; excluded while typing in inputs). Documented in `?` help modal + footer.
- Error glyph: `⚠` emoji → terminal `[!]` in paper color.

### Cycle 8 — deep links, log scale, 320px fixes
- **Deep linking**: `?s=TCS&e=NSE&r=5y` restores symbol+range on load, incl. symbols NOT in the watchlist (resolved via the local instrument index — `resolveTarget` helper). URL now syncs via `history.pushState` only on user actions.
- **Race fixed (StrictMode)**: URL-sync effect's mount-time `replaceState` clobbered the deep-link URL before the initial-load effect's second pass read it (observed in dev server logs: TCS 5y fetched, then RELIANCE 1y on the same load). Fix: URL effect skips the first run (guarded by ref); popstate restore uses stable refs + `resolveTarget`.
- **Log/linear scale**: `L` key or LIN/LOG chip in the chart header toggles `PriceScaleMode.Logarithmic` — vital for MAX range. In help modal + footer.
- **320px width fixes**: header clock sheds seconds (`min-[420px]`) and `IST` suffix (`min-[540px]`); range button row got `shrink-0` + slimmer xs padding + `overflow-x-auto`.
- Title race (Cycle 4) re-verified working with deep links.

### Verified
- tsc + eslint clean; full Playwright e2e all-pass (13 checks incl. reduced-motion, mobile sheet, deep links TCS+TATAPOWER, log toggle).

### Next
Cycle 9 — accessibility deep pass (search listbox semantics), error boundary, then broader design polish review.

---

## 2026-08-16 — Session 5b: UI/UX cycles 3–6 — chart polish, keyboard, meta, QA

### Cycle 3 — chart polish (`ChartPanel`)
- Subtle **last-price line** restored (dashed, paper @ 22%, width 1) — the earlier removal was a defensive fix for bar-spacing, not the line itself.
- **Loading skeleton**: 34 deterministic pseudo-random panel bars pulsing with stagger + `> LOADING_` cursor line (aria-live). Empty state now also shows `PRESS / TO SEARCH`.
- Crosshair **OHLC legend shows the candle date** (IST, day+month, +time for intraday) — critical info on sparse daily charts.
- `aria-pressed` on range buttons; chart container aria-label.

### Cycle 4 — keyboard + state
- **`?` help modal**: terminal cheat-sheet dialog (keys / 1–8 R ? ESC), backdrop click + Esc close.
- **Document title syncs** with instrument: `RELIANCE · 1MO — NIFTY//TERM`. Debugging odyssey: Next's metadata manager re-applies layout `<title>` via DOM mutation **after** hydration (mutations at +724ms clobbered my effect's +644ms set; property-setter logging + MutationObserver proved it). Fix: re-assert title at 0/120/400ms and converge.
- **URL state**: `?s=&e=&r=` via `history.replaceState`; browser back restores symbol/range (`popstate`). Refactored `pick`/`changeRange` into `useCallback` (with `selectedRef` to keep memoized handlers fresh — React 19 lint forbids render-phase ref writes, so ref update moved to an effect).

### Cycle 5 — meta
- Terminal **favicon** `app/icon.svg`: lime block, black `N` + cursor block.
- `viewport.themeColor #0b0b0c`, `colorScheme dark`, OG tags, applicationName.

### Cycle 6 — QA (all pass)
- Playwright E2E: 0 console/page errors, market status renders, price + 6 stats cells, all 8 range keys return data (readout: `298 BARS · MONEYCONTROL · 1MO` on MAX), search-select flow, star toggle, title/URL sync, mobile WL sheet open/close, **reduced-motion kills all animation** (measured via computed styles — first e2e assert was buggy: counted the 0.01ms reduced-motion floor as motion; fixed to >100ms threshold).
- `tsc --noEmit` + `eslint` clean.

### Next
Cycle 7 — interactive ticker tape (click symbol → open chart), J/K watchlist nav, terminal error glyph instead of ⚠.

---

## 2026-08-16 — Session 5: UI/UX design head — design foundation pass (cycles 1–2)

Role assigned: **UI/UX/Design head**, continuous autonomous improvement. Each cycle = change → tsc+lint → Playwright DOM verify → log. (Note: a data agent works concurrently on `marketData.ts`; I stay off that file.)

### Cycle 1 — design foundations
- **Contrast fix (WCAG)**: computed exact ratios vs ink/panel. `faint #4a4a46` was **2.21:1** (fail), `muted #7a7a75` 4.30 on panel (borderline). Bumped → `faint #70706a` (3.95:1), `muted #8b8b84` (5.74:1). Chart price-scale text `#6f6f6a`→`#8a8a84`.
- **Focus rings**: global terminal-style `:focus-visible` outline in lime, ink-outline override on `bg-up` elements (watchlist selected row); lime caret on inputs.
- **New `MarketStatus` component**: IST-aware NSE session indicator in the header — `● OPEN` (lime, pulsing) / `● CLOSED` + countdown (`+7H 12M`), weekday-aware (Mon–Fri 09:15–15:30), 30s tick, tooltip with session hours.
- **Header declutter**: removed the duplicated ticker minis (the full tape sits right below the header) — header is now wordmark · clock · market status · NSE·BSE.
- Footer microcopy bumped 9px→10px; added `/ SEARCH` hint.

### Cycle 2 — mobile watchlist + a11y
- **Real UX gap fixed**: watchlist was desktop-only (`hidden lg:flex`). Added a mobile `WL·nn` button next to the search + **bottom-sheet dialog** (slide-up animation, backdrop dim, Escape close, body scroll lock, `role="dialog" aria-modal`).
- **Watchlist polish**: terminal row indices (`01 02 …`), `aria-current` on selected row, **inline import/export status** replaces `window.alert`.
- Crosshair OHLC legend: removed `backdrop-blur` (violates the no-glass design language) → solid `bg-ink/90`.

### Verified
- `npx tsc --noEmit` clean (data agent's in-flight Google-source work merged fine), `eslint` clean.
- Playwright DOM check: market status renders, mobile sheet opens/closes via Escape, **0 console errors/warnings**.
- Server restarted (my first nohup attempt died; `setsid` kept it alive).

### Next
Cycle 3 — chart polish (last-price line, loading skeleton, empty state); Cycle 4 — keyboard help modal + title sync; Cycle 5 — meta/favicon; Cycle 6 — full QA.

---

## 2026-08-16 — Session 4b: Fixes — timeframe sameness + bulky candles

### Bug: all timeframes showed the same chart
- Root cause: Yahoo IP-throttle forced everything to the Groww fallback, which hard-caps at 25 daily candles regardless of requested size/pagination (tested) — so 1M/3M/6M/1Y all rendered the same 25 bars, and 1D/5D errored leaving the stale chart.
- Fix 1: fallback chain is now **Yahoo → Moneycontrol → Groww**. Moneycontrol `priceapi` gives up to 300 OHLCV candles (1D/1W/1M; no intraday) with per-range windows (1M=25, 3M=70, 6M=130, 1Y=260, 5Y=260w, MAX=298m). Groww serves 1D/5D degraded daily windows (2/6 bars).
- Fix 2: failed fetches no longer wipe the existing chart — old data stays with an error banner.
- Verified: all 8 ranges return distinct candle counts (2/6/25/70/130/260/260/298) in live E2E.

### Bulky candles
- Adaptive `barSpacing` = clamp(containerWidth / candleCount, 1.5, 9) after every data set → slim bars at all zoom levels; disabled price line overlay.

### Other
- Chart header now shows terminal-style `N BARS · SOURCE · INTERVAL` readout.
- Data sources tested and rejected: BSE api (empty), Stooq (JS challenge), Finology (DNS dead), NSE (Akamai 403). Moneycontrol Akamai blocks are transient — chain retries next source.

---

## 2026-08-16 — Session 4: Scrum planning — 30-task roadmap

### Decisions made (scrum master = CTO/CDO)
- **Product thesis**: the 190-strategy jury research (RANKINGS.md) is the moat. NIFTY//TERM evolves from chart viewer → strategy-powered Indian market terminal: signals → screener → backtests → alerts → breadth → monetize (freemium).
- **Priority**: fix data correctness + reliability before features; strategy engine implements jury top-ranked strategies first (S100 momentum #1, S104 PEAD #2, S174/S172 TSM/dual #3/#5, quality trio #4/#7/#10, value family, S081 F-Score #9).
- **Architecture**: SQLite (better-sqlite3) + migrations, anon-first (device id) with later auth claim, Yahoo-via-curl with circuit breaker + stale-while-revalidate.
- **Tooling**: lint + `npx tsc --noEmit` mandatory per task; Playwright E2E + axe + Lighthouse in-repo; CI + Vercel deploy.
- Created `ROADMAP.md`: 30 tasks, 5 phases (A Stabilize 1–7, B Data platform 8–13, C Strategy engine 14–20, D Screener/Backtest/Alerts/Breadth 21–26, E Launch & growth 27–30), with acceptance criteria + dependency graph.
- Subagents will be assigned one task each; every task ends with LOG.md entry.

### Known bugs to fix first (in task 2)
- Day change computed as first-vs-last candle instead of vs previousClose (Yahoo meta has `previousClose`).
- 52W high/low faked from visible window on Groww/Moneycontrol fallback paths.
- Initial-load errors swallowed (no retry UI).

---

## 2026-08-16 — Session 3: NSE Data Research + React App (NIFTY//TERM)

### Data source research (first principles, live-tested)
- **Winner: Yahoo Finance** (free, no key): chart API works via curl but **429s Node's undici TLS fingerprint** → proxied through curl subprocess (execFile, no shell).
- NSE official API: Akamai 403 from this IP — rejected. Moneycontrol priceapi: flaky Akamai — rejected.
- **Groww public chart API**: works (daily/weekly/monthly, no intraday) → kept as fallback for equities.
- **Upstox CDN instrument masters** (free, public): built local search index of 5,949 NSE+BSE symbols (`src/data/instruments.json`, build script `scripts/build-instruments.mjs`). Search is local → zero upstream throttle risk.
- Ticker tape: Yahoo spark endpoint (chunked ×24) with 90s cache; tape hides when upstream throttles.

### App (web/)
- Next.js 16 + React 19 + Tailwind 4 + lightweight-charts 5 + JetBrains Mono / Archivo.
- **Design direction (user rejected v1 "AI slop" glass/cyan look)**: stark institutional terminal — paper-on-ink, acid-lime (#c6f534) up / red-orange (#ff5032) down, no glass, no gradients, no blue.
- Features: live NIFTY-50 ticker tape, odometer rolling price, crosshair OHLC legend, range keys 1–8, `/` focus search, keyboard nav, BSE→NSE auto-retry, reduced-motion + hydration-safe IST clock.
- Verified: lint + tsc clean; playwright E2E (hydration 0 errors, search-select, watchlist, range keys, mobile).
- Screenshots in `docs/inspiration/` (4 reference sites + 3 app shots).

### Known issues / next
- Yahoo throttle is IP-wide and bursts 429s; ticker tape self-heals (polls every 90s, hides when empty).
- Ticker depends on Yahoo cooldown lifting; NSE official APIs need a residential IP or proxy for richer India data later.

---

## 2026-08-16 — Session 2: Strategy Research + Model-Diverse Jury

### Final Jury Lineup (all isolated sandboxes, unaware of each other)
- juror-1: `opencode-go/hy3` (replaced glm-5.2, which never wrote output)
- juror-2: `opencode-go/gpt-5.6-luna`
- juror-3: `opencode-go/mimo-v2.5-pro` (replaced grok-4.5 — too slow, user aborted)
- juror-4: `opencode-go/kimi-k3`
- juror-5: `opencode-go/qwen3.7-max`
- internet agent: `opencode-go/minimax-m3` (web research; wrote table format instead of pipe format; skipped Sources section — noted)
- aggregator narrative: `opencode-go/qwen3.7-plus` (7th distinct model)

### Results
- `research/strategies.md`: 190 unique strategies, 22 categories, sourced from Wikipedia, Investopedia, Zerodha Varsity (partial - rate-limited), QuantInsti, academic literature.
- All 6 rankings validated: 190/190 unique IDs, ranks 1..190, no ties.
- Aggregation is deterministic (`scripts/aggregate_rankings.py`): final rank = ascending mean rank; consensus = std of ranks; mean edge score 1-10. No model in the math.
- Bug fixed during aggregation: tuple unpacking in enumerate loop bound `sid` to rank int instead of ID (KeyError S001).
- `RANKINGS.md`: full ranked table (190) + Top-20 detailed rationale.
- Top 3: Momentum Factor (JT), PEAD/SUE, Time-Series Momentum (MOP).
- `jury/consensus.json`: per-juror ranks for every strategy.

### Goal
- Research 100+ stock analysis strategies, rank them via a jury of isolated subagents running different opencode-go models (no shared knowledge), plus one internet-research agent; final aggregation into `RANKINGS.md`.

### Decisions made (with user)
- Jury: 5 model-diverse jurors + 1 internet-research agent + deterministic aggregation.
- Juror models: glm-5.2, gpt-5.6-luna, grok-4.5, kimi-k3, qwen3.7-max. Internet agent: minimax-m3.
- Rubric: rank ALL strategies by pure expected return/edge (1-10 score), India context allowed but edge is primary.
- Output: full ranked list + top 20 detailed rationale in `RANKINGS.md`.
- Aggregation math done by deterministic script (no model in the math).

### Phase 0 done
- Verified all 6 models respond via headless `opencode run` pings (all OK).
- Created directory structure: `research/`, `jury/juror-1..5/`, `jury/internet/`, `scripts/`.

---

## 2026-08-16 — Session 1

### Project Initialization
- `git init` — initialized empty Git repository on `master` branch.
- Created `LOG.md` — this file. It will be updated with every change made to the project.

### Project Scope
- Stock analysis project, currently focused on **Indian stock exchanges** (NSE, BSE).
- Scope will expand gradually to broader topics/features over time.

### Planned Direction (no commitments yet)
- Add features one by one; nothing decided yet.

---

## Rules for This Log
1. Add a new entry for every work session or significant change.
2. Use `## YYYY-MM-DD` headings, newest at the top.
3. Document what was done, why, and any decisions made.
