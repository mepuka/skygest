import { IsoTimestamp } from "../types";
import { Aliases } from "./alias";

// Re-export DateLike and WebUrl from the canonical location in types.ts
// so data-layer consumers can import from one place.
export { DateLike, WebUrl } from "../types";

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
