from playwright.sync_api import sync_playwright

import sys
BASE = sys.argv[sys.argv.index("--url") + 1] if "--url" in sys.argv else "http://localhost:3000"

STRATEGIES = {
    "strategies": [
        {"id": "demo-roc20", "name": "ROC(20) Momentum", "category": "momentum", "juryRank": None, "edgeScore": None, "universe": "nifty500", "inputs": []},
        {"id": "demo-52wlow", "name": "52W High Distance", "category": "trend", "juryRank": None, "edgeScore": None, "universe": "nifty500", "inputs": []},
    ]
}

def signals_payload(as_of):
    return {
        "strategy": {"id": "demo-roc20", "name": "ROC(20) Momentum", "juryRank": None, "edgeScore": None, "asOf": as_of},
        "meta": {"count": 3, "universe": "nifty500"},
        "items": [
            {"rank": 1, "symbol": "RELIANCE", "name": "Reliance Industries", "sector": "Energy", "indices": [], "score": 91.2, "components": {}, "price": 1310.5, "changePct": 0.42},
            {"rank": 2, "symbol": "TCS", "name": "Tata Consultancy Services", "sector": "IT", "indices": [], "score": 77.5, "components": {}, "price": 4120.3, "changePct": -0.18},
            {"rank": 3, "symbol": "HDFCBANK", "name": "HDFC Bank", "sector": "Financials", "indices": [], "score": 63.1, "components": {}, "price": 1687.0, "changePct": 0.05},
        ],
    }

fails = []
def check(name, cond):
    print(("PASS " if cond else "FAIL ") + name)
    if not cond:
        fails.append(name)

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1440, "height": 900})
    errs = []
    failed = []
    pg.on("console", lambda m: errs.append(m.text[:120]) if m.type == "error" else None)
    pg.on(
        "response",
        lambda r: failed.append(f"{r.status} {r.url[:120]}") if r.status >= 400 else None,
    )
    pg.route("**/api/strategies", lambda r: r.fulfill(json=STRATEGIES))
    pg.route("**/api/signals**", lambda r: r.fulfill(json=signals_payload(1787500000)))
    # AlertCenter (SiteHeader, every page) fetches /api/alerts?deviceId= on
    # mount; DB-less environments legitimately 503 it — mock the empty list.
    pg.route("**/api/alerts**", lambda r: r.fulfill(json={"alerts": []}))
    pg.goto(f"{BASE}/screener", wait_until="networkidle")
    pg.wait_for_timeout(2500)

    check("h1 renders", (pg.locator("h1").text_content() or "").strip() != "")
    check("3 mocked rows", pg.locator("tbody tr").count() == 3)
    first_before = pg.locator("tbody tr").first.locator("td").nth(4).text_content()
    # sort by score — tri-state asc puts the lowest first
    pg.get_by_role("button", name="SCORE").click()
    pg.wait_for_timeout(400)
    first_after = pg.locator("tbody tr").first.locator("td").nth(4).text_content()
    check(f"score sort reorders ({first_before} -> {first_after})", first_before != first_after)

    # keyboard nav: focus table, ArrowDown selects, Enter deep-links to chart
    pg.evaluate("document.querySelector('table[tabindex=\"0\"]')?.focus()")
    pg.keyboard.press("ArrowDown")
    pg.keyboard.press("Enter")
    pg.wait_for_timeout(3000)
    check("keyboard nav navigates to chart", "s=" in pg.url)

    # strategy switch reloads rows under the same mock
    pg.goto(f"{BASE}/screener", wait_until="networkidle")
    pg.wait_for_timeout(2000)
    pg.locator("button", has_text="ROC(20)").first.click()
    pg.wait_for_timeout(2000)
    check("rows survive strategy switch", pg.locator("tbody tr").count() == 3)

    check("no console errors", len(errs) == 0)
    for e in errs[:3]:
        print("  err:", e)
    if failed:
        print("  failed responses (may explain console errors):")
        for u in failed[:6]:
            print("   -", u)
    b.close()

print("\nRESULT:", "ALL PASS" if not fails else f"FAILURES: {fails}")
sys.exit(1 if fails else 0)
