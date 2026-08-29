/* curl.test.mjs — crumb bootstrap (fc.yahoo.com cookie -> v1/test/getcrumb),
 * URL decoration, and HostBackoff park-on-sustained-429 semantics.
 * The curl subprocess is stubbed via injectable execImpl; no network here.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getCrumb,
  resetCrumbCache,
  appendCrumb,
  CRUMB_TTL_MS,
  CRUMB_ATTEMPTS,
  HostBackoff,
  isRateLimited,
} from "../lib/curl.mjs";
import { fetchQuoteSummary as fetchFundamentals } from "../ingest-fundamentals.mjs";
import { fetchQuoteSummary as fetchAnalyst } from "../ingest-analyst.mjs";

const JAR = "/tmp/niftyterm-test-crumb.jar";

/* Stub for the curl subprocess: records every argv, returns `crumb` as stdout. */
function stubCurl(calls, { crumb = "CRUMB123", failAll = false } = {}) {
  return async (file, args, opts) => {
    calls.push(args);
    if (failAll) {
      const e = new Error("curl exited 22");
      e.stderr = "The requested URL returned error: 429";
      throw e;
    }
    return { stdout: crumb };
  };
}

/* ---------- crumb bootstrap ---------- */

test("getCrumb: fc.yahoo.com cookie bootstrap then getcrumb exchange, crumb returned", async (t) => {
  t.after(resetCrumbCache);
  const calls = [];
  const { crumb, cookieJar } = await getCrumb({ execImpl: stubCurl(calls), jarPath: JAR, now: 1_000_000 });

  assert.equal(calls.length, 2, "exactly two curl round trips");
  assert.equal(crumb, "CRUMB123");
  assert.equal(cookieJar, JAR, "shared cookie jar returned for reuse");

  const first = calls[0].join(" ");
  assert.ok(first.includes("-c") && first.includes(JAR), "cookie bootstrap writes the jar");
  assert.ok(!first.includes("-b"), "no cookie replay on the bootstrap step");
  assert.ok(first.includes("https://fc.yahoo.com"), "A3 session cookie from fc.yahoo.com");

  const second = calls[1].join(" ");
  assert.ok(second.includes("-b") && second.includes(JAR), "getcrumb replays the jar");
  assert.ok(second.includes("-c") && second.includes(JAR), "getcrumb persists the jar");
  assert.ok(second.includes("https://query1.finance.yahoo.com/v1/test/getcrumb?crumbs="));
});

test("getCrumb: cached per process within TTL — no re-bootstrap", async (t) => {
  t.after(resetCrumbCache);
  const firstCalls = [];
  const r1 = await getCrumb({ execImpl: stubCurl(firstCalls), jarPath: JAR, now: 2_000_000 });

  const secondCalls = [];
  const r2 = await getCrumb({ execImpl: stubCurl(secondCalls), jarPath: JAR, now: 2_000_000 + 1000 });
  assert.equal(secondCalls.length, 0, "cached — execImpl not invoked inside TTL");
  assert.equal(r2.crumb, r1.crumb);
  assert.equal(r2.cookieJar, r1.cookieJar);
});

test("getCrumb: expired crumb refreshes lazily on next fetch", async (t) => {
  t.after(resetCrumbCache);
  const calls = [];
  await getCrumb({ execImpl: stubCurl(calls), jarPath: JAR, now: 3_000_000 });
  assert.equal(calls.length, 2);

  const refreshCalls = [];
  await getCrumb({
    execImpl: stubCurl(refreshCalls, { crumb: "FRESHCRUMB" }),
    jarPath: JAR,
    now: 3_000_000 + CRUMB_TTL_MS + 1000,
  });
  assert.equal(refreshCalls.length, 2, "expired TTL -> fresh bootstrap round trip");
});

