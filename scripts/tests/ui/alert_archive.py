from playwright.sync_api import sync_playwright

import sys
BASE = sys.argv[sys.argv.index("--url") + 1] if "--url" in sys.argv else "http://localhost:3000"

STATE = {
    "alerts": [
        {"id": "a-active", "symbol": "RELIANCE", "strategyId": None, "topN": None,
         "exchange": "NSE", "type": "price_above", "price": 3000, "active": True,
         "createdAt": 1787500000, "firedAt": None, "dismissedAt": None},
        {"id": "a-fired", "symbol": "TCS", "strategyId": None, "topN": None,
         "exchange": "NSE", "type": "price_above", "price": 4000, "active": False,
         "createdAt": 1787400000, "firedAt": 1787490000, "dismissedAt": None},
    ]
}

def get_alerts():
    return {"alerts": STATE["alerts"]}

fails = []
def check(name, cond):
    print(("PASS " if cond else "FAIL ") + name)
    if not cond:
        fails.append(name)

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1440, "height": 900})

    def handle(route):
        req = route.request
        if "/api/alerts" not in req.url:
            route.fulfill(json={})
            return
        if req.method == "GET":
            route.fulfill(json=get_alerts())
        elif req.method == "DELETE":
            aid = req.url.split("id=")[-1].split("&")[0]
            row = next((a for a in STATE["alerts"] if a["id"] == aid), None)
            if row and not row["active"]:
                row["dismissedAt"] = 1787510000
                route.fulfill(json={"ok": True, "archived": True, "dismissedAt": 1787510000})
            elif row:
                STATE["alerts"] = [a for a in STATE["alerts"] if a["id"] != aid]
                route.fulfill(json={"ok": True})
            else:
                route.fulfill(json={"error": "not_found"}, status=404)
        else:
            route.fulfill(json={})

    pg.route("**/api/**", handle)

    pg.goto(f"{BASE}/", wait_until="domcontentloaded")
    pg.wait_for_timeout(5000)

    pg.get_by_role("button", name="Alert center").click()
    pg.wait_for_timeout(800)
    dlg = pg.locator('[role="dialog"], [aria-label*="alert" i]').first

    check("fired section lists TCS", pg.get_by_text("TCS").count() > 0)
    check("no dismissed section yet", pg.locator('section[aria-label="Dismissed alerts"]').count() == 0)

    # dismiss the fired alert -> archives, not deletes
    pg.get_by_role("button", name="Dismiss fired alert for TCS").click()
    pg.wait_for_timeout(800)
    check("dismissed section appears", pg.locator('section[aria-label="Dismissed alerts"]').count() == 1)
    check("TCS retained under Dismissed",
          pg.locator('section[aria-label="Dismissed alerts"]').get_by_text("TCS").count() > 0)

    # active delete stays a real delete
    before = len(STATE["alerts"])
    pg.get_by_role("button", name="Delete alert for RELIANCE").click()
    pg.wait_for_timeout(800)
    check("active delete removed row", len(STATE["alerts"]) == before - 1)

    # reload from server truth: archived record survives
    pg.keyboard.press("Escape")
    pg.wait_for_timeout(400)
    pg.get_by_role("button", name="Alert center").click()
    pg.wait_for_timeout(800)
    check("archived row survives reopen",
          pg.locator('section[aria-label="Dismissed alerts"]').get_by_text("TCS").count() > 0)

    # axe over the open dialog state (AC5)
    pg.add_script_tag(path="scripts/tests/ui/vendor/axe.min.js")
    pg.wait_for_timeout(1200)
    res = pg.evaluate("""async () => {
      const r = await window.axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] }
      });
      return r.violations.map(v => ({ id: v.id, nodes: v.nodes.length, help: v.help }));
    }""")
    check(f"axe 0 violations ({res})", len(res) == 0)

    b.close()

print("\nRESULT:", "ALL PASS" if not fails else f"FAILURES: {fails}")
sys.exit(1 if fails else 0)
