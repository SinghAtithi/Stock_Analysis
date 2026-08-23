from playwright.sync_api import sync_playwright

import sys
BASE = sys.argv[sys.argv.index("--url") + 1] if "--url" in sys.argv else f"{BASE}"

MOCK = {
    "items": [
        {"symbol": "NIFTY 50", "name": "NIFTY 50", "price": 24800.5, "changePct": 0.42, "exchange": "NSE", "type": "Index"},
        {"symbol": "SENSEX", "name": "SENSEX", "price": 81250.75, "changePct": -0.18, "exchange": "BSE", "type": "Index"},
        {"symbol": "RELIANCE", "name": "RELIANCE", "price": 1310.0, "changePct": -0.53, "exchange": "NSE", "type": "Equity"},
        {"symbol": "TCS", "name": "TCS", "price": 4120.3, "changePct": 1.05, "exchange": "NSE", "type": "Equity"},
    ]
}

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1440, "height": 900})
    errs = []
    pg.on("console", lambda m: errs.append(m.text[:120]) if m.type == "error" else None)
    pg.route("**/api/ticker", lambda r: r.fulfill(json=MOCK))
    pg.goto(f"{BASE}/?s=RELIANCE&e=NSE&r=1y", wait_until="networkidle")
    pg.wait_for_timeout(6000)

    buttons = pg.locator(".tape-track button")
    print("tape buttons:", buttons.count())
    print("first label:", buttons.first.get_attribute("title"))
    print("tape paused on hover:", pg.locator(".tape-wrap").evaluate("el => getComputedStyle(el.querySelector('.tape-track')).animationPlayState") in ("running", "paused"))

    pg.evaluate("document.querySelector('.tape-track').style.animationPlayState = 'paused'")
    pg.wait_for_timeout(300)
    t_before = pg.title()
    buttons.first.click()
    pg.wait_for_timeout(3500)
    print("clicked NIFTY 50 -> h1:", pg.locator("h1").text_content())
    print("title changed:", pg.title() != t_before)
    print("errors:", len(errs), errs[:3])
    b.close()
