import { SqlError } from "@effect/sql/SqlError";
import { Effect, Schema } from "effect";
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

export const decodeWithSqlError = <A, I>(
  schema: Schema.Schema<A, I, never>,
  input: unknown,
  message: string
) =>
  Effect.try({
    try: () => Schema.decodeUnknownSync(schema)(input),
    catch: (cause) =>
      new SqlError({
        cause,
        message: `${message}: ${toDecodeMessage(cause)}`
      })
  });
