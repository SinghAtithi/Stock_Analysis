# UI verification suite (Playwright, Python)

Ad-hoc-but-essential Playwright checks for the NIFTY//TERM UI. Requires:
- the dev server on `:3000` (or pass `--url`), and the global Python `playwright` package.
- axe-core runs inject the library from a CDN (offline runs skip those two scripts).

## Usage
```
python3 scripts/tests/ui/e2e.py            # 13-check main regression (desktop + mobile + reduced-motion)
python3 scripts/tests/ui/axe.py            # axe-core contrast/AA scan (main page)
python3 scripts/tests/ui/axe_breadth.py    # axe scan (/breadth)
python3 scripts/tests/ui/axe_backtest.py   # axe scan (/backtest)
python3 scripts/tests/ui/backtest_ui.py    # backtest: controls present, real run, no console errors
python3 scripts/tests/ui/axe_screener.py   # axe scan (/screener)
python3 scripts/tests/ui/screener.py       # screener: rows, sort, keyboard nav → chart deep link
python3 scripts/tests/ui/deeplink.py       # deep links: watchlist + non-watchlist symbols
python3 scripts/tests/ui/mob2.py           # mobile: overflow + log toggle across widths
python3 scripts/tests/ui/foot.py           # 320/360px footer geometry
```

## Upstream-independent checks (route interception)
```
python3 scripts/tests/ui/tape_mock.py      # ticker tape renders + click-through (mocked /api/ticker)
python3 scripts/tests/ui/chart_mock.py     # ChartPanel with mocked /api/chart (legend, log, chips)
```
These mock the upstream APIs so the UI can be verified even while Yahoo throttles this IP.

## Notes
- Yahoo throttles this IP for long stretches; the tape self-hides (by design). Mocked checks
  cover the tape/chart UI without upstream.
- The 13-check e2e expects `0 console errors` — if a Wave agent's in-flight route breaks the
  dev overlay, re-run after they merge.
- Python runner: `python3 -m playwright install chromium` once.
