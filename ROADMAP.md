# ROADMAP — 30-Task Backlog (NIFTY//TERM)

Owner: scrum master (acting CTO/CDO). One task per subagent assignment. Order = priority.
Phases: A Stabilize (1–7) → B Data platform (8–13) → C Strategy engine (14–20) → D Screener/Backtest/Alerts/Breadth (21–26) → E Launch & growth (27–30).

Product thesis: the 190-strategy jury research (RANKINGS.md) becomes the product moat. The app grows from a chart viewer into a strategy-powered Indian market terminal: implement the top-ranked strategies as signals → screener → backtests → alerts → breadth → monetize.

Every task must end with: `npm run lint` + `npx tsc --noEmit` clean in `web/`, a `## 2026-08-XX` entry appended to LOG.md, and (when behavior changes) a screenshot or CLI output pasted into the session report.

Read `web/AGENTS.md` + `web/node_modules/next/dist/docs/` before touching Next.js code (v16 breaking changes).

---

## Phase A — Stabilize (1–7)

### TASK 1 — Commit pending work, repo hygiene
- Inspect `git diff` for `web/src/app/page.tsx`, `web/src/components/ChartPanel.tsx`, `web/src/lib/marketData.ts`, `web/src/lib/types.ts`.
- Run lint + tsc; fix anything failing. Commit with a message matching repo style (`feat(web): …`).
- Confirm `.next/`, `out/`, `build/`, `node_modules/`, `*.tsbuildinfo`, DB files are gitignored (root + web).
- AC: clean `git status`, green lint/tsc, LOG.md entry.

### TASK 2 — Fix day-change & 52W correctness bugs (CRITICAL)
- `marketData.ts`: Yahoo payload — `change`/`changePct` must be `regularMarketPrice − meta.previousClose` (not first-vs-last candle). Add `previousClose` to `ChartPayload` + `ChartData`.
- Groww/Moneycontrol payloads: derive previous close from the prior **trading session** candle (compare calendar dates, not array position). If unavailable → `change: null`.
- 52W high/low: for fallback sources only report when the fetched window covers ≥250 sessions; else `null` (never fake with window min/max).
- StatsRail: PREV CLOSE cell uses `previousClose`; header badge uses day change.
- AC: 3 symbols verified vs exchange official day change (±0.2%); 1D/5D ranges show correct day change.

### TASK 3 — Yahoo throttle resilience + stale-while-revalidate
- Replace single `yahooCooldownUntil` with per-host exponential backoff + jitter (60s → cap 15min), shared circuit breaker, and a concurrency limiter (max ~2 in-flight curl calls to Yahoo).
- Cache: on upstream failure serve stale payload (mark `stale: true` in response) instead of 404/error.
- Log every 429/backoff decision to server console with host + backoff duration.
- AC: unit-testable state machine (mock fetch); with circuit open the ticker API still returns stale data; no request burst when circuit closes.

### TASK 4 — Intraday (1D/5D) fallback chain
- Research + live-test from this IP via curl: Google Finance embedded JSON (`google.com/finance/quote/<SYMBOL>:NSE`), TradingView symbol search/market data, AngelOne/Upstox public market-data endpoints.
- Pick the best verified source; add as fallback after Yahoo for `1d`/`5d` ranges in `getChart`. If nothing verifies: degrade 1D/5D to daily candles with a `DAILY` badge in ChartPanel.
- Document verdict + ToS note in `docs/data-sources.md` (create) and LOG.md.
- AC: with Yahoo blocked, 1D/5D still render data or a clearly-badged daily fallback — never a dead end.

### TASK 5 — Initial-load error UX + retry + staleness
- `page.tsx` initial load currently swallows errors. Show the same error banner as `load()`, plus a RETRY button (and `R` key).
- Show data staleness: `timeAgo(regularMarketTime)` next to the source badge (format.ts already has `timeAgo`).
- Add `aria-live` to error/loading regions.
- AC: with network killed, app shows error + retry; retry recovers; banner disappears on success.

### TASK 6 — Watchlist persistence (localStorage, anon-first)
- Star toggle in the symbol header; sidebar watchlist becomes editable (add via star, remove via ✕ on hover/context).
- Persist to `localStorage` (`niftyterm.watchlist` = array of `{symbol,exchange,type,name}`); default seeds = current QUICK_PICKS; `storage` event syncs across tabs; export/import JSON buttons in sidebar footer.
- AC: add/remove survive reload + across tabs; mobile still usable (star in header works there).

