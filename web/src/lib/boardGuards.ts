/* Board POST guards (TASK-1370): payload-size cap, per-key sliding-window
 * rate limit, and the mode:"replace" token gate.
 *
 * Pure functions + injectable clock where it matters, mirroring tiers.ts:
 * state is in-process — multi-instance deployments need a shared store
 * before these caps are load-bearing. The board UI debounces full-state
 * syncs to well under the rate budget; CLI writers never touch HTTP.
 */
import { timingSafeEqual } from "node:crypto";

/** ~1MB of JSON is far above any legitimate full-board payload. */
export const MAX_BODY_BYTES = 1_000_000;

export function bodyTooLarge(raw: string): boolean {
  return Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES;
}

const WINDOW_MS = 60_000;
const MAX_POSTS_PER_WINDOW = 60;
const postStamps = new Map<string, number[]>();

/** True when this POST should be shed (sliding 1-minute window per key). */
export function postRateLimited(key: string, now = Date.now()): boolean {
  const list = (postStamps.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (list.length >= MAX_POSTS_PER_WINDOW) {
    postStamps.set(key, list);
    return true;
  }
  list.push(now);
  postStamps.set(key, list);
  /* bounded store like tiers.ts runStamps — unique-key floods can't grow it */
  if (postStamps.size > 5000) postStamps.clear();
  return false;
}

/**
 * mode:"replace" swaps the whole task set (board import) — the one operation
 * that can wipe other writers' work, so it requires a shared secret even
 * though merge-mode stays open. When BOARD_WRITE_TOKEN is unset, replace is
 * disabled entirely rather than silently allowed.
 */
export function replaceAuthorized(
  mode: unknown,
  token: string | null
): { ok: boolean; configured: boolean } {
  if (mode !== "replace") return { ok: true, configured: true };
  const expected = process.env.BOARD_WRITE_TOKEN ?? "";
  if (!expected) return { ok: false, configured: false };
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(token ?? "", "utf8");
  const ok = a.length === b.length && timingSafeEqual(a, b);
  return { ok, configured: true };
}

/** Test seam: clear in-process rate-limit state. */
export function resetBoardGuards(): void {
  postStamps.clear();
}
