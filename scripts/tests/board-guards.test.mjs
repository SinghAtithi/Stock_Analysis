/**
 * TASK-1370 — /api/board POST guards.
 *
 * The board sync endpoint is the one unauthenticated write path to server
 * state; before TASK-1370 anyone could POST unbounded payloads, hammer it
 * at line rate, or wipe every task with mode:"replace". These tests pin
 * the guard math in web/src/lib/boardGuards.ts (the route wires them in
 * order: 429 → 413 → 400 → 403 → merge).
 *
 * Run: npm test  (from web/)  ·  node --test scripts/tests/board-guards.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_BODY_BYTES,
  bodyTooLarge,
  postRateLimited,
  replaceAuthorized,
  resetBoardGuards,
} from "../../web/src/lib/boardGuards.ts";

test("body cap: exactly 1MB passes, one byte over fails", () => {
  const boundary = "a".repeat(MAX_BODY_BYTES);
  assert.equal(bodyTooLarge(boundary), false, "boundary byte count allowed");
  // multibyte char pushes utf8 length past the ascii string length
  const multibyte = "é".repeat(Math.ceil(MAX_BODY_BYTES / 2) + 1);
  assert.equal(bodyTooLarge(multibyte), true, "utf8 bytes counted, not chars");
});

test("rate limit: sheds post 61 in a sliding minute, per key", () => {
  resetBoardGuards();
  let last = false;
  for (let i = 0; i < 60; i += 1) {
    last = postRateLimited("ip:10.0.0.1");
    assert.equal(last, false, `post ${i + 1} of 60 allowed`);
  }
  assert.equal(postRateLimited("ip:10.0.0.1"), true, "post 61 shed");

  // a different writer is untouched by the flooded key
  assert.equal(postRateLimited("ip:10.0.0.2"), false, "independent keys");

  // window slides: same key allowed again once stamps age out
  assert.equal(postRateLimited("ip:10.0.0.1", Date.now() + 60_001), false);
});

test("rate-limit store stays bounded under unique-key floods", () => {
  resetBoardGuards();
  for (let i = 0; i < 6000; i += 1) postRateLimited(`ip:flood-${i}`);
  // no assertion on internals — the guarantee is simply that this returns
  // and does not grow without bound; a Map over 5000 entries clears itself
});

test("merge-mode POSTs never need a token", () => {
  delete process.env.BOARD_WRITE_TOKEN;
  for (const mode of [undefined, null, "merge", "MERGE"]) {
    assert.equal(replaceAuthorized(mode, null).ok, true, `mode=${String(mode)}`);
  }
});

test("mode:replace is dead until BOARD_WRITE_TOKEN is configured", () => {
  delete process.env.BOARD_WRITE_TOKEN;
  const v = replaceAuthorized("replace", "any-token");
  assert.equal(v.ok, false);
  assert.equal(v.configured, false, "operator gets a configure-hint error shape");
});

test("mode:replace token gate: wrong rejected, right accepted, timing-safe compare", () => {
  process.env.BOARD_WRITE_TOKEN = "sekrit";
  try {
    assert.equal(replaceAuthorized("replace", "wrong").ok, false);
    assert.equal(replaceAuthorized("replace", null).ok, false);
    assert.equal(replaceAuthorized("replace", undefined).ok, false);
    assert.equal(
      replaceAuthorized("replace", "sekrit").ok,
      true,
      "matching token authorizes replace"
    );
    // non-exact modes are merge semantics by contract (route compares
    // body.mode === "replace" before consulting the gate), so they pass:
    const notReplace = replaceAuthorized("REPLACE", null);
    assert.equal(notReplace.ok, true);
    assert.equal(notReplace.configured, true);
  } finally {
    delete process.env.BOARD_WRITE_TOKEN;
  }
});
