/**
 * TASK-1429/1433 — evaluate-endpoint gate regression.
 *
 * /api/alerts/evaluate opens SQLite in write mode and fires email digests;
 * before TASK-1429 anyone could run it at line rate. These pin the gate:
 * fail-closed when CRON_SECRET is unset, exact Bearer match otherwise.
 * (Live 401/200 matrix was verified over HTTP on the isolated build.)
 *
 * Run: npm test  (from web/)  ·  node --test scripts/tests/cron-auth.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { authorizedBearer } from "../../web/src/lib/cronAuth.ts";

const withEnv = (value, fn) => {
  const saved = process.env.CRON_SECRET;
  try {
    if (value === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = value;
    fn();
  } finally {
    if (saved === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = saved;
  }
};

test("fail-closed: unset CRON_SECRET rejects every caller", () => {
  withEnv(undefined, () => {
    assert.equal(authorizedBearer(null), false);
    assert.equal(authorizedBearer("Bearer sekrit"), false);
    assert.equal(authorizedBearer("garbage"), false);
  });
});

test("set secret: wrong/missing/malformed rejected", () => {
  withEnv("sekrit", () => {
    assert.equal(authorizedBearer(null), false);
    assert.equal(authorizedBearer(""), false);
    assert.equal(authorizedBearer("wrong"), false);
    assert.equal(authorizedBearer("Bearer wrong"), false);
    assert.equal(authorizedBearer("Bearer "), false);
    assert.equal(authorizedBearer("Basic sekrit"), false, "non-bearer scheme rejected");
  });
});

test("exact bearer match accepted; prefix games rejected", () => {
  withEnv("sekrit", () => {
    assert.equal(authorizedBearer("Bearer sekrit"), true);
    assert.equal(authorizedBearer("Bearer sekrit-extra"), false);
    assert.equal(authorizedBearer("Bearer sekri"), false);
  });
});