### TASK 7 — Instruments enrichment v2 (sector, industry, index membership)
- Extend `scripts/build-instruments.mjs` to merge sector/industry (best verified source: Groww search API, NSE sector files, or Yahoo quoteType batch) and index membership flags (NIFTY 50 / NIFTY 500) into `instruments.json`.
- Bump schema: add optional `sector`, `industry`, `indices[]`. Keep old consumers working.
- `SearchResult.sector` populated; show sector in search dropdown rows.
- AC: ≥80% sector coverage for Nifty 500 names; build script documented in its header; `npm run build-instruments` re-runnable (add npm script).

## Phase B — Data platform (8–13)

### TASK 8 — DB layer: SQLite + migrations + schema v1
- Add `better-sqlite3` (+ `@types`), `scripts/migrate.mjs` runner, `db/migrations/` with SQL files.
- Schema v1: `instruments`, `eod_candles(symbol,ts,o,h,l,c,v,adj)`, `quotes`, `fundamentals(symbol,key,value,fetched_at)` or typed columns for v1 metrics, `analyst_data`, `signal_snapshots(strategy_id,symbol,score,rank,components,as_of)`, `watchlists`, `alerts`, `backtest_runs`, `breadth_series`, `corporate_actions`.
- DB file gitignored; `npm run db:migrate` idempotent; fresh-clone works.
- AC: migrate from empty DB → all tables; re-run = no-op; `sqlite3` CLI inspect shows schema.

### TASK 9 — EOD candle store + universe ingest
- `scripts/ingest-eod.mjs`: for the Nifty 500 universe (task 7 membership; fallback Nifty 50), fetch daily history from Yahoo via the task-3 curl path, upsert into `eod_candles` with adjusted OHLCV; incremental daily top-up; idempotent.
- Rate-limit aware (respect circuit breaker); resumable (skip symbols already current).
- AC: Nifty 50 full history ≥10y in DB; re-run takes <2min and changes nothing; log line per symbol count.

### TASK 10 — Fundamentals pipeline v1 (Yahoo quoteSummary)
- `scripts/ingest-fundamentals.mjs`: quoteSummary modules `defaultKeyStatistics, financialData, incomeStatementHistory, balanceSheetHistory, cashflowStatementHistory, earningsHistory, summaryProfile` via curl; normalize + upsert.
- Store the raw-json + typed derived metrics: PE, PB, PS, EV/EBITDA, ROE, ROA, ROIC proxy, debt/equity, current ratio, FCF, grossProfit/assets, accruals inputs (ΔNOA, assets), EBIT/EV, earnings yield, dividend yield, market cap.
- AC: derived metrics for all Nifty 50 names present; spot-check 3 against moneycontrol/screener values (±5% tolerance on ratios).

### TASK 11 — India data-source decision doc + corporate actions
- Re-test NSE/BSE official endpoints (XBRL filings, bhavcopy, FII/FII data) from this IP + evaluate cheap proxy options. Produce `docs/data-sources.md`: endpoint, verdict, rate limits, ToS risk, fallback.
- Implement `corporate_actions` store from Yahoo events (splits/bonus/dividends); apply split factors so `eod_candles` stays adjusted; expose `adjusted` flag.
- AC: doc complete; adjusted series verified against a recent real NSE split/bonus.

### TASK 12 — Analyst data pipeline (feeds S105)
- `scripts/ingest-analyst.mjs`: `recommendationTrend`, `earningsTrend` (revision direction 7/30/90d), `financialData.targetMeanPrice` for universe → `analyst_data`.
- AC: Nifty 100 coverage; revision-direction + rating + target fields queryable; fetched_at stamped.

### TASK 13 — Breadth & flows pipeline (feeds S126/S127)
- Daily collection: India VIX (`^INDIAVIX`), advance/decline (NSE bhavcopy if reachable, else derive from universe EOD), 52W high/low counts, FII/DII flows (verify CDSL/NSE published data or a mirror; document if blocked).
- Store in `breadth_series`; expose `GET /api/breadth` (vix, ad_ratio, fii_dii 30d series, breadth counts).
- AC: 1y of VIX + A/D stored; `/api/breadth` returns JSON; blockers documented in LOG.md + docs/data-sources.md.

