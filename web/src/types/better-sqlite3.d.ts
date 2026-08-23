/**
 * better-sqlite3 ships no bundled types and @types/better-sqlite3 is not in
 * devDependencies. API routes access it via require/createRequire and narrow
 * the returned handle locally, so an ambient any-typed module declaration is
 * sufficient (see src/app/api/signals/route.ts, src/app/api/backtest/route.ts).
 */
declare module "better-sqlite3";
