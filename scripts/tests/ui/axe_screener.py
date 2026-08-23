from playwright.sync_api import sync_playwright

import sys
BASE = sys.argv[sys.argv.index("--url") + 1] if "--url" in sys.argv else "http://localhost:3000"
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1440, "height": 900})
    pg.goto(f"{BASE}/screener", wait_until="domcontentloaded", timeout=60000)
    pg.wait_for_timeout(5000)
    pg.add_script_tag(path="scripts/tests/ui/vendor/axe.min.js")
    pg.wait_for_timeout(1200)
    res = pg.evaluate("""async () => { const r = await window.axe.run(document); return { v: r.violations.length, ids: [...new Set(r.violations.map(x => x.id))] }; }""")
    print("screener axe:", res)
    b.close()
