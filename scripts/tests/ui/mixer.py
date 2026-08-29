"""TASK-1377 mixer UI probe — pick strategies, slide weights, build composite,
save/apply/delete mix presets, tier cap, axe light+dark, mobile overflow.
Usage: python3 scripts/tests/ui/mixer.py --url http://localhost:3215
"""
from playwright.sync_api import sync_playwright
import sys

BASE = sys.argv[sys.argv.index("--url") + 1] if "--url" in sys.argv else "http://localhost:3000"

fails = []
def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + (f"  [{extra}]" if extra else ""))
    if not cond:
        fails.append(name)

def load_axe(pg):
    return pg.evaluate("""async () => {
        if (window.axe) return true;
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.0/axe.min.js';
            s.onload = () => resolve(true);
            s.onerror = () => reject(new Error('axe load failed'));
            document.head.appendChild(s);
        });
    }""")

def run_axe(pg, label):
    load_axe(pg)
    pg.wait_for_timeout(800)
    res = pg.evaluate("""async () => {
        const r = await window.axe.run(document);
        return { v: r.violations.length, ids: [...new Set(r.violations.map(x => x.id))] };
    }""")
    check(f"axe 0 violations ({label})", res["v"] == 0, f"violations={res['ids']}")

with sync_playwright() as p:
    b = p.chromium.launch()
    errs = []
    pg = b.new_page(viewport={"width": 1440, "height": 900})
    pg.on("console", lambda m: errs.append(f"{m.type}: {m.text[:150]}") if m.type == "error" else None)
    pg.on("pageerror", lambda e: errs.append(f"pageerror: {str(e)[:150]}"))

    pg.goto(f"{BASE}/mixer", wait_until="domcontentloaded", timeout=60000)
    pg.wait_for_timeout(6000)

    check("h1 'Strategy mixer'", pg.locator("h1", has_text="Strategy mixer").count() == 1)
    check("0 console/page errors", len(errs) == 0, errs[:2])

    # AC1 — picker shows registry with jury rank
    check("strategy rows with Jury badges", pg.locator("text=Jury #").count() >= 5)
    check("limit note (top 10)", pg.locator("text=Top 10 jury-ranked").count() == 1)

    # AC2 — check two strategies, sliders appear, normalized sum = 100
    boxes = pg.get_by_role("checkbox")
    check("checkboxes rendered", boxes.count() >= 5)
    boxes.nth(0).check()
    boxes.nth(1).check()
    pg.wait_for_timeout(400)
    sliders = pg.get_by_role("slider")
    check("two weight sliders after picking", sliders.count() == 2)
    check("normalized sum 100 shown", pg.locator("text=normalized sum 100").count() >= 1)
    # slide the first to 30 → 30/70 split, still 100
    sliders.nth(0).fill("30")
    pg.wait_for_timeout(300)
    check("slider edit keeps sum 100", pg.locator("text=normalized sum 100").count() >= 1)

    # AC3 — build composite, table renders from API
    pg.get_by_role("button", name="Build composite").click()
    pg.wait_for_timeout(5000)
    check("composite table rendered", pg.locator("table", has_text="Composite").count() == 1)
    check("meta line Jury + weight + as of", pg.locator("text=as of").count() >= 1)
    check("no console errors after compute", len(errs) == 0, errs[:2])

    # AC4 — save preset, persists across reload
    pg.get_by_role("button", name="Save mix").click()
    pg.get_by_label("Mix name").fill("My momentum mix")
    pg.get_by_role("button", name="Save", exact=True).click()
    pg.wait_for_timeout(400)
    check("save notice shown", pg.locator("text=“My momentum mix” saved").count() == 1)
    check("saved mixes counter 1", pg.locator("text=Saved mixes 1").count() == 1)
    pg.reload(wait_until="domcontentloaded")
    pg.wait_for_timeout(6000)
    check("preset persists across reload", pg.get_by_role("button", name="Saved mixes, 1 available").count() == 1)
    # apply preset reloads weights + recomputes
    pg.get_by_role("button", name="Saved mixes, 1 available").click()
    pg.locator("li", has_text="My momentum mix").get_by_role("button").first.click()
    pg.wait_for_timeout(4000)
    check("preset apply recomputes composite", pg.locator("table", has_text="Composite").count() == 1)

    # AC5 — free tier cap at 2 mixes
    for name in ("Second mix", "Third mix"):
        pg.get_by_role("button", name="Save mix").click()
        pg.get_by_label("Mix name").fill(name)
        pg.get_by_role("button", name="Save", exact=True).click()
        pg.wait_for_timeout(300)
    check("third save blocked by tier cap", pg.locator("text=Free plan keeps 2 saved mixes").count() >= 1)
    check("two mixes kept", pg.get_by_role("button", name="Saved mixes, 2 available").count() == 1)
    # delete one frees a slot
    pg.get_by_role("button", name="Saved mixes, 2 available").click()
    pg.locator("li", has_text="Second mix").get_by_role("button").nth(1).click()
    pg.wait_for_timeout(300)
    check("delete works (undo row)", pg.locator("text=Deleted").count() == 1)
    pg.get_by_role("button", name="Undo").click()
    pg.wait_for_timeout(300)
    check("undo restores", pg.get_by_role("button", name="Saved mixes, 2 available").count() == 1)

    run_axe(pg, "light")

    # dark theme — toggle + rerun axe
    pg.get_by_role("button", name="Switch to dark mode").click()
    pg.wait_for_timeout(800)
    run_axe(pg, "dark")

    # API shape sanity
    api = pg.request.post(f"{BASE}/api/mixer", data='{"strategies":[{"strategyId":"S100","weight":70},{"strategyId":"S101","weight":30}]}', headers={"Content-Type": "application/json"})
    check("/api/mixer 200", api.status == 200)
    j = api.json()
    check("items sorted desc by score", len(j.get("items", [])) > 0 and
          all(j["items"][i]["score"] >= j["items"][i + 1]["score"] for i in range(min(5, len(j["items"]) - 1))))
    check("sub-scores per item", len(j.get("items", [])) > 0 and len(j["items"][0]["subScores"]) >= 1)
    check("meta strategies carry asOf+covered", all("asOf" in s and "covered" in s for s in j["meta"]["strategies"]))
    bad = pg.request.post(f"{BASE}/api/mixer", data='{"strategies":[{"strategyId":"nope-1","weight":100}]}', headers={"Content-Type": "application/json"})
    check("unknown strategy -> 400", bad.status == 400)
    zero = pg.request.post(f"{BASE}/api/mixer", data='{"strategies":[{"strategyId":"S100","weight":0}]}', headers={"Content-Type": "application/json"})
    check("all-zero weights -> 400", zero.status == 400)

    b.close()

    # mobile 390px — no horizontal overflow
    m = p.chromium.launch()
    mp = m.new_page(viewport={"width": 390, "height": 844})
    mp.goto(f"{BASE}/mixer", wait_until="domcontentloaded", timeout=60000)
    mp.wait_for_timeout(6000)
    boxes = mp.get_by_role("checkbox")
    boxes.nth(0).check()
    boxes.nth(1).check()
    mp.get_by_role("button", name="Build composite").click()
    mp.wait_for_timeout(5000)
    sw = mp.evaluate("document.documentElement.scrollWidth")
    cw = mp.evaluate("document.documentElement.clientWidth")
    check("mobile 390px no page overflow", sw <= cw, f"scrollWidth={sw} clientWidth={cw}")
    m.close()

print()
print("FAILED:", fails if fails else "none")
sys.exit(1 if fails else 0)