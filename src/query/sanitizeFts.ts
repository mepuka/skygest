/**
 * Sanitize user input for SQLite FTS5 MATCH queries.
 *
 * Strips FTS5 operators and special characters so that arbitrary user
 * strings can be passed safely to `WHERE posts_fts MATCH ?`.
 */

const FTS5_SPECIAL = /["*^{}()\[\]:]/g;
const FTS5_OPERATORS = /\b(AND|OR|NOT|NEAR)\b/gi;

export const sanitizeFtsQuery = (raw: string): string =>
  raw
    .replace(FTS5_SPECIAL, " ")
    .replace(FTS5_OPERATORS, "")
    .replace(/\s+/g, " ")
    .trim();
