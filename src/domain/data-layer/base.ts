import { Schema } from "effect";
import { IsoTimestamp } from "../types";
import { Aliases } from "./alias";

// ── Date-like validation ──────────────────────────────────────────────
// Accepts: YYYY, YYYY-MM, YYYY-MM-DD, or full ISO 8601 timestamp.
// Rejects arbitrary text like "banana".

const DATE_LIKE_PATTERN = /^\d{4}(?:-\d{2}(?:-\d{2}(?:T.+)?)?)?$/u;

const validateDateLike = (value: string) =>
  DATE_LIKE_PATTERN.test(value)
    ? undefined
    : "expected a date-like value: YYYY, YYYY-MM, YYYY-MM-DD, or ISO 8601 timestamp";

/** Flexible date string — accepts year, year-month, date, or full timestamp. */
export const DateLike = Schema.String.pipe(
  Schema.check(Schema.makeFilter(validateDateLike))
).annotate({ description: "Date-like value: YYYY, YYYY-MM, YYYY-MM-DD, or ISO 8601 timestamp" });
export type DateLike = Schema.Schema.Type<typeof DateLike>;

// ── URL validation ────────────────────────────────────────────────────

const isWebUrl = (value: string) => {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
};

/** Web URL — accepts http: and https: (many government data portals use http). */
export const WebUrl = Schema.String.pipe(
  Schema.check(Schema.makeFilter(isWebUrl))
).annotate({ description: "Web URL (http or https)" });
export type WebUrl = Schema.Schema.Type<typeof WebUrl>;

// ── Shared entity fields ──────────────────────────────────────────────

/** Timestamp fields shared by all persisted entities. */
export const TimestampedFields = {
  createdAt: IsoTimestamp.annotate({ description: "ISO 8601 creation timestamp" }),
  updatedAt: IsoTimestamp.annotate({ description: "ISO 8601 last-modification timestamp" })
} as const;

/** Alias field carried by most DCAT and V/S/O entities. */
export const AliasedFields = {
  aliases: Aliases
} as const;

/** Combined fields for entities that are both timestamped and aliased. Spread into Schema.Struct({...TimestampedAliasedFields, ...yourFields}). */
export const TimestampedAliasedFields = {
  ...TimestampedFields,
  ...AliasedFields
} as const;