test("getCrumb: concurrent default-path calls share one bootstrap (inflight dedupe)", async (t) => {
  t.after(resetCrumbCache);
  const calls = [];
  /* default options -> shared inflight path; resolve slowly to overlap the calls */
  const slow = async (file, args, opts) => {
    calls.push(args);
    await new Promise((r) => setTimeout(r, 20));
    return { stdout: "DEDUPEDCRUMB" };
  };
  const [a, b] = await Promise.all([
    getCrumb({ execImpl: slow, now: 3_500_000 }),
    getCrumb({ execImpl: slow, now: 3_500_000 }),
  ]);
  assert.equal(calls.length, 2, "one fc.yahoo.com + one getcrumb round trip shared");
  assert.equal(a.crumb, "DEDUPEDCRUMB");
  assert.equal(b.crumb, "DEDUPEDCRUMB");
});

test("getCrumb: empty or garbage body -> throws, no bogus crumb cached", async (t) => {
  t.after(resetCrumbCache);
  await assert.rejects(
    getCrumb({ execImpl: stubCurl([], { crumb: "" }), jarPath: JAR, now: 4_000_000 }),
    /no crumb token/
  );
  await assert.rejects(
    getCrumb({ execImpl: stubCurl([], { crumb: "<html>Unauthorized</html>" }), jarPath: JAR, now: 4_000_001 }),
    /no crumb token/
  );
});

test("getCrumb: curl failure (401/429) surfaces a clear error", async (t) => {
  t.after(resetCrumbCache);
  await assert.rejects(
    getCrumb({ execImpl: stubCurl([], { failAll: true }), jarPath: JAR, now: 5_000_000 }),
    /429/
  );
});

test("getCrumb: throttled getcrumb retries across hosts, then throws rateLimited for caller parking", async (t) => {
  t.after(resetCrumbCache);
  const getcrumbCalls = [];
  const impl = async (file, args, opts) => {
    if (args.some((a) => a.includes("fc.yahoo.com"))) return { stdout: "" };
    getcrumbCalls.push(args);
    const e = new Error("curl exited 22");
    e.stderr = "The requested URL returned error: 429";
    throw e;
  };
  const backoff = new HostBackoff({ jitter: 0, baseDelayMs: 10, parkMs: 30, maxRetries: 0 });
  await assert.rejects(
    getCrumb({ execImpl: impl, jarPath: JAR, now: 6_000_000, backoff }),
    (e) => {
      assert.equal(e.rateLimited, true, "caller can park instead of tripping the breaker");
      assert.equal(e.host, "query2.finance.yahoo.com");
      return true;
    }
  );
  assert.equal(getcrumbCalls.length, CRUMB_ATTEMPTS, "paced retries across query1/query2");
});

/* ---------- URL decoration ---------- */

test("isRateLimited: 429, Too Many Requests and curl timeouts are throttle signals", () => {
  const e429 = new Error("Command failed");
  e429.stderr = "curl: (22) The requested URL returned error: 429";
  assert.equal(isRateLimited(e429), true);
  const eTxt = new Error("Too Many Requests");
  assert.equal(isRateLimited(eTxt), true);
  const eTimeout = new Error("Command failed: curl -m 30 ...");
  eTimeout.stderr = "curl: (28) Operation timed out after 30000 milliseconds with 0 bytes received";
  assert.equal(isRateLimited(eTimeout), true, "curl timeout on a guarded host is throttle-induced");
  const eOther = new Error("The requested URL returned error: 500");
  assert.equal(isRateLimited(eOther), false);
});

test("appendCrumb: crumb + lang/region appended, handles existing query string", () => {
  assert.equal(
    appendCrumb("https://query1.finance.yahoo.com/v10/finance/quoteSummary/RELIANCE.NS?modules=a,b", "TOK"),
    "https://query1.finance.yahoo.com/v10/finance/quoteSummary/RELIANCE.NS?modules=a,b&crumb=TOK&lang=en-US&region=US"
  );
  assert.equal(
    appendCrumb("https://query1.finance.yahoo.com/v10/finance/quoteSummary/RELIANCE.NS", "TOK"),
    "https://query1.finance.yahoo.com/v10/finance/quoteSummary/RELIANCE.NS?crumb=TOK&lang=en-US&region=US"
  );
  assert.ok(appendCrumb("https://x", "a b").includes("crumb=a%20b"));
});

