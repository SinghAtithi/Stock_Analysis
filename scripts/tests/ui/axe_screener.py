from playwright.sync_api import sync_playwright

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from axe_load import load_axe  # TASK-1532: CSP-safe axe injection
BASE = sys.argv[sys.argv.index("--url") + 1] if "--url" in sys.argv else "http://localhost:3000"
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1440, "height": 900})
    pg.goto(f"{BASE}/screener", wait_until="domcontentloaded", timeout=60000)
    pg.wait_for_timeout(5000)
    load_axe(pg)
    pg.wait_for_timeout(1200)
    res = pg.evaluate("""async () => { const r = await window.axe.run(document); return { v: r.violations.length, ids: [...new Set(r.violations.map(x => x.id))] }; }""")
    print("screener axe:", res)
    b.close()
    # TASK-1536: blocking tier — fail loudly on violations so ui-smoke goes red.
    sys.exit(1 if res["v"] else 0)
