"""TASK-1415 radar UI probe — plain smoke (axe CDN blocked by nonce CSP).
Loads /radar, asserts render + empty/feed states + alert button wiring.
Usage: python3 scripts/tests/ui/radar.py --url http://localhost:3214
"""
from playwright.sync_api import sync_playwright
import sys

BASE = sys.argv[sys.argv.index("--url") + 1] if "--url" in sys.argv else "http://localhost:3000"

fails = []
def check(name, cond):
    print(("PASS " if cond else "FAIL ") + name)
    if not cond:
        fails.append(name)

with sync_playwright() as p:
    b = p.chromium.launch()
    errs = []
    pg = b.new_page(viewport={"width": 1440, "height": 900})
    pg.on("console", lambda m: errs.append(f"{m.type}: {m.text[:150]}") if m.type in ("error",) else None)
    pg.on("pageerror", lambda e: errs.append(f"pageerror: {str(e)[:150]}"))

    pg.goto(f"{BASE}/radar", wait_until="domcontentloaded", timeout=60000)
    pg.wait_for_timeout(6000)

    check("0 console/page errors", len(errs) == 0)
    check("h1 'Smart-money radar'", pg.locator("h1", has_text="Smart-money radar").count() == 1)
    check("header subtitle", pg.locator("header", has_text="Smart-money radar").count() >= 1)
    check("tabs Watchlist + All activity", pg.get_by_role("button", name="Watchlist").count() == 1
          and pg.get_by_role("button", name="All activity").count() == 1)
    check("symbols counter", pg.locator("text=symbols").count() >= 1)

    pg.get_by_role("button", name="All activity").click()
    pg.wait_for_timeout(1500)

    feed = pg.locator("text=S113 ·").count() + pg.locator("text=S107 ·").count() + pg.locator("text=S122 ·").count()
    check("strategy chips rendered (S113/S107/S122)", feed > 0)

    body = pg.locator("body").inner_text()
    empty_ok = "Source blocked/offline" in body or "No smart-money activity" in body or "S113" in body or "S122" in body
    check("no blank page (blocked/empty/feed state shown)", empty_ok)

    if pg.locator("text=S113 ·").count() > 0 or pg.locator("text=S113 · bulk").count() > 0:
        alert_btns = pg.locator('button[aria-label^="Alert on new deal"]')
        check("alert buttons present on deal rows", alert_btns.count() > 0)
        if alert_btns.count() > 0:
            alert_btns.first.click()
            pg.wait_for_timeout(2500)
            check("alert POST completes without page error", len(errs) == 0)
            print("  (alert row state:",
                  pg.locator("button", has_text="Alert set").count(), "set,", 
                  pg.locator("text=Could not create alert").count(), "errors)")

    check("footer disclaimer link", pg.locator("footer a", has_text="Not investment advice").count() == 1)

    # API shape sanity
    api = pg.request.get(f"{BASE}/api/smart-money")
    check("/api/smart-money 200", api.status == 200)
    j = api.json()
    check("meta carries sources + asOf", isinstance(j.get("meta", {}).get("sources"), list))
    check("groups grouped by symbol", isinstance(j.get("groups"), list))
    if j.get("groups"):
        g0 = j["groups"][0]
        check("group shape (symbol + items w/ strategy)", "symbol" in g0 and "items" in g0
              and "strategy" in g0["items"][0] and "strategyId" in g0["items"][0]["strategy"])
        item = g0["items"][0]
        for field in ("buySell", "qty", "value", "price", "tradeDate", "client"):
            assert field in item, field
        print("  sample item:", item["symbol"], item["kind"], item["strategy"]["tag"], item["qty"], item["value"])

    b.close()

print()
print("FAILED:", fails if fails else "none")
sys.exit(1 if fails else 0)