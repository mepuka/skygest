import { ParseResult, Schema } from "effect";

const JsonStringSchema = Schema.parseJson();

export const encodeJsonString = Schema.encodeUnknownSync(JsonStringSchema);
export const decodeJsonString = Schema.decodeUnknownSync(JsonStringSchema);

export const encodeJsonStringWith = <A, I>(schema: Schema.Schema<A, I, never>) =>
  (input: A) => encodeJsonString(Schema.encodeUnknownSync(schema)(input));

export const decodeJsonStringWith = <A, I>(schema: Schema.Schema<A, I, never>) =>
  Schema.decodeUnknownSync(Schema.parseJson(schema));

export const decodeJsonStringEitherWith = <A, I>(schema: Schema.Schema<A, I, never>) =>
  Schema.decodeUnknownEither(Schema.parseJson(schema));

export const decodeUnknownEitherWith = <A, I>(schema: Schema.Schema<A, I, never>) =>
  Schema.decodeUnknownEither(schema);

export const formatSchemaParseError = (error: ParseResult.ParseError) =>
  ParseResult.TreeFormatter.formatErrorSync(error);

export const stringifyUnknown = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }

  if (value instanceof Error) {
    return value.message;
  }

  try {
    return encodeJsonString(value);
  } catch {
    return String(value);
  }
};
