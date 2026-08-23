/**
 * TASK-1412 — internal-error bodies must not leak server details.
 *
 * api/board used to return raw e.message in 500s; Node fs errors embed
 * absolute paths, so any client could read "/home/<user>/.../board.json".
 * These pin the contract of web/src/lib/serverError.ts: the CLIENT body is
 * generic + scope-tagged, while the LOG line keeps full diagnostic detail.
 *
 * Run: npm test  (from web/)  ·  node --test scripts/tests/server-error.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { internalError } from "../../web/src/lib/serverError.ts";

const SECRET_PATH = "/home/agent/secret/board.json";

test("client body is generic; exception text stays out", () => {
  const enoent = new Error(`ENOENT: no such file or directory, open '${SECRET_PATH}'`);
  const ie = internalError("api/board:get", enoent);
  assert.equal(ie.status, 500);
  assert.equal(ie.body.error, "internal_error");
  assert.equal(ie.body.scope, "api/board:get");
  const flat = JSON.stringify(ie.body);
  assert.ok(!flat.includes(SECRET_PATH), "no absolute path in body");
  assert.ok(!flat.includes("ENOENT"), "no exception text in body");
});

test("non-Error throwables are stringified into logs only", () => {
  const ie = internalError("api/x", "weird-throwable-detail");
  assert.equal(ie.body.error, "internal_error");
  assert.ok(ie.log.includes("weird-throwable-detail"), "detail preserved for server log");
  assert.ok(!JSON.stringify(ie.body).includes("weird"));
});

test("log line carries scope + full detail for server-side debugging", () => {
  const stackErr = new Error("disk on fire");
  const ie = internalError("api/board:post", stackErr);
  assert.ok(ie.log.startsWith("[api/board:post]"));
  assert.ok(ie.log.includes("disk on fire"));
});
