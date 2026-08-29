"""TASK-1378 — portfolio x-ray sanity: paste Zerodha/Groww CSVs, preview,
import, donuts, overlap, factor bars, localStorage persistence, axe 0 light +
dark, mobile stack at 390px."""
from playwright.sync_api import sync_playwright
import sys

BASE = sys.argv[sys.argv.index("--url") + 1] if "--url" in sys.argv else "http://localhost:3217"

ZERODHA_CSV = """Symbol,Instrument,Sector,Quantity,Avg. cost,LT
RELIANCE,INEO002A0082,Energy,10,2450.50,L
TCS,INE467B01029,IT,5,3890.00,L
HDFCBANK,INE040A01034,Finance,8,1750.00,L
INFY,INE009A01021,IT,20,"1,450.00",L
XYZUNKNOWN,INE000000000,?,abc,100,L"""

GROWW_CSV = """Symbol Name,Quantity,Average Price
TCS,5,₹3,890.00
INFY,20,1450"""

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
      return { v: r.violations.length, ids: r.violations.map(v => `${v.id}×${v.nodes.length}`), det: r.violations.map(v => ({id:v.id, nodes:v.nodes.map(n=>n.html.slice(0,160))})) };
    }""")

with sync_playwright() as p:
    b = p.chromium.launch()
    errs = []
    failed = []
    pg = b.new_page(viewport={"width": 1440, "height": 1000})
    pg.on("console", lambda m: errs.append(f"{m.text[:140]}") if m.type == "error" else None)
    pg.on("pageerror", lambda e: errs.append(f"pageerror: {str(e)[:300]}"))
    pg.on("response", lambda r: failed.append(f"{r.status} {r.url[:120]}") if r.status >= 400 else None)

    pg.goto(f"{BASE}/portfolio", wait_until="networkidle")
    pg.wait_for_timeout(1500)

    check("h1 renders Portfolio x-ray", "Portfolio x-ray" in (pg.locator("h1").first.text_content() or ""))
    check("privacy note present", "nothing is uploaded" in (pg.locator("body").text_content() or ""))

    # --- Zerodha-style paste + preview (AC1) ---
    pg.fill("textarea[aria-label='Paste holdings CSV']", ZERODHA_CSV)
    pg.wait_for_timeout(400)
    body = pg.locator("body").text_content() or ""
    check("preview parses 4 holdings", "4 holdings parsed" in body)
    check("skipped row reported", "1 row skipped" in body and "Line 6" in body)
    check("preview table shows RELIANCE row", "RELIANCE" in body)
    check("import button counts holdings", pg.get_by_role("button", name="Import 4 holdings").count() == 1)

    # --- import (AC1) ---
    pg.get_by_role("button", name="Import 4 holdings").click()
    pg.wait_for_timeout(1500)

    body = pg.locator("body").text_content() or ""
    check("holdings section appears", "Total invested" in body)
    check("verdict chip shown", "Concentrated" in body)
    check("top sector named", "Energy Minerals" in body)
    check("sector donut svg present", pg.locator("svg[role='img'][aria-label^='Sector allocation']").count() == 1)
    check("cap donut svg present", pg.locator("svg[role='img'][aria-label^='Cap allocation']").count() == 1)
    check("overlap % vs Nifty 50", "100%" in body and "Overlap vs Nifty 50" in body)
    check("factor bars render", pg.locator("div[role='img'][aria-label*='exposure']").count() >= 1)
    check("no-data factor shown", "No data" in body)
    check("localStorage persisted", pg.evaluate("localStorage.getItem('niftyterm.portfolio')") is not None)
    check("unmatched holding noted", "XYZUNKNOWN" in body)

    # --- persistence across reload ---
    pg.reload(wait_until="networkidle")
    pg.wait_for_timeout(1200)
    body = pg.locator("body").text_content() or ""
    check("holdings survive reload", "Total invested" in body and "RELIANCE" in body)

    # --- Groww-style header (AC1) ---
    pg.fill("textarea[aria-label='Paste holdings CSV']", GROWW_CSV)
    pg.wait_for_timeout(400)
    body = pg.locator("body").text_content() or ""
    check("Groww header parsed", "2 holdings parsed" in body and "₹3,890.00" in body or "3,890.00" in body)
    pg.get_by_role("button", name="Import 2 holdings").click()
    pg.wait_for_timeout(1200)
    body = pg.locator("body").text_content() or ""
    check("re-import replaces portfolio", "Total invested" in body and "TCS" in body)

    # --- headerless fallback ---
    pg.fill("textarea[aria-label='Paste holdings CSV']", "RELIANCE.NS,10,2450.50\nTCS,5,3890.00")
    pg.wait_for_timeout(400)
    body = pg.locator("body").text_content() or ""
    check("headerless fallback flagged", "No known header row detected" in body)
    check("headerless parsed 2", "2 holdings parsed" in body)

    # --- clear ---
    pg.get_by_role("button", name="Clear saved portfolio").click()
    pg.wait_for_timeout(600)
    body = pg.locator("body").text_content() or ""
    check("clear removes holdings", "Total invested" not in body)

    # --- axe light + dark ---
    pg.fill("textarea[aria-label='Paste holdings CSV']", ZERODHA_CSV)
    pg.wait_for_timeout(400)
    pg.get_by_role("button", name="Import 4 holdings").click()
    pg.wait_for_timeout(1200)
    res = axe_run(pg)
    check(f"axe 0 violations light (got {res['v']}: {res['ids']})", res["v"] == 0)
    if res["v"]: print("  detail:", res["det"])

    pg.evaluate("localStorage.setItem('nifty-theme', 'dark'); document.documentElement.classList.add('dark')")
    pg.wait_for_timeout(600)
    res = axe_run(pg)
    check(f"axe 0 violations dark (got {res['v']}: {res['ids']})", res["v"] == 0)
    if res["v"]: print("  detail:", res["det"])
    pg.evaluate("localStorage.removeItem('nifty-theme'); document.documentElement.classList.remove('dark')")

    # --- mobile 390px stack ---
    pg.set_viewport_size({"width": 390, "height": 844})
    pg.wait_for_timeout(800)
    sw = pg.evaluate("document.documentElement.scrollWidth")
    check(f"no horizontal overflow at 390px (scrollWidth={sw})", sw <= 390)
    donut_box = pg.locator("svg[role='img'][aria-label^='Sector allocation']").bounding_box()
    check("sector donut visible on mobile", donut_box is not None and donut_box["width"] > 100)

    check("no console errors", len(errs) == 0)
    if errs:
        print("  console errors:", errs[:5])
    check("no failed responses", len(failed) == 0)
    if failed:
        print("  failed responses:", failed[:5])

    b.close()
    print("RESULT:", "PASS" if not fails else f"FAIL {fails}")
    sys.exit(1 if fails else 0)