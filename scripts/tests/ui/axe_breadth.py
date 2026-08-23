from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1440, "height": 900})
    pg.goto("http://localhost:3000/breadth", wait_until="networkidle")
    pg.wait_for_timeout(5000)
    pg.add_script_tag(url="https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js")
    pg.wait_for_timeout(1200)
    res = pg.evaluate("""async () => { const r = await window.axe.run(document); return { v: r.violations.length, details: r.violations.map(x => ({ id: x.id, impact: x.impact, nodes: x.nodes.length })) }; }""")
    print("axe:", res)
    b.close()
