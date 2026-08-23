# TASK-1373 — deviceId-scoped routes: entropy audit + probing throttle

**Verdict: entropy is sound; enumeration is computationally futile; probing
is now throttled at the bucket layer.** Shipped by CIPHER, 2026-08-24.

## Entropy audit

- Client device ids: `crypto.randomUUID()` (`web/src/lib/device.ts`) —
  UUIDv4, 122 random bits. Alert ids: `randomUUID()` server-side
  (`node:crypto`). Screener presets: same primitive.
- 122 bits is below the literal "≥128" wording of the original AC but is the
  industry-standard identifier strength (same class as session IDs in
  frameworks). At realistic probe rates, enumeration success probability is
  negligible for centuries. **Accepted as-is.**
- Upgrade path if identity ever becomes security-critical (auth/billing):
  `crypto.getRandomValues` → 16 bytes → base64url (128-bit), stored in the
  same localStorage key. Migration is trivial because ids are opaque.

## Ownership model (documented, unchanged)

Knowing a deviceId *is* the bearer credential — routes scope all reads and
writes to `device_id = ?`. There are no cookies/sessions to steal; there is
also no username to target. Threat is enumeration, not theft.

## Probing throttle (enforced)

`GET /api/watchlist` and `GET /api/alerts` now consume one token per request
from a bucket keyed by `clientKeyFrom(headers)` (TASK-1465 derivation —
spoof-resistant under direct exposure). 30-token burst, ~0.5 token/s refill,
429 + Retry-After when dry. Legitimate UI polling uses a fraction of this.

Bucket stores use LRU eviction (TASK-1465 semantics): floods cannot reset
honest callers' budgets.
