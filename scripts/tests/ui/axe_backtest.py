from playwright.sync_api import sync_playwright

import sys
BASE = sys.argv[sys.argv.index("--url") + 1] if "--url" in sys.argv else "http://localhost:3000"

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1440, "height": 900})
    pg.goto(f"{BASE}/backtest", wait_until="networkidle")
    pg.wait_for_timeout(5000)
    pg.add_script_tag(path="scripts/tests/ui/vendor/axe.min.js")
    pg.wait_for_timeout(1000)
    res = pg.evaluate("""async () => {
      const r = await window.axe.run(document, { runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','best-practice']} });
      return { v: r.violations.length, ids: r.violations.map(v => `${v.id}×${v.nodes.length}`) };
    }""")
    print("axe:", res)
    b.close()
