import test from "node:test";
import assert from "node:assert/strict";

/* TASK-1548 — Yahoo 429 backoff: the module header says "pure so it can be
   unit-tested", but no suite ever landed. Jitter is random, so assertions
   pin the deterministic bounds, not exact values. */

const bo = await import("../../web/src/lib/backoff.ts");

test("constants match the documented policy", () => {
  assert.equal(bo.YAHOO_BACKOFF_BASE_MS, 60_000);
  assert.equal(bo.YAHOO_BACKOFF_MAX_MS, 900_000);
  assert.equal(bo.YAHOO_BACKOFF_JITTER_MS, 15_000);
});

test("n=0 waits the base minute plus up to 15s jitter", () => {
  for (let i = 0; i < 25; i++) {
    const out = bo.nextBackoff(0);
    assert.ok(out >= 60_000 && out < 75_000, `out of bounds: ${out}`);
  }
});

test("waits double per consecutive failure", () => {
  for (let i = 0; i < 25; i++) {
    const b1 = bo.nextBackoff(1);
    assert.ok(b1 >= 120_000 && b1 < 135_000, `n=1 out of bounds: ${b1}`);
    const b2 = bo.nextBackoff(2);
    assert.ok(b2 >= 240_000 && b2 < 255_000, `n=2 out of bounds: ${b2}`);
  }
});

test("waits cap at 15 minutes plus jitter, never beyond", () => {
  for (const n of [4, 10, 100, Number.MAX_SAFE_INTEGER]) {
    const out = bo.nextBackoff(n);
    assert.ok(out >= 900_000 && out < 915_000, `n=${n} out of bounds: ${out}`);
  }
});

test("hostile n values degrade to the base wait, never NaN/negative", () => {
  for (const n of [-5, 0.5, Number.NaN, -Infinity]) {
    const out = bo.nextBackoff(n);
    assert.ok(Number.isFinite(out) && out >= 60_000 && out < 75_000, `n=${n}: ${out}`);
  }
  const inf = bo.nextBackoff(Number.POSITIVE_INFINITY);
  assert.ok(inf >= 900_000 && inf < 915_000);
});
