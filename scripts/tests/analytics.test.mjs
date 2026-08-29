/**
 * TASK-1388 — first-party analytics lib (web/src/lib/analytics.ts).
 *
 * The funnel layer must be invisible to the product: a broken localStorage
 * or a dead endpoint can never throw into the caller. These tests pin the
 * queue cap, batched flush, no-PII guarantees, and the failure-swallow
 * contract. The route (/api/analytics) is verified by the live probe —
 * these suites run without a server.
 *
 * Run: npm test  (from web/)  ·  node --test scripts/tests/analytics.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  ANALYTICS_MAX_QUEUE,
  sanitizeSymbol,
  track,
  flush,
  peekQueue,
  resetAnalytics,
} from "../../web/src/lib/analytics.ts";

/* The lib guards on window/localStorage (SSR-safe). Provide browser-like
   globals so capture is live in the suite. */
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};
globalThis.window = globalThis;

test.afterEach(() => {
  resetAnalytics();
  mem.clear();
});

test("track: queue is capped at 200, oldest events dropped", () => {
  for (let i = 0; i < ANALYTICS_MAX_QUEUE + 50; i += 1) {
    track("search_select", `RELIANCE-${i}`);
  }
  const q = peekQueue();
  assert.equal(q.length, ANALYTICS_MAX_QUEUE, "cap enforced");
  assert.equal(q[0].symbol, "RELIANCE-50", "oldest dropped");
  assert.equal(q[q.length - 1].symbol, "RELIANCE-249", "newest kept");
});

test("flush: sends the whole queue as one batched POST, clears on ok", async () => {
  const sent = [];
  globalThis.fetch = (async (_url, init) => {
    sent.push(JSON.parse(String(init.body)));
    return { ok: true };
  });
  try {
    track("search_select", "TCS");
    track("chart_pick", "TCS");
    track("pricing_view");
    await flush();
    assert.equal(sent.length, 1, "one batched POST");
    assert.equal(sent[0].events.length, 3, "all events in the batch");
    assert.equal(peekQueue().length, 0, "acked events leave the queue");
  } finally {
    delete globalThis.fetch;
  }
});

test("flush: payload carries only kind/symbol/at — no PII surface", async () => {
  let body = null;
  globalThis.fetch = (async (_url, init) => {
    body = JSON.parse(String(init.body));
    return { ok: true };
  });
  try {
    track("search_select", "RELIANCE<script>alert(1)</script>");
    track("chart_pick", "^NSEI");
    await flush();
    const events = body.events;
    for (const e of events) {
      assert.deepEqual(
        Object.keys(e).sort(),
        ["at", "kind", "symbol"],
        "only kind/symbol/at ride the wire",
      );
      assert.match(String(e.symbol), /^[A-Z0-9 .^=-]{1,24}$/, "symbol charset");
    }
    assert.equal(
      events[0].symbol,
      "RELIANCESCRIPTALERT1SCRI",
      "markup chars stripped, length capped",
    );
  } finally {
    delete globalThis.fetch;
  }
});

test("flush: never throws — network failure keeps the queue for retry", async () => {
  globalThis.fetch = (async () => {
    throw new Error("boom");
  });
  try {
    track("pricing_view");
    await flush(); /* must resolve, not reject */
    assert.equal(peekQueue().length, 1, "unacked events retained");
  } finally {
    delete (globalThis).fetch;
  }
});

test("flush: server 500 also keeps the queue", async () => {
  globalThis.fetch = (async () => ({ ok: false, status: 500 }));
  try {
    track("pricing_view");
    await flush();
    assert.equal(peekQueue().length, 1, "queue retained on non-ok");
  } finally {
    delete (globalThis).fetch;
  }
});

test("disabled in test env: NODE_ENV=test silences capture", () => {
  process.env.NODE_ENV = "test";
  try {
    track("search_select", "TCS");
    assert.equal(peekQueue().length, 0, "no events while NODE_ENV=test");
  } finally {
    delete process.env.NODE_ENV;
  }
});

test("disabled off-browser: no window means no-op, still no throw", async () => {
  const win = globalThis.window;
  delete globalThis.window;
  try {
    track("chart_pick", "TCS");
    await flush();
    assert.equal(peekQueue().length, 0, "SSR context stays silent");
  } finally {
    globalThis.window = win;
  }
});

test("sanitizeSymbol: strips junk, caps length, rejects non-strings", () => {
  assert.equal(sanitizeSymbol("rel!ance 50"), "RELANCE 50");
  assert.equal(sanitizeSymbol("RELIANCE@#"), "RELIANCE");
  assert.equal(sanitizeSymbol("^NSEI"), "^NSEI");
  assert.equal(sanitizeSymbol("A".repeat(100)).length, 24, "length capped");
  assert.equal(sanitizeSymbol("!!!  "), undefined, "nothing left → dropped");
  assert.equal(sanitizeSymbol(42), undefined, "non-string rejected");
  assert.equal(sanitizeSymbol(""), undefined);
});