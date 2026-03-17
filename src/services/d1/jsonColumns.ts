import { Effect } from "effect";
import { DbError } from "../../domain/errors";
import { decodeJsonString, encodeJsonString, stringifyUnknown } from "../../platform/Json";

export const encodeJsonColumnWithDbError = (value: unknown | null, field: string) =>
  Effect.try({
    try: () => value === null ? null : encodeJsonString(value),
    catch: (cause) =>
      DbError.make({
        message: `Failed to encode ${field}: ${stringifyUnknown(cause)}`
      })
  });

export const decodeJsonColumnWithDbError = (value: string | null, field: string) =>
  Effect.try({
    try: () => value === null ? null : decodeJsonString(value),
    catch: (cause) =>
      DbError.make({
        message: `Failed to decode ${field}: ${stringifyUnknown(cause)}`
      })
  });
