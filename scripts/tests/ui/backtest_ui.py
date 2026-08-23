from playwright.sync_api import sync_playwright

import sys
BASE = sys.argv[sys.argv.index("--url") + 1] if "--url" in sys.argv else "http://localhost:3000"

fails = []
def check(name, cond):
    print(("PASS " if cond else "FAIL ") + name)
    if not cond: fails.append(name)

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1440, "height": 900})
    errs = []
    pg.on("console", lambda m: errs.append(f"{m.type}: {m.text[:150]}") if m.type == "error" else None)
    pg.on("pageerror", lambda e: errs.append(f"pageerror: {str(e)[:150]}"))
    pg.goto(f"{BASE}/backtest", wait_until="networkidle")
    pg.wait_for_timeout(3000)

    check("0 console/page errors on load", len(errs) == 0)
    check("strategy picker present", pg.locator("select").count() > 0)
    check("run button present", pg.locator('button', has_text="Run backtest").count() > 0)

    # deep link preselects a strategy
    pg.goto(f"{BASE}/backtest?strategy=S100", wait_until="networkidle")
    pg.wait_for_timeout(2000)

    # run a real backtest (inline, seconds per TASK-28 design)
    pg.locator('button', has_text="Run backtest").first.click()
    try:
        pg.wait_for_selector('[class*="equity"], table, canvas', timeout=60000)
        ran = True
    except Exception:
        ran = False
    check("run produces output (curve/table) or explicit error state", ran or pg.locator('[role="alert"], [role="status"]').count() > 0)
    check("0 console errors after run", len(errs) == 0)

    for e in errs[:5]: print("  err:", e)
    b.close()

print("\nRESULT:", "ALL PASS" if not fails else f"FAILURES: {fails}")
