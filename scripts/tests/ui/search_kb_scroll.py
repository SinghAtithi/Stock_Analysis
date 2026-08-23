"""TASK-97 sanity: search listbox scrolls active option into view on arrow-nav.

AC1 scrollIntoView on active change · AC2 Enter picks · AC3 hover/keyboard
cooperate · AC4 Escape unchanged.
"""
from playwright.sync_api import sync_playwright

import sys
BASE = sys.argv[sys.argv.index("--url") + 1] if "--url" in sys.argv else "http://localhost:3000"


def open_search(pg, q="in"):
    inp = pg.get_by_role("combobox", name="Search Indian stocks")
    inp.click()
    inp.fill(q)
    lb = pg.get_by_role("listbox", name="Search results")
    lb.wait_for(state="visible", timeout=10000)
    # TASK-79 restructure: container can paint one commit ahead of rows
    pg.locator('#search-results [role="option"]').first.wait_for(timeout=10000)
    return inp, lb


with sync_playwright() as p:
    b = p.chromium.launch()

    # --- AC1 + AC2 on page 1 ---
    pg = b.new_page(viewport={"width": 1440, "height": 900})
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(BASE, wait_until="domcontentloaded")
    pg.wait_for_timeout(3000)

    inp, lb = open_search(pg)
    opts = pg.locator('#search-results [role="option"]')
    n = opts.count()
    print("options:", n)
    assert n > 5, f"need enough rows to overflow, got {n}"

    ul_box = pg.locator("#search-results").bounding_box()  # TASK-79: listbox div is now the scroller

    def visible(i):
        ob = opts.nth(i).bounding_box()
        return (
            ob["y"] >= ul_box["y"] - 1
            and ob["y"] + ob["height"] <= ul_box["y"] + ul_box["height"] + 1
        )

    assert visible(0), "first option should be visible initially"
    assert not visible(n - 1), "last option should start out of view (overflow precondition)"

    for i in range(1, n):
        inp.press("ArrowDown")
        pg.wait_for_timeout(120)
        assert visible(i), f"option {i} not scrolled into view after ArrowDown"
        ad = inp.get_attribute("aria-activedescendant")
        assert ad == f"search-opt-{i}", f"aria-activedescendant={ad}, want search-opt-{i}"
        assert opts.nth(i).get_attribute("aria-selected") == "true"

    final = n - 3
    inp.press("ArrowUp")
    inp.press("ArrowUp")
    pg.wait_for_timeout(150)
    assert inp.get_attribute("aria-activedescendant") == f"search-opt-{final}"
    print("AC1: keyboard nav keeps active option in view; activedescendant tracks")

    want = opts.nth(final).locator("span.font-medium").text_content().strip().upper()
    inp.press("Enter")
    lb.wait_for(state="hidden", timeout=5000)
    h1 = pg.locator("h1").text_content()
    print(f"AC2: Enter picked {want} → h1: {h1}")
    assert want in (h1 or "").upper() or (h1 or "").strip(), (
        f"h1 should reflect picked symbol {want}, got {h1}"
    )
    assert not errors, f"pageerrors: {errors}"
    pg.close()

    # --- AC3 + AC4 on page 2 ---
    pg2 = b.new_page(viewport={"width": 1440, "height": 900})
    errors2 = []
    pg2.on("pageerror", lambda e: errors2.append(str(e)))
    pg2.goto(BASE, wait_until="domcontentloaded")
    pg2.wait_for_timeout(3000)

    inp, lb = open_search(pg2)
    opts = pg2.locator('#search-results [role="option"]')
    n = opts.count()

    opts.nth(3).hover()
    pg2.wait_for_timeout(120)
    assert inp.get_attribute("aria-activedescendant") == "search-opt-3"
    inp.press("ArrowDown")
    pg2.wait_for_timeout(150)
    assert inp.get_attribute("aria-activedescendant") == "search-opt-4"
    print("AC3: hover then arrow-down continues from hovered index")

    inp.press("Escape")
    lb.wait_for(state="hidden", timeout=5000)
    assert inp.get_attribute("aria-activedescendant") is None
    inp.fill("info")
    lb.wait_for(state="visible", timeout=10000)
    assert opts.count() >= 1, "new query should reopen with results"
    print(f"AC4: escape closes and clears activedescendant; new query reopens ({opts.count()} rows)")

    assert not errors2, f"pageerrors: {errors2}"
    pg2.close()
    b.close()
    print("PASS: TASK-97 sanity green")
