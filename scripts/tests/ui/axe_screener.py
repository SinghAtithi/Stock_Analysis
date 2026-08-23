from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1440, "height": 900})
    pg.goto("http://localhost:3000/screener", wait_until="networkidle")
    pg.wait_for_timeout(5000)
    pg.add_script_tag(url="https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js")
    pg.wait_for_timeout(1200)
    res = pg.evaluate("""async () => { const r = await window.axe.run(document); return { v: r.violations.length, ids: [...new Set(r.violations.map(x => x.id))] }; }""")
    print("screener axe:", res)
    b.close()
