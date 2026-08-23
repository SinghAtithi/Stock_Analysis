from playwright.sync_api import sync_playwright

import sys
BASE = sys.argv[sys.argv.index("--url") + 1] if "--url" in sys.argv else "http://localhost:3000"
import json, math, time

def make_payload(symbol, n=120, degraded=None, stale=False):
    base = 1000 + (hash(symbol) % 500)
    candles = []
    t0 = int(time.time()) - n * 86400
    price = base
    for i in range(n):
        price = max(50, price + math.sin(i / 5) * 8 + (i % 7 - 3))
        candles.append({"time": t0 + i * 86400, "open": round(price - 2, 2),
                        "high": round(price + 6, 2), "low": round(price - 5, 2),
                        "close": round(price, 2), "volume": 100000 + (i * 137) % 900000})
    p = {
        "symbol": symbol, "name": symbol, "exchange": "NSE",
        "fullExchangeName": "National Stock Exchange", "currency": "INR",
        "regularMarketPrice": round(price, 2),
        "regularMarketTime": int(time.time()), "previousClose": round(base, 2),
        "fiftyTwoWeekHigh": max(c["high"] for c in candles),
        "fiftyTwoWeekLow": min(c["low"] for c in candles),
        "change": round(price - base, 2), "changePct": round((price - base) / base * 100, 2),
        "range": "1y", "interval": "1d", "candles": candles, "source": "mock",
    }
    if degraded: p["degraded"] = degraded
    if stale: p["stale"] = True
    return p

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1440, "height": 900})
    errs = []
    pg.on("console", lambda m: errs.append(m.text[:120]) if m.type == "error" else None)
    # catch-all (registered first) so unmocked live APIs can't starve
    # networkidle when upstreams stall — specifics below win (TASK-1479)
    pg.route("**/api/**", lambda r: r.fulfill(json={}))

    def route_chart(route):
        q = route.request.url
        sym = "MOCKA" if "MOCKA" in q else "MOCKB" if "MOCKB" in q else "MOCKC"
        payload = make_payload(sym, n=140, degraded="daily" if sym == "MOCKB" else None,
                               stale=(sym == "MOCKC"))
        route.fulfill(json=payload)

    pg.route("**/api/chart*", route_chart)
    pg.goto(f"{BASE}/?s=MOCKA&e=NSE&r=1y", wait_until="networkidle")
    pg.wait_for_timeout(5000)

    print("h1:", pg.locator("h1").text_content())
    print("price:", pg.locator("div[aria-live=polite] span").filter(has_text="%").first.text_content() if pg.locator("div[aria-live=polite] span").filter(has_text="%").count() else "?")
    print("readout:", pg.locator("text=BARS ·").first.text_content() if pg.locator("text=BARS ·").count() else "?")

    # crosshair legend
    chart = pg.locator("#chart")
    box = chart.bounding_box()
    pg.mouse.move(box["x"] + box["width"] * 0.6, box["y"] + box["height"] * 0.4)
    pg.wait_for_timeout(400)
    legend = pg.locator("text=O").first
    print("legend O visible:", legend.is_visible())
    leg_text = pg.locator("#chart > div.absolute.left-3").first.text_content() if pg.locator("#chart > div.absolute.left-3").count() else ""
    print("legend:", leg_text.strip()[:80])

    # log toggle + range switch
    pg.keyboard.press("l")
    pg.wait_for_timeout(400)
    print("log chip:", pg.locator('button[title="Toggle log scale (L)"]').text_content())
    pg.keyboard.press("5")
    pg.wait_for_timeout(2000)
    print("range 5 active:", pg.locator('button[aria-pressed="true"]').nth(1).text_content())

    # degraded + stale chips on other symbols
    pg.goto(f"{BASE}/?s=MOCKB&e=NSE&r=1y", wait_until="networkidle")
    pg.wait_for_timeout(4000)
    print("MOCKB DAILY chip:", pg.locator("text=DAILY").count() > 0)
    pg.goto(f"{BASE}/?s=MOCKC&e=NSE&r=1y", wait_until="networkidle")
    pg.wait_for_timeout(4000)
    print("MOCKC STALE chip:", pg.locator("text=STALE").count() > 0)

    print("console errors:", len(errs), errs[:3])
    b.close()
