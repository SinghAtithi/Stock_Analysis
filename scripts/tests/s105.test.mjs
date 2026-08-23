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

const { getStrategy } = await import(
  "../../web/src/lib/strategies/registry.ts"
);
const { s105Strategy, revisionMomentum } = await import(
  "../../web/src/lib/strategies/strategies/s105-analyst-revision.ts"
);

// --- fixtures shaped exactly like ingest-analyst.mjs flattenDerived() -------
function derived({ rev30 = null, rev90 = null, rev7 = null, analysts = 12 } = {}) {
  return {
    revisionTrend: {
      period: "+1q",
      epsRev7dPct: rev7,
      epsRev30dPct: rev30,
      epsRev90dPct: rev90,
      epsEstimate: { avg: 12.4, numberOfAnalysts: analysts },
    },
    numberOfAnalystOpinions: analysts,
  };
}

const UNIVERSE = ["A", "B", "C", "D"];

/** Universe where A revises up strongly, B mildly up, C down, D no data. */
function makeCtx() {
  const rows = {
    A: derived({ rev30: 6.0, rev90: 10.0, rev7: 1.0 }),
    B: derived({ rev30: 2.0, rev90: 3.0 }),
    C: derived({ rev30: -4.0, rev90: -2.0 }),
    // D: no analyst row at all
  };
  return {
    getUniverse: () => UNIVERSE,
    getAnalyst: async (s) => (rows[s] ? { symbol: s, derived_json: rows[s] } : null),
  };
}

test("S105 meta matches the jury record", () => {
  assert.equal(s105Strategy.meta.id, "S105");
  assert.equal(s105Strategy.meta.juryRank, 11);
  assert.equal(s105Strategy.meta.edgeScore, 8.17);
  assert.equal(getStrategy("S105"), s105Strategy);
});

test("S105 self-registers on import", () => {
  assert.ok(getStrategy("S105"));
});

test("revisionMomentum weights 30d at 0.6 and 90d at 0.4", () => {
  const r = revisionMomentum(derived({ rev30: 10, rev90: 0 }));
  assert.equal(r.momentum, 6); // 0.6*10 + 0.4*0
  const r2 = revisionMomentum(derived({ rev30: null, rev90: 10 }));
  assert.equal(r2.momentum, 10); // falls back to the only window
  const r3 = revisionMomentum(derived({ rev30: null, rev90: null }));
  assert.equal(r3.momentum, null);
});

test("S105 ranks revisions cross-sectionally: up > down, missing -> null", async () => {
  const ctx = makeCtx();
  const a = await s105Strategy.compute(ctx, "A");
  const b = await s105Strategy.compute(ctx, "B");
  const c = await s105Strategy.compute(ctx, "C");
  const d = await s105Strategy.compute(ctx, "D");

  assert.ok(a.score > b.score && b.score > c.score, `${a.score} > ${b.score} > ${c.score}`);
  assert.ok(a.score <= 100 && c.score >= 0);
  assert.equal(d, null); // no analyst row -> no signal
});

test("S105 is deterministic per context (cached distribution)", async () => {
  const ctx = makeCtx();
  const a1 = await s105Strategy.compute(ctx, "A");
  const a2 = await s105Strategy.compute(ctx, "A");
  assert.equal(a1.score, a2.score);
  assert.deepEqual(a1.components, a2.components);
});

test("S105 components carry auditable raw windows", async () => {
  const ctx = makeCtx();
  const a = await s105Strategy.compute(ctx, "A");
  assert.equal(a.components.rev30d, 6.0);
  assert.equal(a.components.rev90d, 10.0);
  assert.equal(a.components.analysts, 12);
  assert.equal(typeof a.components.sampleSize, "number");
});

test("S105 NaN-safety: garbage wrappers never throw", async () => {
  const r = revisionMomentum({ revisionTrend: null });
  assert.equal(r.momentum, null);
  const r2 = revisionMomentum({
    revisionTrend: { epsRev30dPct: Number.NaN, epsRev90dPct: undefined },
  });
  assert.equal(r2.momentum, null);

  const ctx = {
    getUniverse: () => ["X"],
    getAnalyst: async () => {
      throw new Error("db gone");
    },
  };
  assert.equal(await s105Strategy.compute(ctx, "X"), null);
});

test("S105 returns null when universe is too small to rank", async () => {
  const ctx = {
    getUniverse: () => ["A"],
    getAnalyst: async (s) => ({ symbol: s, derived_json: derived({ rev30: 5 }) }),
  };
  assert.equal(await s105Strategy.compute(ctx, "A"), null);
});

test("S105 tolerates raw DB row wrapper vs flattened object", async () => {
  const wrapped = {
    getUniverse: () => ["A", "B"],
    getAnalyst: async (s) =>
      s === "A"
        ? { symbol: s, derived_json: derived({ rev30: 8 }) } // row wrapper
        : derived({ rev30: 2 }), // already-flattened
  };
  const a = await s105Strategy.compute(wrapped, "A");
  const b = await s105Strategy.compute(wrapped, "B");
  assert.ok(a.score > b.score);
});
