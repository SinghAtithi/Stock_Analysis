# ADR 0002 — eod_candles price lineage: normalize-on-write, adj_factor retired to reserve

**Status:** accepted · **Date:** 2026-08-23 · **Agent:** NOVA (TASK-26)
**Context:** TASK-15 verification proved the storage premise wrong: the ingest chain stores
*already split-adjusted* closes from Yahoo (empirically: raw series continuous across every
split; composing event factors injected 12 fake 100–950% cliffs — see
`docs/task-reports/TASK-15-adjusted-closes.md`). Meanwhile fallback vendors (Moneycontrol,
Groww) serve *raw* prices, and Yahoo silently re-bases its entire adjusted history after every
new corporate action. Three failure classes follow if writes are naive:

1. **Double adjustment** — multiplying source-adjusted prices by event-derived `adj_factor`.
2. **Re-base drift** — rows stored before a split sit on an older basis than rows appended after.
3. **Basis splicing** — fallback-vendor (raw) tail overwriting an adjusted head, or vice versa,
   at chain-switch boundaries.

## Decision

**One series per symbol, one basis — enforced empirically at write time.**

1. `eod_candles` holds a single coherent price series on the basis of its most recent ingest.
   The `c` column is the truth consumers read (`toAdjustedCandles()` remains the boundary).
2. Every write goes through `storeCandlesReconciled()` → `scripts/lib/basis.mjs::reconcileBasis()`:
   price the most recent *shared trading day* between stored and incoming. Ratio ≈ 1 (±0.5%)
   ⇒ same basis, plain upsert. Otherwise rescale **all** stored rows by that ratio onto the
   incoming basis before upserting. With no shared day, a seam check (>30% jump across the gap)
   catches stitched bases conservatively.
3. This replaces the event-driven `recomputeAdjFactors()` rebuild, which is **retired from the
   live path** and kept only as tested reference code for a future true-raw design. It assumed
   raw storage — a premise this codebase never satisfied. The `adj_factor` column stays at 1
   (33,520 corrupt rows were reset in TASK-15) and must not be multiplied into consumer math.

## Why not the alternatives

- *De-adjust on write (materialize true raw):* requires dividing history by cumulative future
  ratios on every fetch, depends on complete corporate-actions coverage (Yahoo events miss
  demergers; NSE lists cap at ~20 rows), and still needs re-normalization whenever events
  arrive late. Empirical reconciliation needs none of that — it measures the actual bytes both
  sides carry.
- *Land a raw vendor now:* no keyless Indian EOD vendor with deep history was identified in
  `docs/data-sources.md`; MC/Groww raw + our own factor rebuild reintroduces exactly the
  event-coverage fragility above. Revisit post-launch (TASK-28 cron makes re-runs cheap).

## Consequences

- Incremental Yahoo ingests self-heal re-base drift on the next run after any split.
- Chain switches MC↔Yahoo can no longer splice cliffs; worst case the seam heuristic rescales
  on a genuine data error, which the CI sweep then surfaces.
- `scripts/tests/eod-cliff-sweep.test.mjs` gates every suite run: zero >40% single-day moves
  across all stored series (skips when DB absent/thin so fresh clones stay green). Any hit means
  bases were spliced — re-run ingest with reconciliation.
- Consumers need no changes: `run-signals`, `run-backtest`, breadth all read through the same
  boundary; scores are ratio-based and immune to which basis the series sits on.
