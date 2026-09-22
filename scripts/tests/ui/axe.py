from playwright.sync_api import sync_playwright

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from axe_load import load_axe  # TASK-1532: CSP-safe axe injection
BASE = sys.argv[sys.argv.index("--url") + 1] if "--url" in sys.argv else "http://localhost:3000"

# TASK-1530/1532: axe is served same-origin (see axe_load) so `script-src
# 'self'` allows it — no CSP bypass, the app's real policy stays enforced.
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1440, "height": 900})
    pg.goto(f"{BASE}/?s=RELIANCE&e=NSE&r=1y", wait_until="domcontentloaded", timeout=60000)
    pg.wait_for_timeout(7000)
    load_axe(pg)
    pg.wait_for_timeout(1500)
    res = pg.evaluate("""async () => {
      const r = await window.axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] }
      });
      return { violations: r.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help })) };
    }""")
    print("violations:", len(res["violations"]))
    for v in res["violations"]:
        print("  ", v)
    b.close()
    # TASK-1536: blocking tier — fail loudly on violations so ui-smoke goes red.
    sys.exit(1 if res["violations"] else 0)
