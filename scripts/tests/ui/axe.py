from playwright.sync_api import sync_playwright

AXE = "https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js"

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1440, "height": 900})
    pg.goto("http://localhost:3000/?s=RELIANCE&e=NSE&r=1y", wait_until="networkidle")
    pg.wait_for_timeout(7000)
    pg.add_script_tag(url=AXE)
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
