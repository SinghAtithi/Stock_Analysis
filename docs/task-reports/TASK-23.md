# TASK-23 — Backtest engine v1 (long-only, monthly rebalance)

**Owner**: quant engineer · 2026-08-16

## Engine (`web/src/lib/backtest/engine.ts`)
Erasable-only TS (Node strip-types safe), pure — no DB, no I/O. Inputs: `Map<symbol, Candle[]>` (seconds or ms timestamps auto-detected), a `Scorer` interface (`score(symbol, asOf) → number|null`), and a config `{topN, rebalance:"monthly", startDate, endDate?, costPct, slippagePct}`. Two scorer implementations, no engine change needed to swap:
- `SnapshotScorer` — pure lookup over preloaded `signal_snapshots` rows; latest `as_of <= rebalance date` (binary search, boundary-inclusive). Used by the CLI (T15's real runs use the same path).
- `StrategyScorer` — live compute from a registry strategy via a per-`asOf` `makeContext` factory (point-in-time candles), one context cached per rebalance date so cross-sectional distribution caches work. This is the T15+ hook.

Conventions: rebalance executes at the **close** of the first trading day of the month (as-of = UTC midnight of that date, seconds); turnover = gross one-way traded fraction (max of buys/sells, full rotation = 1.0); cost = turnover × (costPct + slippagePct), deducted from equity on the rebalance day; no snapshot → hold prior portfolio; never-formed portfolio → cash (flat equity); a symbol must have a price on the rebalance date to be holdable (unlisted symbols skip). Benchmark = buy-and-hold equal-weight universe: fixed 1/N over symbols priced on the first window day, forward-filled closes, pre-window close anchors day 0 (so the benchmark captures one extra day vs the strategy — by design, documented in tests).

## Metrics (`metrics.ts`)
NaN-safe: every ratio nulls on missing/degenerate inputs. CAGR = (V_end/V_0)^(1/years)−1, years = calendar days/365.25; ann. vol = sample std × √252; Sharpe = (mean×252 − rf)/annVol with **rf = 6.5% annual (India context: 10y G-sec anchored)**; Sortino uses downside deviation over zero target; maxDD with peak→trough dates (worst point wins, ties earliest); hit rate = % of calendar months with positive compounded return; annualized turnover = gross one-way traded per year; exposure = % of trading days with ≥1 position.

## CLI (`scripts/run-backtest.mjs`)
Same strip-types + resolve-hook pattern as run-signals.mjs. Args: positional/`--strategy`, `--universe nifty50`, `--top` (default 20), `--start` (default 2018-01-01), `--end`, `--cost` (0.15% default), `--slippage` (0.05%). Resolves universe from instruments.json (bare → `.NS` mapping) intersected with eod_candles symbols; loads candles (with pre-window lookback) + snapshots; prints metrics table (strategy vs benchmark), trades summary, equity head/tail; persists `backtest_runs` row (config_json, status, metrics_json incl. both curves, equity_json, timestamps). Exit 0; errors exit 1.

## Smoke run (fixture data — pipeline proof)
The DB had **zero** snapshots (reset since T14), so I re-ran T14's `--fixtures` scheduler (100 rows, as_of today) **and** seeded 103 monthly historical fixture snapshots (2018-01→2026-07) with a throwaway script that exercises the real `demo-roc20` code path against deterministic synthetic candles (per-symbol+asOf seeds → monthly rotation). A real S100 run later needs zero code changes.

```
node scripts/run-backtest.mjs demo-roc20 --universe nifty50 --top 20 --start 2018-01-01
engine: 2136 trading days, 104 rebalances, 432ms
  metric        strategy     benchmark
  CAGR             +18.23%     +17.30%
  Ann. vol         +17.86%     +16.76%
  Sharpe             0.680       0.665
  Sortino            0.943       0.914
  Max drawdown     -36.93%     -37.93%   (peak 2020-01-17 → trough 2020-03-23)
  Hit rate         +59.62%     +67.31%
  Total return    +323.25%    +295.48%
  Turnover/yr     +695.22%  -
  Exposure        +100.00%  100.00%
run persisted: backtest_runs.id=cd0f3300-b4df-48ce-8d3a-0735ae4f8531 status=completed
```
(Synthetic scores over real prices — the edge is a fixture artifact, not alpha. With only today's snapshots the engine correctly stays in cash until the first qualifying as_of — covered by tests.)

## Test results
`npm test`: **145 pass / 0 fail** (9 new backtest tests: hand-computed CAGR/Sharpe/Sortino/maxDD incl. leap-year day count, maxDD peak/trough dates; engine topN selection + turnover cost + buy-and-hold benchmark on a 2-symbol synthetic universe with hand-verified equity; zero-cost isolation; topN=universe ≈ benchmark; snapshot as_of-boundary lookup; NaN-safety: empty inputs, zero variance, no-signal cash, empty universe, NaN candles).

## Verification & blockers
- `npx tsc --noEmit` on my files: clean. Repo-wide tsc/lint still show **pre-existing** errors from parallel agents' uncommitted WIP (`strategies/strategies/quality.ts`, `s172-dual.ts`, `t21probe/route.ts`, `.next-t21/`, `breadth/page.tsx`) — none touch `backtest/**`. `npx eslint src/lib/backtest/*.ts`: clean.
- The only bug I hit was in my throwaway seeding script (month-advance loop oscillated → unbounded array → OOM); fixed, heap stable at 16MB. Not a repo file.
- Note: the T15 agent is concurrently writing `signal_snapshots` buckets (saw two as_of buckets for the same strategy) — harmless for point-in-time reads.
