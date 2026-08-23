/* Cron-gate bearer check (TASK-1429/1433) — extracted from the evaluate
 * route so the adversarial suite can pin it. Fail-closed: unset CRON_SECRET
 * disables the endpoint entirely; a set secret requires an exact
 * `Authorization: Bearer <secret>` match (timing-safe). */
import { timingSafeEqual } from "node:crypto";

export function authorizedBearer(header: string | null): boolean {
  const expected = process.env.CRON_SECRET ?? "";
  if (!expected) return false;
  const provided = header?.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
