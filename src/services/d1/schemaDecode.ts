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

export const decodeWithDbError = <A, I>(
  schema: Schema.Schema<A, I, never>,
  input: unknown,
  message: string
) =>
  Effect.try({
    try: () => Schema.decodeUnknownSync(schema)(input),
    catch: (cause) =>
      DbError.make({
        message: `${message}: ${toDecodeMessage(cause)}`
      })
  });
