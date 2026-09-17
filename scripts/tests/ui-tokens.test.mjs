import test from "node:test";
import assert from "node:assert/strict";
import {
  findColorLiterals,
  isNeutralOverlay,
  matchesPattern,
  ALLOWED_FILES,
} from "../check-ui-tokens.mjs";

test("flags hex literals on plain lines", () => {
  const hits = findColorLiterals(`const c = "#ff0000";`, "web/src/app/x/page.tsx");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].kind, "hex");
  assert.equal(hits[0].line, 1);
});

test("ignores literals inside token(name, fallback) reads", () => {
  const src = `const up = token("--color-up", dark ? "#8ec9a8" : "#0e7a3a");`;
  assert.deepEqual(findColorLiterals(src, "web/src/app/y/page.tsx"), []);
});

test("ignores files on the sanctioned allowlist (exact + glob)", () => {
  for (const file of ALLOWED_FILES.keys()) {
    const sample = file.replace("*", "any");
    assert.deepEqual(
      findColorLiterals(`const c = "#123456";`, sample),
      [],
      `${file} should be sanctioned`
    );
  }
  assert.deepEqual(
    findColorLiterals(`const c = "#123456";`, "web/src/app/s/[symbol]/opengraph-image.tsx"),
    []
  );
});

test("allows neutral alpha overlays, flags chromatic or opaque colors", () => {
  assert.ok(isNeutralOverlay("rgba", "255,255,255,0.06"));
  assert.ok(isNeutralOverlay("rgba", "17,18,20,0.06")); /* spread 3 */
  assert.ok(isNeutralOverlay("rgba", "0,0,0,0.25"));
  assert.ok(!isNeutralOverlay("rgb", "255,255,255")); /* opaque */
  assert.ok(!isNeutralOverlay("rgba", "37,99,235,0.9")); /* chromatic */
  assert.ok(!isNeutralOverlay("hsl", "0,0%,0%,0.5")); /* hsl unsanctioned */
});

test("flags rgb/hsl calls in components", () => {
  const hits = findColorLiterals(
    `const a = rgba(37,99,235,0.9);\nconst b = "hsl(210 40% 40%)";`,
    "web/src/app/z/page.tsx"
  );
  assert.equal(hits.length, 2);
  assert.equal(hits[0].kind, "rgba");
});

test("matchesPattern: star crosses path separators", () => {
  assert.ok(matchesPattern("web/src/app/s/[symbol]/opengraph-image.tsx", "web/src/*/opengraph-image.tsx"));
  assert.ok(matchesPattern("web/src/lib/kanban/agents.ts", "web/src/lib/kanban/*.ts"));
  assert.ok(!matchesPattern("web/src/app/board/page.tsx", "web/src/lib/kanban/*.ts"));
});
