/* Shared upstream-input guards (TASK-1371).
 *
 * Symbol/exchange values come from URL search params and flow into
 * third-party request URLs (curl subprocess → Yahoo/Moneycontrol/Google/
 * Groww) and into cache/DB keys. Routes must treat them as untrusted:
 * - validSymbol pins the charset the UI itself produces (A-Z 0-9 space . ^ = & _ -)
 * - validExchange allowlists the two supported venues outright — the Groww
 *   fallback interpolates exchange straight into a URL path segment, and
 *   Yahoo suffixing compares equality only, so anything beyond NSE/BSE has
 *   no legitimate caller.
 */

export const SYMBOL_RE = /^[A-Z0-9 .^=&_-]{1,32}$/;

export const EXCHANGES: ReadonlySet<string> = new Set(["NSE", "BSE"]);

export function validSymbol(symbol: string): boolean {
  return SYMBOL_RE.test(symbol);
}

export function validExchange(exchange: string): boolean {
  return EXCHANGES.has(exchange);
}
