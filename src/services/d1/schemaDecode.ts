import { Effect, Result, Schema } from "effect";
import { DbError } from "../../domain/errors";
import { formatSchemaParseError, stringifyUnknown } from "../../platform/Json";

const toDecodeMessage = (cause: unknown) => {
  if (cause instanceof Error) {
    return cause.message;
  }

  if (typeof cause === "object" && cause !== null) {
    return formatSchemaParseError(cause as never);
  }

  return stringifyUnknown(cause);
};

export const decodeWithDbError = <S extends Schema.Decoder<unknown>>(
  schema: S,
  input: unknown,
  message: string
): Effect.Effect<S["Type"], DbError> => {
  const decoded = Schema.decodeUnknownResult(schema)(input);
  return Result.isSuccess(decoded)
    ? Effect.succeed(decoded.success)
    : Effect.fail(
      new DbError({
        message: `${message}: ${toDecodeMessage(decoded.failure)}`
      })
    );
};
