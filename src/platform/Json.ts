import { Schema } from "effect";

export const encodeJsonString = Schema.encodeUnknownSync(Schema.UnknownFromJsonString);
export const decodeJsonString = Schema.decodeUnknownSync(Schema.UnknownFromJsonString);

export const encodeJsonStringWith = <S extends Schema.Encoder<unknown>>(schema: S) =>
  (input: S["Type"]) => encodeJsonString(Schema.encodeUnknownSync(schema)(input));

export const decodeJsonStringWith = <S extends Schema.Decoder<unknown>>(schema: S) =>
  Schema.decodeUnknownSync(Schema.fromJsonString(schema as Schema.Top & S) as Schema.Decoder<unknown>) as
    (input: unknown, options?: import("effect/SchemaAST").ParseOptions) => S["Type"];

export const decodeJsonStringEitherWith = <S extends Schema.Decoder<unknown>>(schema: S) =>
  Schema.decodeUnknownResult(Schema.fromJsonString(schema as Schema.Top & S) as Schema.Decoder<unknown>) as
    (input: unknown, options?: import("effect/SchemaAST").ParseOptions) => import("effect/Result").Result<S["Type"], import("effect/SchemaIssue").Issue>;

export const decodeUnknownEitherWith = <S extends Schema.Decoder<unknown>>(schema: S) =>
  Schema.decodeUnknownResult(schema);

export const formatSchemaParseError = (error: Schema.SchemaError | import("effect/SchemaIssue").Issue) =>
  "issue" in error ? String(error.issue) : String(error);

/**
 * Strip keys whose value is `undefined` so the object satisfies
 * `exactOptionalPropertyTypes`. Useful when Schema-decoded optional
 * fields produce `T | undefined` but the target signature uses `prop?: T`.
 */
export const stripUndefined = <T extends Record<string, unknown>>(obj: T): { [K in keyof T]: Exclude<T[K], undefined> } => {
  const result: any = {};
  for (const key of Object.keys(obj)) {
    if ((obj as any)[key] !== undefined) {
      result[key] = (obj as any)[key];
    }
  }
  return result;
};

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