## Phase C — Strategy engine (14–20)

### TASK 14 — Strategy framework + registry + scheduler
- `web/src/lib/strategies/`: `types.ts` (Strategy meta: id, name, RANKINGS.md rank, category, universe filter, inputs, `compute(ctx) → Signal[]`), `registry.ts`, `run.ts` (one-shot `npm run signals:run [ids]`), result → `signal_snapshots`.
- Signal = `{symbol, score 0-100, rank, components{}, asOf}`.
- Two demo strategies (e.g., ROC-20, 52W-low distance) with unit tests on fixture candles.
- AC: `npm test` green; `signals:run` writes snapshots; registry lists strategies with jury ranks.

### TASK 15 — S100 Momentum Factor (12-1) ★ jury rank #1
- 12-month minus 1-month return on universe from `eod_candles`; percentile score; monthly+weekly snapshot; skip stocks with <200d history; log universe count.
- AC: top-10 momentum list sanity-checked against a public momentum screen (3 overlapping names at minimum, manual check in report).

### TASK 16 — S172 Dual Momentum + S174 TSM (asset-level) ★ ranks #5/#3
- Track NIFTY, SENSEX, GOLDBEES (gold), LIQUIDCASE proxy vs 200D MA → absolute momentum (risk-on/off) + relative momentum rank → one signal row per asset.
- AC: for 2 historical dates, computed signal matches manual calculation from the same data.

### TASK 17 — S104 PEAD/SUE ★ rank #2
- SUE = (actual EPS − consensus estimate)/estimate std (fallback: YoY surprise); sources: task 10 earnings + task 12 estimates; emit signal on earnings event + drift window (60d) membership.
- AC: last quarter's universe earnings scored; the 3 biggest beats rank top-10; snapshot persisted.

### TASK 18 — Quality trio: S096 Gross Profitability + S102 RMW proxy + S095 Accruals ★ ranks #4/#10/#7
- Compute grossProfit/assets, operating profitability, accruals (ΔNOA/assets) from fundamentals history (current vs prior year).
- Composite quality score (equal-weight z-scores) → snapshots.
- AC: hand-verify 3 companies against their annual reports (show working in report).

### TASK 19 — Value family: S099 HML + S076 Net-Net + S078 Low P/E + S080 Magic Formula ★ ranks #8/#15/#29/#12
- Book/market, NCAV/mktcap, earnings yield, EBIT/EV + ROIC rank (Magic Formula).
- Composite value score → snapshots.
- AC: hand-verify 3 companies; Magic Formula top-10 cross-check vs a public screener list.

### TASK 20 — S081 Piotroski F-Score ★ rank #9
- 9 criteria from 2 years of fundamentals (ROA, CFO, ΔROA, accrual, Δleverage, Δcurrent, dilution, Δmargin, Δturnover) → 0-9 → percentile score.
- AC: 2 companies hand-checked vs published F-scores; snapshot persisted.

## Phase D — Screener, backtest, alerts, breadth UI (21–26)

### TASK 21 — Signals API
- `GET /api/signals?strategy=S100&limit=50&sector=IT&sort=score` from `signal_snapshots` joined with instruments (name/sector) + latest quote (price, day change); cache 60s; freshness header (`as_of`).
- Validate strategy id against registry; return 404 for unknown.
- AC: curl-verified; response <300ms cold.

### TASK 22 — Screener UI
- New `/screener` route (terminal styling): strategy picker (rank badge from RANKINGS.md, edge score), results table (rank, symbol, name, sector, score, components, price, day change) sortable/filterable, keyboard nav, row click → `/` chart with symbol preselected (query param `?s=RELIANCE&e=NSE&t=Equity` — page.tsx must consume it).
- Mobile: table → cards.
- AC: desktop + mobile flows verified; deep-link from screener row opens chart.

### TASK 23 — Backtest engine v1
- `web/src/lib/backtest/`: long-only, daily bars from `eod_candles`, top-N monthly rebalance, costs (brokerage 0.05%, slippage 0.1%, STT configurable), benchmark = NIFTY buy&hold.
- Metrics: CAGR, Sharpe, Sortino, maxDD, hit rate, turnover, exposure. Output JSON + run row in `backtest_runs`.
- CLI: `npm run backtest -- --strategy S100 --universe nifty100 --start 2018-01-01`.
- AC: unit tests for metrics; S100 on Nifty 100 (2018→now) runs <60s with sane stats; report includes an equity-curve CSV.

