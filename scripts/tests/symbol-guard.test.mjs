/**
 * TASK-1371 — symbol/exchange guards before upstream curl calls.
 *
 * Chart/analysis route params flow into third-party URLs (Groww interpolates
 * exchange into a URL path segment; Yahoo gets `SYMBOL.NS/BO`); junk must be
 * rejected at the door with 400 and never reach the subprocess. These pin
 * the pure validators in web/src/lib/symbolGuard.ts that the routes gate on.
 *
 * Run: npm test  (from web/)  ·  node --test scripts/tests/symbol-guard.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { EXCHANGES, SYMBOL_RE, validExchange, validSymbol } from "../../web/src/lib/symbolGuard.ts";

const legit = ["RELIANCE", "NIFTY 50", "M&M", "MCDOWELL-N", "^NSEI", "BSE BHARAT 22", "A.B-C_D&E"];
const hostile = [
  "",
  "../etc/passwd",
  "..\\..\\windows",
  "RELIANCE; ls",
  "RELIANCE$(id)",
  "RELIANCE`id`",
  "A%0d%0aX-Injected: 1", // CRLF header injection via percent-encoding
  "a".repeat(33), // over the 32-char cap
  "タタコンサル", // unicode outside charset
  "REL\tIANCE", // control char
  "REL\nIANCE",
  '{"$gt":""}', // operator-ish junk
];

test("every legit UI-produceable symbol passes (indices, ampersands, dots, spaces)", () => {
  for (const s of legit) {
    assert.ok(validSymbol(s), `${JSON.stringify(s)} must pass`);
    assert.match(s, SYMBOL_RE);
  }
});

test("hostile symbols are all rejected before reaching curl upstreams", () => {
  for (const s of hostile) {
    assert.equal(validSymbol(s), false, `${JSON.stringify(s)} must fail`);
  }
});

test("charset is exactly the documented class (regex mirrors validator)", () => {
  assert.equal(SYMBOL_RE.source, /^[A-Z0-9 .^=&_-]{1,32}$/.source);
});

test("exchange allowlist: NSE/BSE only — Groww path interpolation makes this load-bearing", () => {
  for (const ex of EXCHANGES) {
    assert.ok(EXCHANGES.has(ex));
    assert.equal(validExchange(ex), true);
  }
  for (const bad of [
    "",
    "nse", // routes uppercase before validating; raw lowercase still rejected
    "NSE/../../evil",
    "NSE?x=1",
    "BSE#frag",
    "NYSE",
    "NSE ",
    "NS E",
    "A".repeat(9),
  ]) {
    assert.equal(validExchange(bad), false, `${JSON.stringify(bad)} must fail`);
  }
});
