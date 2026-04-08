import { Schema } from "effect";
import { IsoTimestamp } from "../types";
import { Aliases } from "./alias";

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
