import { registerHooks } from "node:module";

/**
 * Resolve TypeScript sources when tests import with the project's .js specifiers.
 * Production bundling is unchanged; this hook is only used by `npm test`.
 */
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier.startsWith(".") &&
      specifier.endsWith(".js") &&
      typeof context.parentURL === "string" &&
      context.parentURL.includes("/src/")
    ) {
      try {
        return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
      } catch {
        // Fall through to the original specifier.
      }
    }
    return nextResolve(specifier, context);
  },
});
