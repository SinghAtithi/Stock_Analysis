/**
 * Module-hooks loader for node:test runs (registered by helpers/register.mjs).
 * Resolves extensionless relative imports to .ts and maps the web app's `@/*`
 * path alias to web/src/* so suites can import web/src TypeScript modules
 * without per-file registerHooks boilerplate. Type stripping itself comes
 * from --experimental-strip-types on the npm test command line.
 */

const WEB_SRC_URL = new URL("../../../web/src/", import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  const hasExtension = /\.[a-z0-9]+$/i.test(specifier);
  if (specifier.startsWith("@/")) {
    const target = specifier.slice(2);
    return nextResolve(
      new URL(hasExtension ? target : `${target}.ts`, WEB_SRC_URL).href,
      context
    );
  }
  const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
  if (isRelative && !hasExtension) {
    return nextResolve(`${specifier}.ts`, context);
  }
  return nextResolve(specifier, context);
}
