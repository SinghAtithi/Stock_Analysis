from playwright.sync_api import sync_playwright

import sys
BASE = sys.argv[sys.argv.index("--url") + 1] if "--url" in sys.argv else "http://localhost:3000"
with sync_playwright() as p:
    b = p.chromium.launch()
    for w in (320, 360):
        m = b.new_page(viewport={"width": w, "height": 700})
        m.goto(f"{BASE}/?s=RELIANCE&e=NSE&r=1y", wait_until="networkidle")
        m.wait_for_timeout(5000)
        ov = m.evaluate("document.documentElement.scrollWidth > window.innerWidth")
        ft = m.locator("footer").evaluate("""el => {
          const r = el.getBoundingClientRect();
          return { x: Math.round(r.x), right: Math.round(r.right), w: Math.round(r.width) };
        }""")
        print(f"{w}px: h-overflow={ov} footer={ft}")
        m.close()
    b.close()