### TASK 24 — Backtest UI
- `/backtest` route: form (strategy, universe, period, cost presets) → async job (poll run status) → results: equity curve + drawdown (reuse lightweight-charts), metrics table vs benchmark, run history saved.
- AC: end-to-end in browser; a long run shows progress; refresh keeps history.

### TASK 25 — Alerts: price + signal
- Anonymous device-id scoped `alerts` table (auth in task 27 will claim them): price alerts (cross above/below/±%) + strategy-entry alerts (top-10 membership change).
- API CRUD `/api/alerts`; evaluation loop (90s interval route `GET /api/alerts/evaluate` + a lightweight in-app notifier; email via Resend only if `RESEND_API_KEY` env set, else log).
- UI: bell icon → alert center (list, dismiss), create dialog from symbol header.
- AC: a real price cross fires an in-app notification within 2 polls; alert persists across reloads.

### TASK 26 — Breadth dashboard `/breadth`
- From task 13 API: A/D ratio line, VIX gauge + 1y spark, 52W high/low counts, FII/DII flows 30d bar chart, terminal styling, empty states when sources blocked.
- AC: renders with real data; links from footer.

## Phase E — Launch, quality, growth (27–30)

### TASK 27 — Auth + user-scoped data
- Auth.js: Google + magic-link email. Users table; on first login, claim anon device data (watchlist/alerts/backtests).
- Session check on mutation APIs; read APIs stay public (anon OK).
- AC: login/logout; anon → login migration preserves watchlist; unauthorized mutations 401.

### TASK 28 — CI/CD + deploy + monitoring
- GitHub Actions: lint, tsc, build, (unit) tests; Vercel project + env vars + cron (`ingest-eod` daily, `signals:run` daily, `alerts/evaluate` 90s — Vercel cron min 1min, use 1min or an external scheduler if needed).
- Sentry server + client error tracking; uptime ping (UptimeRobot); docs/deploy.md with runbook.
- **Amended per ADR 0001 (`docs/adr/0001-deploy-readiness.md`, TASK-08):** ingest/alert crons run as GitHub Actions schedules first (curl-guaranteed runner images) before any Vercel-cron migration · edge-level rate limiting replaces per-instance buckets at launch · board API/page gated behind `NIFTY_BOARD_ENABLED` and excluded from prod · CI copies `db/data/app.db` into the bundle with `outputFileTracingIncludes` for `/api/signals`.
- AC: green CI badge on PR; production URL serving chart + screener with live data; a thrown test error appears in Sentry.

### TASK 29 — Playwright E2E suite + perf/a11y
- In-repo E2E (web/e2e/): load, search+select, ranges 1–8, watchlist add/remove, screener, backtest, breadth, mobile viewport, hydration-zero-errors.
- axe a11y audit (contrast, focus, labels); Lighthouse perf ≥90 desktop with report artifact; wire E2E into CI.
- AC: `npm run e2e` green locally + in CI; audit reports committed to docs/audits/.

### TASK 30 — Landing, legal, analytics, README
- Public landing page (above-the-fold value prop, screenshots from docs/inspiration), OG images, per-symbol share cards (`/s/<symbol>` OG route).
- `/disclaimer` (SEBI-safe: research tool, NOT investment advice), `/privacy`, `/terms`, pricing stub (free: charts/search; pro: full screener/backtests/alerts).
- Analytics: Umami (self-host or cloud) events: search, symbol view, strategy view, backtest run; feedback widget (GitHub issues link or form).
- README.md: architecture diagram, data sources, how to run everything; final LOG.md entry.
- AC: pages live; analytics dashboard shows test events; README lets a fresh dev run the full stack.

---

## Dependency graph (assignable order)
- Phase A: 1 → (2,3,4,5,6,7 parallel)
- Phase B: 8 → (9,10) after 7; 11,12,13 after 8 (13 needs 9's universe)
- Phase C: 14 after 8/9 → (15,16) after 14+9 → (17–20) after 10/12
- Phase D: 21 after 15–20; 22 after 21; 23 after 9; 24 after 23; 25 after 8; 26 after 13
- Phase E: 27 after 6/25; 28 after 24; 29 after 22/24/26; 30 anytime, best last
