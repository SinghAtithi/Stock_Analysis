# TASK-17 — S104 PEAD / SUE (jury rank 2)

Status: COMPLETE (2026-08-16)
Files: `web/src/lib/strategies/strategies/s104-pead.ts` (created, self-registering),
`scripts/tests/s104.test.mjs` (created), this report.

## Signal design

- **SUE** = (actual EPS − consensus)/estimate-std. actual + consensus from the
  most recent `earningsHistory.history[0]`; consensus falls back to analyst
  `revisionTrend.epsEstimate.avg` when the quarter estimate is missing. Yahoo
  does not report estimate dispersion, so std is approximated from the
  cross-analyst range: **std = (high − low) / 4** (range ≈ ±2σ under normality).
- **Fallback** (estimates/std missing): YoY EPS surprise from the history entry
  whose quarter-end is 330–400 days earlier.
- **Drift**: event = `reportDate` (epoch s, auto-converted to ms). If ≤ 60 days
  old, post-event return % from candles (`drift60d`); direction confirms the
  signal. Events older than the window are faded to 0.6× base, drift = null.
- **Score transform** (documented in the module header): SUE clamped to ±3σ
  (≈99.7th percentile band of a standard normal — hence percentile-ish) →
  `score = 50 + 50·(SUE/3)` (+3σ⇒100, −3σ⇒0, 0⇒50). In-window: `0.8·base +
  0.2·confirm` (confirm 100/0 by drift sign). Fallback maps surprisePct over
  ±100% identically.
- **Null policy**: no data getters, no history, no consensus AND no year-ago
  comparator → null. Never throws (candle fetch wrapped in try/catch).

## Fixture shapes (copied verbatim from the ingest scripts)

- Fundamentals: `module_json` `earningsHistory` module — `{history:[{quarter,
  epsActual, epsEstimate, epsDifference, surprisePercent, quarterEndDate,
  reportDate, estimateCount} as {raw,fmt}], maxAge}`; `metrics_json` wrapper
  and raw DB-row `{module_json, metrics_json}` tolerated.
- Analyst: `derived_json` from `flattenDerived()` — `revisionTrend.epsEstimate
  {avg, low, high, yearAgoEps, numberOfAnalysts, growth}` + the full
  rating/target block (keys copied exactly).

## Verification

- **Tests**: 12/12 pass (`s104.test.mjs`), incl. hand-computed SUE: actual
  12.5, consensus 10, std (13−8)/4 = 1.25 → SUE = 2.0, score 86.67 (83.33 base
  + 20 up-drift confirm). Full suite at commit time: 129/136 pass — the 7
  failures were the concurrent agent's in-progress s172-s174 tests, unrelated.
- **tsc/lint**: my file clean; remaining tsc errors are in concurrent agents'
  in-progress files (quality.ts, s099-value.ts, s172-dual.ts). eslint on
  s104-pead.ts: 0 problems.
- **Real run** (real DB: fundamentals=0, analyst_data=0, eod_candles=135090):
  50/50 NIFTY 50 symbols → null, 0 thrown, **exit 0**.

## Blockers

None for S104 itself. Yahoo throttle still prevents live payloads; the T17 AC
("universe earnings scored, biggest beats rank top-10") needs ingest recovery +
runner wiring (runner/registry owned by the framework agent; S104 is
self-registering so it activates on import).

## Note on concurrency

Mid-session, another agent's git operation transiently removed untracked files
(including s104-pead.ts / s104.test.mjs); they were re-verified on disk and the
test suite re-ran green before commit.
