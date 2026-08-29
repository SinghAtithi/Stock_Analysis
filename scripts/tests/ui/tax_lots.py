"""TASK-1414 — tax lot planner sanity: add-lot flow, countdown chip,
what-if simulator math, CSV export, axe 0 in light + dark."""
from playwright.sync_api import sync_playwright
import sys

BASE = sys.argv[sys.argv.index("--url") + 1] if "--url" in sys.argv else "http://localhost:3000"

fails = []
def check(name, cond):
    print(("PASS " if cond else "FAIL ") + name)
    if not cond:
        fails.append(name)

AXE = open("scripts/tests/ui/vendor/axe.min.js", encoding="utf-8").read()

def axe_run(pg):
    pg.evaluate(AXE)
    pg.wait_for_timeout(600)
    return pg.evaluate("""async () => {
      const r = await window.axe.run(document, { runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','best-practice']} });
      return { v: r.violations.length, ids: r.violations.map(v => `${v.id}×${v.nodes.length}`) };
    }""")

with sync_playwright() as p:
    b = p.chromium.launch()
    errs = []
    failed = []
    pg = b.new_page(viewport={"width": 1440, "height": 1000})
    pg.on("console", lambda m: errs.append(f"{m.text[:140]}") if m.type == "error" else None)
    pg.on("pageerror", lambda e: errs.append(f"pageerror: {str(e)[:300]}"))
    pg.on("response", lambda r: failed.append(f"{r.status} {r.url[:120]}") if r.status >= 400 else None)

    pg.goto(f"{BASE}/tax", wait_until="networkidle")
    pg.wait_for_timeout(2000)

    check("h1 renders Tax lot planner", "Tax lot planner" in (pg.locator("h1").first.text_content() or ""))
    check("disclaimer banner present", "Estimates only" in (pg.locator("body").text_content() or ""))
    check("settings panel present", pg.locator("#cfg-holding-months").count() == 1)
    check("default STCG rate 20%", pg.locator("#cfg-stcg-rate").input_value() == "20.00")
    check("default LTCG rate 12.5%", pg.locator("#cfg-ltcg-rate").input_value() == "12.50")
    check("default exemption 125000", pg.locator("#cfg-exemption").input_value() == "125000")

    pg.fill("#lot-buy-date", "2026-02-01")
    pg.fill("#lot-qty", "100")
    pg.fill("#lot-avg-price", "100")
    pg.fill("#lot-current-price", "150")
    pg.get_by_role("button", name="Add lot").click()
    pg.wait_for_timeout(800)

    body = pg.locator("body").text_content() or ""
    check("lot row appears with buy date", "2026-02-01" in body)
    check("STCG chip shown", "STCG" in body)
    check("countdown chip shows LTCG in Nd", "LTCG in" in body)
    check("gain +₹5,000.00 rendered", "+₹5,000.00" in body)

    pg.get_by_role("checkbox", name="Simulate sale of Untitled lot bought 2026-02-01").check()
    pg.wait_for_timeout(500)
    sim = pg.locator("section", has_text="What-if sale").text_content() or ""
    check("simulator shows projected tax ₹1,000.00", "₹1,000.00" in sim)
    check("simulator shows net proceeds ₹14,000.00", "₹14,000.00" in sim)
    check("simulator shows realized FY", "FY 2026-27" in sim)

    fy = pg.locator("section", has_text="FY totals").text_content() or ""
    check("FY summary groups lot under FY 2025-26", "FY 2025-26" in fy)
    check("export CSV button present", pg.get_by_role("button", name="Export CSV").count() == 1)

    pg.fill("#lot-buy-date", "2025-01-01")
    pg.fill("#lot-qty", "100")
    pg.fill("#lot-avg-price", "100")
    pg.fill("#lot-current-price", "2000")
    pg.get_by_role("button", name="Add lot").click()
    pg.wait_for_timeout(800)
    body = pg.locator("body").text_content() or ""
    check("long-term lot shows Long term today chip", "Long term today" in body)
    pg.get_by_role("checkbox", name="Simulate sale of Untitled lot bought 2025-01-01").check()
    pg.wait_for_timeout(500)
    sim = pg.locator("section", has_text="What-if sale").text_content() or ""
    check("simulator aggregates exemption across lots", "₹8,125.00" in sim)

    with pg.expect_download() as dl:
        pg.get_by_role("button", name="Export CSV").click()
    with open(dl.value.path(), encoding="utf-8") as f:
        text = f.read()
    check("CSV has header + lot row + FY summary",
          "symbol,buy_date,qty" in text and "2026-02-01,100,100,150" in text and "fy,lots,qty" in text)

    res = axe_run(pg)
    check(f"axe 0 violations light (got {res['v']}: {res['ids']})", res["v"] == 0)

    pg.evaluate("localStorage.setItem('nifty-theme', 'dark'); document.documentElement.classList.add('dark')")
    pg.wait_for_timeout(600)
    check("dark theme applies", pg.evaluate("document.documentElement.classList.contains('dark')") is True)
    res = axe_run(pg)
    check(f"axe 0 violations dark (got {res['v']}: {res['ids']})", res["v"] == 0)

    check("no console errors", len(errs) == 0)
    if errs:
        print("  console errors:", errs[:5])
    check("no failed responses", len(failed) == 0)
    if failed:
        print("  failed responses:", failed[:5])

    b.close()
    print("RESULT:", "PASS" if not fails else f"FAIL {fails}")
    sys.exit(1 if fails else 0)