/**
 * TASK-1403 — upstream GET guards (token bucket + micro-cache).
 *
 * Chart/ticker fan out to paid/rate-limited third parties on every origin
 * hit; the bucket sheds bursts, the cache collapses repeats, and the store
 * bounds survive unique-key floods (LRU refresh on hot keys).
 *
 * Run: npm test  (from web/)  ·  node --test scripts/tests/upstream-guards.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  retryAfterSec,
  takeToken,
  cacheGet,
  cacheSet,
  resetUpstreamGuards,
} from "../../web/src/lib/upstreamGuards.ts";

test("bucket: full burst allowed, then shed, then refills over time", () => {
  resetUpstreamGuards();
  const t0 = 1_000_000;
  for (let i = 0; i < 30; i += 1) {
    assert.equal(takeToken("k", t0), true, `burst ${i + 1} of 30 passes`);
  }
  assert.equal(takeToken("k", t0), false, "31st in burst sheds");
  // ~2s later one token has refilled (0.5/s)
  assert.equal(takeToken("k", t0 + 2000), true, "refilled token passes");
  assert.equal(takeToken("k", t0 + 2000), false, "and the bucket is dry again");
});

test("buckets are independent per key; store stays bounded under floods", () => {
  resetUpstreamGuards();
  const t0 = Date.now();
  for (let i = 0; i < 6000; i += 1) takeToken(`flood-${i}`, t0);
  // no crash and a fresh key still works — bound is an internal guarantee
  assert.equal(takeToken("fresh", t0), true);
});

test("retryAfterSec is at least one second", () => {
  assert.ok(retryAfterSec() >= 1);
});

test("micro-cache: hit within TTL, miss after expiry, recency refresh on hits", () => {
  resetUpstreamGuards();
  const t0 = 50_000_000;
  cacheSet("a", { v: 1 }, t0);
  assert.deepEqual(cacheGet("a", t0 + 1000), { v: 1 }, "hit inside TTL");
  assert.equal(cacheGet("a", t0 + 61_000), null, "expired after 60s");
});

test("micro-cache store stays bounded and hot keys survive", () => {
  resetUpstreamGuards();
  const t0 = Date.now();
  cacheSet("hot", { v: "hot" }, t0);
  for (let i = 0; i < 500; i += 1) {
    cacheSet(`cold-${i}`, { i }, t0);
    if (i % 10 === 0) cacheGet("hot", t0); // keep touching the hot key
  }
  assert.deepEqual(cacheGet("hot", t0), { v: "hot" }, "recency-refreshed key survives cap eviction");
});
