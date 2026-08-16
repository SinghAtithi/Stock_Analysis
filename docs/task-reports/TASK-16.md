# TASK-16 — S172 Dual Momentum + S174 TSM (asset level)

**Owner**: quant engineer · 2026-08-16
**Files**: `scripts/fetch-assets.mjs`, `web/src/lib/strategies/strategies/s172-dual.ts`,
`web/src/lib/strategies/strategies/s174-tsm.ts`, `scripts/tests/s172-s174.test.mjs`, this report.
`registry.ts` / `run-signals.mjs` / `package.json` untouched — the strategies self-register on import.

## Asset series (scripts/fetch-assets.mjs)

- **GOLDBEES source verdict**: Moneycontrol **equity endpoint** works out of the box — `stock/history?symbol=GOLDBEES` → `s:"ok"`, full 10y history. **No Yahoo fallback needed** (implemented as safety net anyway: v8 chart `GOLDBEES.NS` via curl, may 429). Both endpoints accept `countback=3000` today (T31's "countback>500 → error" note is stale for the `1D`+`from/to` form verified here).
- Indices use the MC **index** endpoint (`index/history`) with codes `in;NSX` (NIFTY 50) and `in;SEN` (SENSEX); per T31 the code case is edge-dependent, so each asset tries both cases (`in;NSX`/`in;nsx`, …) with 1.5 s pacing between requests.
- Upserts on PK (symbol, ts) via the existing `upsertCandles`; re-run skips assets already current (verified: second run → 3 skipped, 0 fetched). `--force` refetches.
- Cash proxy ("CASH") is synthetic (0 return, no series) and lives only inside the strategies.

| symbol | candles | oldest | latest |
|---|---|---|---|
| NIFTY 50 | 2650 | 2015-12-01 | 2026-08-14 |
| SENSEX | 2650 | 2015-12-04 | 2026-08-14 |
| GOLDBEES | 2651 | 2015-11-27 | 2026-08-14 |

## Strategies

- **S172** (`s172-dual.ts`): absolute momentum = close vs 200d SMA per asset; relative = rank by 12-1 return (skip last 21 sessions, MOP convention `P[t-21]/P[t-252]-1`); top asset's 12-1 < 0 → **cash regime**. Score: 100 top-of-risk-on-stack (above SMA + rank 1), 0 in cash regime or when the asset itself is ≤ 200d SMA. Components `{sma200 (close/SMA ratio), ret12, regime, rank}`.
- **S174** (`s174-tsm.ts`): sign of 12-1 return per asset; exposure = sign·(volTarget 15% / realizedVol, annualized 60d); score = clamp(50 + exposure·50) → 100 full long, 0 full short, 50 neutral (CASH). Components `{ret12, sign, vol, volTarget, exposure}`.
- Both: `juryRank` 5 / 3, `edgeScore` 8.83 / 9.5 (RANKINGS.md), NaN-safe, null on short/missing data, per-ctx daily cache. **Note**: these are asset-level — `compute()` ignores the equity universe and scores the fixed asset list.

## Real run (read-only harness in the test, as of 2026-08-14 close)

```
[S172] regime: risk-on
  GOLDBEES   score=100   sma200=1.05 ret12=+0.44 rank=1
  NIFTY 50   score=  0   sma200=0.99 ret12=-0.06 rank=2
  SENSEX     score=  0   sma200=0.98 ret12=-0.08 rank=3
  CASH       score=  0
[S174]
  GOLDBEES   score=88.94 sign=+1 vol=0.19 exposure=0.78
  NIFTY 50   score=  0   sign=-1 vol=0.11 exposure=-1.33
  SENSEX     score=  0   sign=-1 vol=0.12 exposure=-1.29
  CASH       score= 50
```
Gold is the clear winner of the 12-1 window; both indices are negative with prices under their 200d SMAs (S172 gates them to 0; S174 shorts them).

## Verification

- `npx tsc --noEmit` + `eslint` on my files: **green**. Repo-wide tsc/lint currently fail only in **other agents' in-flight files** (`Modal.tsx` parse error, `backtest/engine.ts`, `quality.ts`, `api/signals`, `api/t21probe`) — none are mine.
- Tests: **11/11 pass** (suite-wide 142/145; the 3 failures are the parallel agent's backtest-engine tests). Covers regime logic (risk-on, cash, SMA gate), TSM sign/vol/clamp math, NaN/short/missing series, registry metadata, and the live-DB run.

## Blockers / notes

1. **`run-signals.mjs` has a units bug for real DBs**: its `getCandles` computes `since = Date.now() - lookbackDays*86_400_000*1.6` (ms) and compares against `eod_candles.ts` stored in **epoch seconds** → always 0 rows on real data (this is also why T14's "real DB" run scored nothing). Not mine to fix; the harness in this test uses seconds. Worth a data-agent/runner follow-up.
2. S172/S174 integrate with run-signals only via a universe override (equity-universe default); asset CLI integration is a later runner task.
