from playwright.sync_api import sync_playwright

import sys
BASE = sys.argv[sys.argv.index("--url") + 1] if "--url" in sys.argv else f"{BASE}"
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1440, "height": 900})
    errs = []
    pg.on("console", lambda m: errs.append(m.text[:120]) if m.type == "error" else None)
    pg.goto(f"{BASE}/screener", wait_until="networkidle")
    pg.wait_for_timeout(6000)
    print("h1:", pg.locator("h1").text_content())
    print("strategy chips:", pg.locator('button[aria-pressed]').count())
    print("rows:", pg.locator("tbody tr").count())
    print("first row:", pg.locator("tbody tr").first.text_content()[:80] if pg.locator("tbody tr").count() else "none")
    # sort by score
    pg.locator("th button", has_text="SCORE").click()
    pg.wait_for_timeout(400)
    first = pg.locator("tbody tr").first.locator("td").nth(4).text_content()
    print("first score after sort asc:", first)
    # keyboard nav + Enter navigates to chart
    pg.evaluate("document.querySelector('table[tabindex=\"0\"]')?.focus()")
    pg.keyboard.press("ArrowDown")
    pg.keyboard.press("Enter")
    pg.wait_for_timeout(4000)
    print("keyboard nav navigated:", "s=" in pg.url, "|", pg.url.split("//")[1])
    # strategy switch (back on the screener)
    pg.goto(f"{BASE}/screener", wait_until="networkidle")
    pg.wait_for_timeout(3000)
    pg.locator("button", has_text="ROC(20)").click()
    pg.wait_for_timeout(2500)
    print("after ROC20 switch rows:", pg.locator("tbody tr").count())
    print("errors:", len(errs), errs[:2])
    b.close()
