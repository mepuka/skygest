import { Effect, Schema } from "effect";
import { DbError } from "../../domain/errors";
import { formatSchemaParseError, stringifyUnknown } from "../../platform/Json";

const toDecodeMessage = (cause: unknown) => {
  if (cause instanceof Error) {
    return cause.message;
  }

  try {
    return formatSchemaParseError(cause as never);
  } catch {
    return stringifyUnknown(cause);
  }
};

export const decodeWithDbError = <S extends Schema.Decoder<unknown>>(
  schema: S,
  input: unknown,
  message: string
): Effect.Effect<S["Type"], DbError> =>
  Effect.try({
    try: () => Schema.decodeUnknownSync(schema)(input),
    catch: (cause) =>
      new DbError({
        message: `${message}: ${toDecodeMessage(cause)}`
      })
  });
