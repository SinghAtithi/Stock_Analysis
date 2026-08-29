"""TASK-1418 — /compare sanity: both symbols render, fundamentals diff
highlights, overlay present, strategy scores, URL sync on pick, axe 0 in
light+dark, mobile stack at 390px. Run against the dev server:
  python3 scripts/tests/ui/compare.py --url http://localhost:3213
axe is injected via page.evaluate (vendored file read in Python) — the repo
CSP blocks script tags; this is the working pattern (see tax_lots.py)."""
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
    failed_reqs = []
    pg = b.new_page(viewport={"width": 1440, "height": 1000})
    pg.on("console", lambda m: errs.append(m.text[:140]) if m.type == "error" else None)
    pg.on("pageerror", lambda e: errs.append(f"pageerror: {str(e)[:300]}"))
    pg.on("response", lambda r: failed_reqs.append(f"{r.status} {r.url[:120]}") if r.status >= 400 else None)

    # --- deep link loads both symbols -------------------------------------
    pg.goto(f"{BASE}/compare?a=RELIANCE&b=TCS&r=1y", wait_until="domcontentloaded", timeout=60000)
    pg.wait_for_timeout(9000)

    body = pg.locator("body").text_content() or ""
    check("h1 Compare two symbols", "Compare two symbols" in body)
    check("RELIANCE renders", "RELIANCE" in body and "RELIANCE INDUSTRIES" in body)
    check("TCS renders", "TCS" in body and "TATA CONSULTANCY" in body)
    check("quote price present", any(s in body for s in ["₹1,", "₹2", "₹3", "₹4"]))
    check("performance overlay present", "Performance since start" in body)
    check("overlay legend pct", "since start" in body)
    check("fundamentals table present", "Fundamentals" in body)
    check("strategy scores present", "Strategy scores" in body and "Momentum Factor" in body)

    # fundamentals better-cell highlight: expected winner count computed from
    # the live API payloads (direction-aware: lower better for valuation/
    # leverage, higher better for returns/margins/yields, neutral = none);
    # ties produce no tint by design (identical fixture rows ⇒ 0 expected)
    fund = pg.evaluate("""async () => {
      const mk = async (s) => { const r = await fetch('/api/fundamentals?symbol=' + s); return r.ok ? (await r.json()).metrics : null; };
      return { a: await mk('RELIANCE'), b: await mk('TCS') };
    }""")
    LOWER = {"trailingPe", "forwardPe", "priceToBook", "priceToSales", "debtToEquity"}
    HIGHER = {"currentRatio", "returnOnEquity", "returnOnAssets", "grossMargin", "operatingMargin", "netMargin", "dividendYield"}
    def num(v):
        return v if isinstance(v, (int, float)) and v == v else None
    expected = 0
    if fund["a"] and fund["b"]:
        for k in LOWER | HIGHER:
            va, vb = num(fund["a"].get(k)), num(fund["b"].get(k))
            if va is None or vb is None or va == vb:
                continue
            better = min(va, vb) if k in LOWER else max(va, vb)
            if better in (va, vb):
                expected += 1
    tints = pg.locator(".bg-up-soft").count()
    check(f"better-cell tints match expected winners (got {tints}, expected {expected})", tints == expected)

    # strategy score columns: both sides have numbers for S100/S101
    score_cells = pg.locator("section[aria-label='Strategy scores'] .font-mono.text-sm").count()
    check(f"strategy score cells rendered (got {score_cells})", score_cells >= 4)

    # URL synced (pushState writes a=/b=/r=)
    check("url carries a=RELIANCE&b=TCS", "a=RELIANCE" in pg.url and "b=TCS" in pg.url and "r=1y" in pg.url)

    # --- search pick syncs URL ---------------------------------------------
    pg.keyboard.press("/")
    pg.wait_for_timeout(400)
    pg.keyboard.type("HDFCBANK")
    pg.wait_for_timeout(1200)
    pg.keyboard.press("Enter")
    pg.wait_for_timeout(7000)
    check("pick syncs URL param", "a=HDFCBANK" in pg.url or "b=HDFCBANK" in pg.url)
    check("picked symbol renders", "HDFCBANK" in (pg.locator("body").text_content() or ""))

    # --- axe: light + dark ------------------------------------------------
    res = axe_run(pg)
    check(f"axe 0 violations light (got {res['v']}: {res['ids']})", res["v"] == 0)

    pg.evaluate("localStorage.setItem('nifty-theme','dark')")
    pg.reload(wait_until="domcontentloaded")
    pg.wait_for_timeout(7000)
    check("dark class applied", pg.evaluate("document.documentElement.classList.contains('dark')"))
    res2 = axe_run(pg)
    check(f"axe 0 violations dark (got {res2['v']}: {res2['ids']})", res2["v"] == 0)
    pg.evaluate("localStorage.setItem('nifty-theme','light')")

    # --- mobile 390px: stacks vertically, no horizontal overflow ----------
    pg2 = b.new_page(viewport={"width": 390, "height": 844})
    errs2 = []
    pg2.on("console", lambda m: errs2.append(m.text[:140]) if m.type == "error" else None)
    pg2.goto(f"{BASE}/compare?a=RELIANCE&b=TCS", wait_until="domcontentloaded", timeout=60000)
    pg2.wait_for_timeout(9000)
    over = pg2.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
    check(f"390px no horizontal overflow (got {over}px)", over <= 0)
    # fundamentals rows stack: label, A, B on separate lines → cell symbols visible
    m_body = pg2.locator("body").text_content() or ""
    check("390px fundamentals symbols shown inline", "RELIANCE" in m_body and "TCS" in m_body)
    res3 = axe_run(pg2)
    check(f"axe 0 violations mobile (got {res3['v']}: {res3['ids']})", res3["v"] == 0)

    # --- console errors + 4xx responses ------------------------------------
    real_errs = [e for e in errs if "favicon" not in e and "Download the React DevTools" not in e]
    check(f"no console errors (got {len(real_errs)})", len(real_errs) == 0)
    real_fails = [f for f in failed_reqs if "/api/" in f and "rate_limited" not in f]
    check(f"no failed api responses (got {len(real_fails)})", len(real_fails) == 0)

    b.close()

print("\n" + ("ALL CHECKS PASSED" if not fails else f"{len(fails)} FAILURES: " + "; ".join(fails)))
sys.exit(1 if fails else 0)