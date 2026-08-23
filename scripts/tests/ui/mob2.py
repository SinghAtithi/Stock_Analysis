from playwright.sync_api import sync_playwright

import sys
BASE = sys.argv[sys.argv.index("--url") + 1] if "--url" in sys.argv else "http://localhost:3000"
with sync_playwright() as p:
    b = p.chromium.launch()
    for w in (320, 390, 768):
        m = b.new_page(viewport={"width": w, "height": 800})
        m.goto(f"{BASE}/?s=RELIANCE&e=NSE&r=1y", wait_until="networkidle")
        m.wait_for_timeout(6000)
        ov = m.evaluate("document.documentElement.scrollWidth > window.innerWidth")
        logbtn = m.locator('button[title="Toggle log scale (L)"]')
        print(f"{w}px: overflow={ov} log-toggle-visible={logbtn.is_visible()}")
        m.close()
    b.close()
