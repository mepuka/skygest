/**
 * Shared domain normalization helper.
 *
 * Lives in `src/domain/` so it can be imported by any layer
 * (bluesky, ontology, repos, etc.) without creating circular
 * dependency issues.
 */

/** Normalize a hostname: strip `www.` prefix, lowercase, strip trailing dots. */
export const normalizeDomain = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/^www\./u, "")
    .replace(/\.+$/u, "");
