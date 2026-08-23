/* Client-key derivation for rate limits / tier caps (TASK-1465).
 *
 * The old routes keyed limits on the LEFTMOST `x-forwarded-for` hop — a
 * header any caller can set — so rotating it rotated every per-IP budget
 * (and flooded the limiter stores into their clear-all resets).
 *
 * Two deployment postures, chosen by env:
 * - default / direct exposure (localhost bind, LAN): forwarding headers are
 *   pure spoofing channels. Every caller shares ONE key ("direct"); real
 *   differentiation comes from regex-gated deviceId keys upstream of this.
 *   Per-IP caps still bound a single abusive host instead of being free.
 * - TRUST_PROXY=1 (behardened behind exactly one reverse proxy that APPENDS
 *   to XFF): use the RIGHTMOST hop — the address your own proxy observed.
 *   The leftmost entries are attacker-supplied by spec.
 */

export function clientKeyFrom(headers: Headers): string {
  if (process.env.TRUST_PROXY === "1") {
    const xff = headers.get("x-forwarded-for");
    if (xff) {
      const hops = xff
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (hops.length > 0) return `ip:${hops[hops.length - 1]}`;
    }
    return `ip:${headers.get("x-real-ip") ?? "direct"}`;
  }
  return "direct";
}
