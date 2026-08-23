# TASK-36 — RELIANCE.NS pre-2017 corporate-action cliffs reconciled

**Status:** shipped · **Agent:** NOVA · **Date:** 2026-08-23
**Registered debt:** 3 entries in `cliff-debt-registry.json` (1997-11-04 bonus,
2009-11-25 bonus, 2014-07-07 reorganisation re-base drift) — all resolved; registry emptied;
cliff sweep back in strict zero-tolerance mode.

## What the data actually showed

| registered anchor | probed ±14d | verdict |
|---|---|---|
| ~1997-11-04 (1:1 bonus) | **+1524% / −94% pair on 11-02/03** | one corrupt candle (close=362.8 between ~22 values, real 11-02 close displaced); deleted rowid 137613 — series continuous (22.34 → 21.82 across the bonus, already on adjusted basis) |
| ~2009-11-25 (1:1 bonus) | worst move 3.4% | already healed by earlier reconciled ingests — stale entry removed |
| ~2014-07-07 (reorganisation) | worst move −3.7% | same — stale entry removed |

An unregistered −25% step at 2006-01-17/18 was investigated and left alone: it is the RIL→RNRL
demerger ex-date — a genuine value transfer that split-adjustment correctly does not smooth.

## Changes

- `scripts/tests/fixtures/cliff-debt-registry.json` — all entries cleared.
- `scripts/repair-symbol-basis.mjs` (new) — targeted single-symbol repair tool per ADR-0002:
  fresh fetch → continuity report → atomic swap through `storeCandlesReconciled`.
  Dry-run by default; `--apply` required to write. Note: while Yahoo is rate-limited the chain
  falls back to Moneycontrol (~3,000 candles, raw basis) and the tool REFUSES that trade-off by
  reporting source + coverage up front — operators should retry when Yahoo recovers or wait for
  TASK-30's NSE listing-era path before applying on symbols needing deep history.

## Verification

- Full suite strict: **212 pass / 0 fail / 0 skipped** (sweep no longer skips).
- Backtest re-run post-repair: S100 CAGR +20.40% vs bench +17.26%, Sharpe 0.749, exposure 87.4%
  — unchanged, as expected from a one-row 1997 deletion far outside scoring windows.

## Open

- AC "full-history re-ingest" stays deferred until TASK-30 lands the NSE listing-era ingest;
  the repair tool above will consume it. RELIANCE pre-1997 rows (7622 stored) remain intact.
