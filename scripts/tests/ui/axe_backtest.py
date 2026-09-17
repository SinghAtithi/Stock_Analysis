from playwright.sync_api import sync_playwright

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from axe_load import load_axe  # TASK-1532: CSP-safe axe injection
BASE = sys.argv[sys.argv.index("--url") + 1] if "--url" in sys.argv else "http://localhost:3000"

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1440, "height": 900})
    pg.goto(f"{BASE}/backtest", wait_until="networkidle")
    pg.wait_for_timeout(5000)
    load_axe(pg)
    pg.wait_for_timeout(1000)
    res = pg.evaluate("""async () => {
      const r = await window.axe.run(document, { runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','best-practice']} });
      return { v: r.violations.length, ids: r.violations.map(v => `${v.id}×${v.nodes.length}`) };
    }""")
    print("axe:", res)
    b.close()