test("fetchQuoteSummary (fundamentals): URL carries crumb + lang/region, cookieJar forwarded", async (t) => {
  t.after(resetCrumbCache);
  await getCrumb({ execImpl: stubCurl([]), jarPath: JAR, now: Date.now() });

  const seen = [];
  const fakeBackoff = {
    getJson: async (url, opts) => {
      seen.push({ url, opts });
      return { quoteSummary: { result: [{}] } };
    },
  };
  await fetchFundamentals("RELIANCE.NS", { backoff: fakeBackoff });
  assert.equal(seen.length, 1);
  assert.ok(seen[0].url.includes("crumb=CRUMB123"), "crumb appended");
  assert.ok(seen[0].url.includes("lang=en-US&region=US"), "lang/region appended");
  assert.equal(seen[0].opts.cookieJar, JAR, "cookie jar forwarded to curl");
});

test("fetchQuoteSummary (analyst): URL carries crumb + lang/region, cookieJar forwarded", async (t) => {
  t.after(resetCrumbCache);
  await getCrumb({ execImpl: stubCurl([]), jarPath: JAR, now: Date.now() });

  const seen = [];
  const fakeBackoff = {
    getJson: async (url, opts) => {
      seen.push({ url, opts });
      return { quoteSummary: { result: [{}] } };
    },
  };
  await fetchAnalyst(fakeBackoff, "RELIANCE.NS");
  assert.equal(seen.length, 1);
  assert.ok(seen[0].url.includes("crumb=CRUMB123"), "crumb appended");
  assert.ok(seen[0].url.includes("lang=en-US&region=US"), "lang/region appended");
  assert.equal(seen[0].opts.cookieJar, JAR, "cookie jar forwarded to curl");
});

/* ---------- 429 pacing: park host on sustained throttle ---------- */

test("HostBackoff: two 429s park the host for the parkMs window; success clears it", () => {
  const b = new HostBackoff({ jitter: 0, parkMs: 25_000, baseDelayMs: 1_000 });
  const host = "query1.finance.yahoo.com";
  assert.equal(b.remaining(host), 0);
  b.note429(host); /* single hit -> short exponential step */
  assert.ok(b.remaining(host) < 25_000, "single 429 does not park yet");
  b.note429(host); /* sustained throttle -> parked */
  const parked = b.remaining(host);
  assert.ok(parked >= 25_000 && parked < 25_000 + 5_000, `parked for parkMs window (got ${parked})`);
  b.noteSuccess(host);
  assert.equal(b.remaining(host), 0, "success releases the park");
});

test("HostBackoff.getJson: rate-limited throw carries host/rateLimited/retryAfter and leaves host parked", async () => {
  const b = new HostBackoff({ jitter: 0, baseDelayMs: 10, parkMs: 30_000, maxRetries: 1 });
  const fakeCurl = async () => {
    const e = new Error("429 Too Many Requests");
    throw e;
  };
  await assert.rejects(
    b.getJson("https://query1.finance.yahoo.com/v10/finance/quoteSummary/X.NS?modules=a", {
      curlImpl: fakeCurl,
    }),
    (e) => {
      assert.equal(e.rateLimited, true);
      assert.equal(e.host, "query1.finance.yahoo.com");
      assert.ok(e.retryAfter > 0, "retryAfter attached");
      const remaining = b.remaining("query1.finance.yahoo.com");
      assert.ok(remaining >= 30_000 - 1_000, `host parked after sustained 429 (remaining ${remaining})`);
      return true;
    }
  );
});