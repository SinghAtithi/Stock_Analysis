# TASK-1404 — Security requirements for share links (`/w/…`, TASK-1341)

**These requirements are binding on whichever session implements the
share-link feature.** A `/w/[id]` route must not ship until each item below
is either implemented or explicitly waived in writing by a security review.
Written by CIPHER, 2026-08-24, before any share code exists — so the design
starts safe instead of being patched later.

## Background

Planned feature: share a watchlist or note via a short URL. Two shapes have
been discussed on the board: watchlist share (server-side) and note share
via `/w/abc#note` (fragment-based). The fragment variant keeps payloads out
of the server entirely; the server-side variant stores them. Requirements
differ per shape.

## Binding requirements

1. **Opaque, unguessable identifiers.** Share ids are `base64url(16 random
   bytes)` (128-bit) from `crypto.randomBytes`/`getRandomValues` — never
   sequential counters, never hashcs of content, never user-supplied. An id
   is a bearer secret: possession of the URL *is* authorization for reads.
2. **Note/watchlist payloads stay client-side when possible.** Prefer the
   fragment shape (`#payload`) so nothing is stored or logged server-side.
   If a server-stored shape wins the design debate, payloads must be
   size-capped, schema-validated, and covered by the privacy note below.
3. **Never logged.** Share ids and payload fragments must be excluded from
   request logging and analytics events. URLs leak via referrers, proxies,
   browser history, and support tickets as a matter of course.
4. **Expiry enforced server-side where state exists.** If shares are stored,
   expiry is checked at read time against a persisted timestamp — a client
   countdown is UX, not access control. Fragment-only shares may use
   embedded expiry claims that the reader validates before rendering.
5. **No unauthenticated writes to shared state.** Creating a share may be
   anonymous but mutating/deleting another's share must be impossible:
   deletion requires the creation token, not just the read id.
6. **Renderer hardening.** Any preview rendering of shared content goes
   through React text nodes only — no `href` built from payload strings, no
   HTML injection surface, no fetch-by-payload-URL.

## Threat model notes

- **Link forwarding = capability leak.** Treat every share as readable by
  anyone who ever saw the link; expiry limits blast radius, nothing prevents
  recipient re-sharing. Document this in the share UI ("anyone with the
  link").
- **Enumeration**: with 128-bit ids, brute force is futile (see
  TASK-1373 audit). Sequential ids would make every private watchlist
  walkable — this is the failure mode the requirement exists to prevent.
- **Referrer leakage**: add `referrerpolicy="no-referrer"` on any link
  rendered FROM a share page; consider the same for inbound landing pages.

## Verification checklist for the implementing PR

- [ ] Ids are 22-char base64url, generated from CSPRNG
- [ ] No share id or payload appears in server logs or board-sync events
- [ ] Expiry: expired share → explicit 410/expired screen, server-checked
- [ ] Delete/mutate requires creation token (or auth once it exists)
- [ ] Playwright pass over share create → open → expire → gone
