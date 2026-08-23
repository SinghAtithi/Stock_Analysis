"""TASK-74 — axe scan for /board across light+dark × desktop+mobile.
Prints violations grouped by rule id with impacted nodes, then a summary.
Exit code 0 iff zero serious/critical violations everywhere."""
from playwright.sync_api import sync_playwright
import sys

AXE = "scripts/tests/ui/vendor/axe.min.js"
BASE = sys.argv[sys.argv.index("--url") + 1] if "--url" in sys.argv else "http://localhost:3000"

SCAN = """async () => {
  const r = await window.axe.run(document, {
    resultTypes: ['violations'],
  });
  // scope to the page's own content — site chrome (SiteHeader WIP) has its
  // own contrast-debt tasks (TASK-31/33)
  const inMain = (n) => n.target.some(t => t.startsWith('#main-content'));
  return r.violations
    .map(v => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.filter(n => inMain(n)).length,
      all: v.nodes.length,
      sample: v.nodes.slice(0, 3).map(n => n.target.join(' ')),
      help: v.help,
    }))
    .filter(v => v.nodes > 0);
}"""

def scan(pg, theme, mobile):
    pg.set_viewport_size({"width": 390, "height": 844} if mobile else {"width": 1440, "height": 900})
    pg.emulate_media(color_scheme=theme)
    if theme == "dark":
        pg.evaluate("() => document.documentElement.classList.add('dark')")
    else:
        pg.evaluate("() => document.documentElement.classList.remove('dark')")
    pg.wait_for_timeout(600)
    return pg.evaluate(SCAN)

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1440, "height": 900})
    pg.goto(f"{BASE}/board", wait_until="networkidle")
    pg.add_script_tag(path=AXE)
    pg.wait_for_timeout(800)

    total_serious = 0
    for theme in ("light", "dark"):
        for mobile in (False, True):
            label = f"{theme}/{ 'mobile' if mobile else 'desktop' }"
            vs = scan(pg, theme, mobile)
            serious = [v for v in vs if v["impact"] in ("serious", "critical")]
            total_serious += len(serious)
            print(f"\n=== {label}: {len(vs)} rule(s), {len(serious)} serious+ ===")
            for v in vs:
                print(f"  [{v['impact']}] {v['id']} x{v['nodes']} — {v['help']}")
                for s in v["sample"]:
                    print(f"      e.g. {s}")
    print(f"\nTOTAL serious/critical instances across modes: {total_serious}")
    b.close()
    sys.exit(1 if total_serious else 0)
