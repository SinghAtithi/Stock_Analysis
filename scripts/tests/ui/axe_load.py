"""Load the vendored axe-core into a Playwright page without inline injection.

Why this exists (TASK-1532 / TASK-1526): the app ships a nonce-based
Content-Security-Policy (`web/src/proxy.ts`, TASK-1395) that forbids inline
scripts. Playwright's `page.add_script_tag(path=...)` injects an *inline*
<script>, so the CSP blocks it and every `axe*.py` scan dies with
"Executing inline script violates ... script-src". That would take the whole
a11y tier (local UNSLOPIFY checklist + CI ui-smoke) offline the moment the CSP
lands.

Fix: serve the vendored file from a same-origin URL — `script-src 'self'`
already allows it — and satisfy the request with Playwright routing so the run
stays fully offline (no CDN dependency, unlike a bare `url=https://...`).

Usage:
    from axe_load import load_axe

    pg.goto(...); pg.wait_for_timeout(...)
    load_axe(pg)                 # axe is now on window
    pg.evaluate("async () => (await window.axe.run(document))...")
"""

import os

AXE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "vendor", "axe.min.js")
AXE_URL = "/__axe.min.js"  # same-origin path ⇒ permitted by `script-src 'self'`


def load_axe(page, axe_path=AXE_PATH, url=AXE_URL):
    """Route `url` to the vendored axe-core and add it as an external script."""
    with open(axe_path, "rb") as fh:
        body = fh.read()
    page.route(
        f"**{url}",
        lambda route: route.fulfill(
            status=200, content_type="application/javascript", body=body
        ),
    )
    page.add_script_tag(url=url)
