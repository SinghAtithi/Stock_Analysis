from playwright.sync_api import sync_playwright

import sys
BASE = sys.argv[sys.argv.index("--url") + 1] if "--url" in sys.argv else "http://localhost:3000"
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1440, "height": 900})
    pg.goto(f"{BASE}/?s=TCS&e=NSE&r=5y", wait_until="networkidle")
    pg.wait_for_timeout(8000)
    print("title:", pg.title())
    h1 = pg.locator("h1").text_content()
    print("h1:", h1)
    # active range button = 5Y
    active = pg.locator('button[aria-pressed="true"]').nth(1).text_content()
    print("active range:", active)
    # deep link to non-watchlist symbol
    pg.goto(f"{BASE}/?s=TATAPOWER", wait_until="networkidle")
    pg.wait_for_timeout(8000)
    print("tata power h1:", pg.locator("h1").text_content())
    b.close()
