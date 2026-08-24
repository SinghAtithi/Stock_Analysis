import { registerHooks } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";

registerHooks({
  resolve(specifier, context, nextResolve) {
    const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
    const hasExtension = /\.[a-z0-9]+$/i.test(specifier);
    if (isRelative && !hasExtension) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { withTransactionShim } = await import("../lib/db.mjs");

// TASK-1500 follow-up: node:sqlite DatabaseSync lacks .transaction — the CI
// fallback driver crashed every ingest script using better-sqlite3 semantics.
test("withTransactionShim adds a better-sqlite3-compatible transaction wrapper", () => {
  const calls = [];
  const fake = {
    exec(sql) { calls.push(sql); },
    prepare() { return { run: () => ({ changes: 1 }) }; },
  };
  const db = withTransactionShim(fake);
  const tx = db.transaction((rows) => {
    for (const r of rows) db.prepare("x").run(r);
    return rows.length;
  });
  assert.equal(tx([1, 2, 3]), 3);
  assert.deepEqual(calls, ["BEGIN", "COMMIT"]);
});

test("withTransactionShim rolls back and rethrows on failure", () => {
  const calls = [];
  const fake = {
    exec(sql) { calls.push(sql); },
    prepare() { return { run: () => { throw new Error("boom"); } }; },
  };
  const db = withTransactionShim(fake);
  const tx = db.transaction(() => { db.prepare("x").run(); });
  assert.throws(() => tx(), /boom/);
  assert.deepEqual(calls, ["BEGIN", "ROLLBACK"]);
});

test("withTransactionShim leaves real better-sqlite3 handles untouched", () => {
  const real = { transaction: () => "native" };
  assert.equal(withTransactionShim(real), real);
});
