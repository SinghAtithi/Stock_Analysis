/**
 * Module-hooks loader for node:test runs (registered by helpers/register.mjs).
 * Resolves extensionless relative imports to .ts so suites can import
 * web/src TypeScript modules without per-file registerHooks boilerplate.
 * Type stripping itself comes from --experimental-strip-types on the
 * npm test command line.
 */
export async function resolve(specifier, context, nextResolve) {
  const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
  const hasExtension = /\.[a-z0-9]+$/i.test(specifier);
  if (isRelative && !hasExtension) {
    return nextResolve(`${specifier}.ts`, context);
  }
  return nextResolve(specifier, context);
}
