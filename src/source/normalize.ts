/**
 * Source attribution normalization utilities.
 *
 * Pure functions for stripping source prefixes, whole-word matching,
 * and extracting domains from mixed text — shared across the
 * SourceAttributionMatcher pipeline.
 *
 * See docs/plans/2026-03-19-sky-46-source-attribution-matching-design.md
 * § Normalization Rules for the authoritative specification.
 */

import { normalizeDomain } from "../domain/normalize";

// ---------------------------------------------------------------------------
// Source-prefix stripping
// ---------------------------------------------------------------------------

/**
 * Ordered longest-first so "source data:" is tried before "source:".
 * Each pattern is case-insensitive and tolerates optional whitespace
 * around the colon.
 */
const SOURCE_PREFIXES = [
  /^source\s*data\s*:\s*/iu,
  /^source\s*:\s*/iu,
  /^data\s*:\s*/iu,
  /^via\s+/iu
];

/**
 * Remove common leading markers from a source-line string.
 *
 * Handles: "Source:", "Data:", "Source data:", "via" (case-insensitive).
 * The result is trimmed.
 */
export const stripSourcePrefix = (text: string): string => {
  let result = text.trim();
  for (const prefix of SOURCE_PREFIXES) {
    result = result.replace(prefix, "");
  }
  return result.trim();
};

// ---------------------------------------------------------------------------
// Whole-word matching
// ---------------------------------------------------------------------------

/**
 * Test whether `alias` appears as a whole word inside `text`.
 *
 * - Returns `false` for aliases shorter than 3 characters (too ambiguous).
 * - Case-insensitive.
 * - Escapes special regex characters so names like "ISO-NE", "ENTSO-E",
 *   and "S&P Global" are matched correctly.
 */
export const isWholeWordMatch = (text: string, alias: string): boolean => {
  if (alias.length < 3) return false;
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`\\b${escaped}\\b`, "iu");
  return pattern.test(text);
};

// ---------------------------------------------------------------------------
// Domain extraction from text
// ---------------------------------------------------------------------------

/**
 * Matches either a full URL (https?://...) or a bare domain (eia.gov).
 *
 * Captures the hostname portion (group 1). The TLD requirement (two or
 * more labels separated by dots) prevents false positives on plain words.
 */
const DOMAIN_PATTERN =
  /(?:https?:\/\/)?([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)(?:\/[^\s]*)?/iu;

/**
 * Extract a domain from free text.
 *
 * Handles full URLs (`https://ercot.com/data`) and bare domains
 * (`eia.gov`). Strips `www.` prefix. Returns `null` when no domain
 * is found.
 *
 * Reuses the shared `normalizeDomain` helper from `src/domain/normalize.ts`
 * to ensure consistent hostname normalization across the codebase.
 */
export const extractDomainFromText = (text: string): string | null => {
  const match = DOMAIN_PATTERN.exec(text);
  if (!match?.[1]) return null;
  return normalizeDomain(match[1]);
};
