/**
 * Shared normalization helpers used by both the snapshot builder
 * and the runtime ontology matcher.
 */

/** Collapse whitespace and trim. Used internally by other normalizers. */
export const compactWhitespace = (value: string) =>
  value.replace(/\s+/g, " ").trim();

/**
 * Normalize a term for matching: lowercase, replace non-alphanumeric with
 * spaces, collapse whitespace, trim.
 */
export const normalizeWord = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Like normalizeWord but pads with leading/trailing spaces so that
 * `haystack.includes(` ${term} `)` gives whole-word matching.
 */
export const normalizeText = (value: string) =>
  ` ${normalizeWord(value)} `;

/** Strip leading `#` characters and lowercase. */
export const normalizeHashtag = (value: string) =>
  value.trim().toLowerCase().replace(/^#+/u, "");

/**
 * Re-export the shared normalizeDomain so existing ontology imports
 * continue to work without changes.
 */
export { normalizeDomain } from "../domain/normalize";
