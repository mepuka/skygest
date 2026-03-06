import { ParseResult, Schema } from "effect";

const JsonStringSchema = Schema.parseJson();

export const encodeJsonString = Schema.encodeUnknownSync(JsonStringSchema);
export const decodeJsonString = Schema.decodeUnknownSync(JsonStringSchema);

export const decodeJsonStringWith = <A, I>(schema: Schema.Schema<A, I, never>) =>
  Schema.decodeUnknownSync(Schema.parseJson(schema));

export const decodeJsonStringEitherWith = <A, I>(schema: Schema.Schema<A, I, never>) =>
  Schema.decodeUnknownEither(Schema.parseJson(schema));

export const decodeUnknownEitherWith = <A, I>(schema: Schema.Schema<A, I, never>) =>
  Schema.decodeUnknownEither(schema);

export const formatSchemaParseError = (error: ParseResult.ParseError) =>
  ParseResult.TreeFormatter.formatErrorSync(error);
