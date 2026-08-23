/* Internal-error formatting (TASK-1412).
 *
 * Raw exception text must never reach API clients — Node fs errors embed
 * absolute server paths ("ENOENT: no such file ... '/home/.../board.json'").
 * Callers log `detail` server-side and return only the generic body.
 * Pure function so tests can assert leakage properties without Next runtime.
 */

export interface InternalError {
  status: 500;
  body: { error: "internal_error"; scope: string };
  /** Full detail for server-side logs only. */
  log: string;
}

export function internalError(scope: string, e: unknown): InternalError {
  const detail = e instanceof Error ? (e.stack ?? e.message) : String(e);
  return {
    status: 500,
    body: { error: "internal_error", scope },
    log: `[${scope}] ${detail}`,
  };
}
