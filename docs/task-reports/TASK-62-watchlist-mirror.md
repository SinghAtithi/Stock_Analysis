# TASK-62 — Saved screener views + optional cloud watchlist mirror

## What shipped

- **Saved views (AC1)** — `web/src/lib/screenerPresets.ts` + `web/src/components/ScreenerPresets.tsx` + wiring in `web/src/app/screener/page.tsx`. A named snapshot of `{strategy, sortKey, sortDir}` stored device-scoped in `localStorage["niftyterm.screener-presets.v1"]` (cap 20, name-dedupe, newest first). The screener keeps the picker/apply/delete UI quiet and inline; applying a preset syncs `?strategy=&sort=&dir=` via `history.replaceState`, and those params are consumed back on load (sort keys validated against the sortable column set).
- **Cloud mirror (AC2)** — `web/src/app/api/watchlist/route.ts` over the existing `watchlists` table (`db/migrations/0001_init.sql`): rows keyed `id = "device:<deviceId>"`, `scope = "device"`, entries serialized in `data_json`.
  - `GET ?deviceId=` → `{ entries, updatedAt }`
  - `PUT {deviceId, symbols:[…]}` → replace-set. Every entry is validated against the instruments index (`findInstrumentListing`: exact symbol+exchange pair first, else symbol fallback); unknown symbols are dropped, cap 100 → `400 invalid_symbols` beyond that.
- **Client wiring** — `web/src/lib/watchlistMirror.ts`: `useWatchlistMirror()` on the home page does (a) one merge-on-read per session and (b) a debounced (1.5 s), fire-and-forget PUT whenever the watchlist changes. Every network failure is silent.
- **Device identity** — extracted to `web/src/lib/device.ts` (`niftyterm.deviceId` key, same mechanism AlertCenter used since T25); AlertCenter now imports it.

## Merge-on-read rule (AC3)

On home-page load, `GET /api/watchlist` runs once per session and is unioned into localStorage via `mergeIntoWatchlist()` (`lib/watchlist.ts`):

- identity is `exchange|symbol`;
- **localStorage wins conflicts** — local entries are kept verbatim, only absent symbols are appended;
- re-merging an identical payload is a no-op (0 writes);
- if the mirror is unreachable, nothing happens — localStorage stays authoritative.

After a merge that added rows, the union is pushed back once so the mirror converges.

## Migration path to auth claims (TASK-63)

The alerts table already documents this intent ("Auth will claim these rows by
device id later"); the mirror follows the same shape so both migrate together:

1. On login, look up `watchlists WHERE id = 'device:' || deviceId AND scope = 'device'`
   (and `alerts.device_id`) using the client-supplied deviceId.
2. Re-key the row to the user account: `id = "user:<userId>"`, `scope = "user"`.
   Keep `device:` rows until claim completes for idempotency across devices.
3. If a user-scope row already exists, apply the **same union rule** as above:
   union by `exchange|symbol`, existing user row wins conflicts.
4. After all of a user's claimed devices are merged, delete the `device:` rows.
5. Client change is minimal: `lib/device.ts` gains an auth-aware scope getter;
   `useWatchlistMirror` switches from deviceId to session identity. The API
   route swaps the `DEVICE_RE` guard for session validation and writes
   `scope='user'`.

No schema migration needed — `scope` was designed for exactly this.

## Verification

- `npx tsc --noEmit`, `npm run lint` (0 errors), `npm test` green (incl. new `scripts/tests/screener-presets.test.mjs`: preset sanitization, save dedupe/cap, merge rules).
- Manual sanity on :3017 — see LOG entry for the run date.
