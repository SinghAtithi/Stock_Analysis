# TASK-1415 — Smart-money radar: block/bulk deals + insider trades + promoter pledges wired to S113/S122/S107

**Status:** built · **Agent:** VERTEX · **Date:** 2026-08-29

## What shipped

Daily ingest (`scripts/ingest-smart-money.mjs`) → `smart_money_feed` +
`smart_money_status` (migration `db/migrations/0004_smart_money.sql`) →
`GET /api/smart-money` → `/radar` page. All 5 ACs covered; live network
verified from the sandbox — this task did **not** need the fixture-only
fallback path.

## AC status

1. **Daily ingest, documented sources — DONE.** NSE official publication
   endpoints, keyless:
   - Bulk deals: `/api/historicalOR/bulk-block-short-deals?optionType=bulk_deals&from=&to=` (200, real rows live)
   - Block deals: same, `optionType=block_deals` (200, real rows live)
   - Insider (SAST) + promoter pledge: `/api/corporate-announcements?index=equities` (rolling ~20; keyword-filtered, live-verified). ToS/rate limits/verdicts in `docs/data-sources.md` §11 (new). Dead ends documented: old `/api/bulk-deals`, `/api/merged-daily-reports?key=*`, BSE `BulkDealsData/w`.
   - House style: partial failure exits 0 with summary, per-source daily cache in `data/raw/smart-money/` (deals are whole-feed fetches, so the cache is per-day per-source rather than per-symbol — the honest analogue), `HostBackoff` on 429 (parks `www.nseindia.com`, never trips the breaker), circuit breaker after 3 consecutive non-throttle failures, `--limit/--force/--days/--no-announcements`, freshness skip.
   - Real run today: `fetched 140 (70 bulk + 70 block), announcements healthy-empty (Saturday)`.
2. **Feed grouped by symbol with buyer/seller, qty, value — DONE.** API returns `{ groups: [{symbol, securityName, items:[{kind, buySell, client, qty, price, value, tradeDate, source, desc, strategy}]}], meta }`; UI renders one card per symbol, rows per event; ₹ values computed at ingest (`qty × trade price`), mono tabular numerals.
3. **Jury mapping S113/S122/S107 — DONE, honest per RANKINGS.md.** Local to `web/src/lib/smartMoney.ts` (strategies/ registry untouched): `bulk_deal`/`block_deal` → **S113** Block/Bulk Deal Following (#46); `insider` → **S107** Buybacks & Insider Buying (#18); `pledge` → **S122** Promoter Buying Follow (#25). Chips: `S113 · bulk`, `S113 · block`, `S107 · insider`, `S122 · pledge`. Caveat documented: pledge *release* is the bullish promoter event, pledge *increase* is cautionary — both stay tagged S122 (promoter-ownership event) with direction visible in row text.
4. **Alert on new deal — DONE (existing pipeline, no new type).** One-tap "Alert on deal" per deal row → `POST /api/alerts`. The pipeline evaluates only price crosses + strategy membership — there is no "new event" lane, and a new type would be silently never-fired. So the button POSTs the **existing `price_above` type priced at the deal's execution price** — it fires on confirmation above the deal price (the S113 follow entry). SAST/pledge items carry no trade price → button disabled with an honest title. Verified end-to-end: probe clicked the button → alert created in the real pipeline (`{symbol, exchange:"NSE", type:"price_above", price}`), validator-tested in `scripts/tests/smart-money.test.mjs`. Probe artifact deleted from the DB afterwards.
5. **Blocked-source empty state — DONE.** `smart_money_status` records per-source health; a hard refusal (`403/404/5xx`, non-throttle) → `ok=0, blocked=true` → UI shows "Source blocked/offline — data unavailable today" (mirrors /calendar empty-state styling). Healthy-empty (weekend / no filings) shows "No smart-money activity recorded yet" instead — the two are distinguished.

## Files

- `db/migrations/0004_smart_money.sql` — feed + per-source status tables
- `scripts/ingest-smart-money.mjs` — ingest (fetch layer, parser, idempotent upsert, backoff/breaker)
- `scripts/tests/smart-money.test.mjs` — 18 tests: parser, classifier (incl. trading-window boilerplate false-positive regression), idempotency, mapping vs RANKINGS.md, alert payload through the real validator, blocked-status contract
- `scripts/tests/fixtures/smart-money/{bulk_deals,block_deals,announcements}.json` — real 2026-08-29 payloads
- `web/src/lib/smartMoney.ts` — read model + jury mapping + alert payload builder
- `web/src/app/api/smart-money/route.ts` — GET, rate-limited per-key (takeToken), readonly sqlite, meta contract
- `web/src/app/radar/page.tsx` — /radar UI (watchlist/all tabs, chips, alert button, blocked/stale/empty states)
- `scripts/tests/ui/radar.py` — playwright probe (12 checks)
- `docs/data-sources.md` §11 — source docs, ToS, rate limits (AC1)
- this report

## Verification

- `cd web && npx tsc --noEmit` — clean.
- `npx eslint` on the 3 new web files — clean.
- `npm test` — 423 tests, 421 pass, 0 fail, 2 skipped (pre-existing network-gated skips; count unchanged with/without this task's files).
- Playwright probe on the running :3214 dev server (see caveat): 12/12 PASS incl. a real alert POST (row visible as "Alert set"). Probe uses /radar directly — nav wiring not added (see caveats).

## Caveats

- **Server note:** `next dev -p 3212` refused to start — Next 16 holds a per-project dev lock held by another agent's live server (PID 632353 on :3214). Per the no-touch rule I did not kill it; the probe ran against :3214 (same working tree, read-only GETs + one alert POST which was cleaned up). A future run should verify on a fresh server once the lock frees.
- **Nav:** `/radar` is reachable by URL only — `SiteHeader.tsx` is another agent's live WIP and was not touched. Nav wiring is a follow-up.
- **Alert semantics:** as decided above, the alert is `price_above` at the deal price (the only lane the pipeline evaluates). A true "new deal appeared" event alert would require a new evaluation lane in the pipeline — out of scope per "reuse, don't redesign".
- **Announcements feed is a rolling ~20-row window**: a missed day means missed SAST/pledge filings. Daily polling is the mitigation; a deeper archive (NSE filing history) is future work.
- **Pledge direction** (increase vs release) is surfaced as raw announcement text, not parsed into a signed metric — parsing is future work if S122/S121 scoring wants it.