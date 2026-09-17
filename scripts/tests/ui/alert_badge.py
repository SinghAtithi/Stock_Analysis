from playwright.sync_api import sync_playwright

import sys
BASE = sys.argv[sys.argv.index("--url") + 1] if "--url" in sys.argv else "http://localhost:3000"

AXE = "scripts/tests/ui/vendor/axe.min.js"
# TASK-1395 ships a nonce-based script-src CSP: page.add_script_tag() injects
# inline and is blocked. Runtime.evaluate goes through CDP and is CSP-immune,
# so load axe's source and evaluate it instead.
AXE_SRC = open(AXE, encoding="utf-8").read()

# TASK-1521: a fired-but-unseen alert drives the bell badge. Mock it so the
# badge renders without a live DB — this is the state axe missed (the badge
# only mounts when unanswered fires exist).
FIRED_ALERT = {
    "alerts": [
        {
            "id": "probe-fired-1",
            "symbol": "RELIANCE",
            "exchange": "NSE",
            "type": "price_above",
            "price": 2900.0,
            "active": False,
            "firedAt": 1787500000,
            "dismissedAt": None,
        }
    ]
}

fails = []
def check(name, cond):
    print(("PASS " if cond else "FAIL ") + name)
    if not cond:
        fails.append(name)

def contrast_report(pg):
    """Rendered-style WCAG ratio for the fired badge.

    axe parks this badge in 'incomplete' (absolutely positioned over a button
    background it will not resolve), so the guard must measure the computed
    colors itself — that is exactly how the 3.49/1.77/2.65:1 debt slipped
    past every axe-only run (TASK-1521)."""
    pg.evaluate(AXE_SRC)  # CSP-immune injection (see AXE_SRC note)
    return pg.evaluate("""async () => {
      const el = document.querySelector('button[aria-label*="newly fired"] span');
      if (!el) return { error: 'badge not found' };
      const cs = getComputedStyle(el);
      const nums = (s) => (s.match(/[\\d.]+/g) || []).map(Number);
      const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
      const L = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
      const fg = nums(cs.color), bg = nums(cs.backgroundColor);
      if (bg.length < 3) return { error: 'unparsable badge bg: ' + cs.backgroundColor };
      if (bg.length >= 4 && bg[3] === 0) return { error: 'transparent badge bg', fg: cs.color };
      const a = L(fg), b = L(bg);
      const [hi, lo] = a > b ? [a, b] : [b, a];
      const axe = await window.axe.run(el, { runOnly: { type: 'rule', values: ['color-contrast'] } });
      return {
        fg: cs.color, bg: cs.backgroundColor,
        ratio: (hi + 0.05) / (lo + 0.05),
        axeViolations: axe.violations.length,
        axeIncomplete: axe.incomplete.length,
      };
    }""")

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1440, "height": 900})
    pg.route("**/api/**", lambda r: r.fulfill(json={}))
    pg.route("**/api/alerts**", lambda r: r.fulfill(json=FIRED_ALERT))

    for theme in ("light", "dark", "contrast"):
        pg.goto(f"{BASE}/", wait_until="domcontentloaded", timeout=90000)
        pg.evaluate(f"localStorage.setItem('nifty-theme', '{theme}')")
        pg.goto(f"{BASE}/", wait_until="domcontentloaded", timeout=90000)
        # badge must be visible: bell aria-label announces newly fired
        bell = pg.locator('button[aria-label*="newly fired"]')
        bell.wait_for(state="visible", timeout=20000)
        badge = bell.locator("span").first
        text = (badge.text_content() or "").strip()
        check(f"[{theme}] fired badge renders count", text == "1")

        pg.wait_for_timeout(400)
        rep = contrast_report(pg)
        print(f"    [{theme}] fg={rep.get('fg')} bg={rep.get('bg')} ratio={rep.get('ratio', 0):.2f}"
              f" axe_inc={rep.get('axeIncomplete')}")
        if "error" in rep:
            check(f"[{theme}] badge contrast measurable", False)
        else:
            check(f"[{theme}] badge ratio >= 4.5 (AA)", rep["ratio"] >= 4.5)
            check(f"[{theme}] axe color-contrast clean", rep["axeViolations"] == 0)

    b.close()

print("\nRESULT:", "ALL PASS" if not fails else f"FAILURES: {fails}")
sys.exit(1 if fails else 0)
