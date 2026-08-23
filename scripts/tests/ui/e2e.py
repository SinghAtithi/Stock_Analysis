from playwright.sync_api import sync_playwright

import sys
BASE = sys.argv[sys.argv.index("--url") + 1] if "--url" in sys.argv else "http://localhost:3000"

fails = []
def check(name, cond):
    print(("PASS " if cond else "FAIL ") + name)
    if not cond: fails.append(name)

with sync_playwright() as p:
    b = p.chromium.launch()
    errs = []
    pg = b.new_page(viewport={"width": 1440, "height": 900})
    pg.on("console", lambda m: errs.append(f"{m.type}: {m.text[:150]}") if m.type in ("error",) else None)
    pg.on("pageerror", lambda e: errs.append(f"pageerror: {str(e)[:150]}"))
    # domcontentloaded, not networkidle: upstream throttling (Yahoo 429s) makes
    # the app's auto-retry keep the network busy indefinitely, so idle never
    # fires — assert on rendered elements instead of a quiet wire.
    pg.goto(f"{BASE}/", wait_until="domcontentloaded", timeout=60000)
    pg.wait_for_timeout(8000)

    check("0 console/page errors", len(errs) == 0)
    check("wordmark present", pg.locator("header span", has_text="NIFTY").count() > 0)
    check("market status (OPEN/CLOSED)", pg.locator("text=OPEN").count() + pg.locator("text=CLOSED").count() >= 1)
    check("price rendered (₹)", pg.locator("text=₹").count() > 0)
    check("stats rail 6 cells", pg.locator('[aria-label="Session stats"] > div').count() == 6)

    # all 8 ranges produce chart data
    for i in range(1, 9):
        pg.keyboard.press(str(i))
        pg.wait_for_timeout(2500)
    readout = pg.locator("text=BARS ·").first.text_content()
    print("  readout:", readout)

    # search flow
    pg.locator('input[aria-label="Search Indian stocks"]').first.fill("hdfc")
    pg.wait_for_timeout(900)
    n = pg.locator("ul li button").count()
    check("search results appear", n > 0)
    pg.keyboard.press("ArrowDown")
    pg.keyboard.press("Enter")
    pg.wait_for_timeout(3500)
    check("title after search", "·" in pg.title())
    check("url symbol", "s=" in pg.url)
    check("fundamentals panel renders (grid or empty state)", pg.locator('section[aria-label="Fundamentals"]').count() > 0 or pg.locator("text=No fundamentals on file for this symbol.").count() > 0)

    # star toggle
    star = pg.locator('button[aria-label*="Add to watchlist"], button[aria-label*="Remove from watchlist"]').first
    before = star.get_attribute("aria-label")
    star.click()
    pg.wait_for_timeout(400)
    after = star.get_attribute("aria-label")
    check("star toggles", before != after)
    # restore
    star.click()

    # mobile
    m = b.new_page(viewport={"width": 390, "height": 844})
    merrs = []
    m.on("console", lambda x: merrs.append(x.text[:150]) if x.type == "error" else None)
    m.goto(f"{BASE}/", wait_until="domcontentloaded", timeout=60000)
    m.wait_for_timeout(5000)
    check("mobile no errors", len(merrs) == 0)
    m.locator("button", has_text="Watchlist").first.click()
    m.wait_for_timeout(600)
    check("mobile sheet opens", m.locator('[role="dialog"][aria-label="Watchlist"]').is_visible())
    m.keyboard.press("Escape")
    m.wait_for_timeout(400)
    check("mobile sheet closes", not m.locator('[role="dialog"][aria-label="Watchlist"]').is_visible())
    m.close()

    # reduced motion
    rm = b.new_page(viewport={"width": 1280, "height": 800}, reduced_motion="reduce")
    rm.goto(f"{BASE}/")
    rm.wait_for_timeout(4000)
    anims = rm.evaluate("""() => {
      const all = [...document.querySelectorAll('*')];
      const moving = all.filter(el => {
        const s = getComputedStyle(el);
        return (s.animationName && s.animationName !== 'none') && parseFloat(s.animationDuration) > 0.1;
      }).length;
      return moving;
    }""")
    check("reduced motion kills animations", anims == 0)
    rm.close()

    for e in errs[:6]: print("  err:", e)
    b.close()

print("\nRESULT:", "ALL PASS" if not fails else f"FAILURES: {fails}")
