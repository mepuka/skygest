import { Schema } from "effect";

export const ResolverVersion = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1))
);
export type ResolverVersion = Schema.Schema.Type<typeof ResolverVersion>;

export const ResolverBulkItemError = Schema.Struct({
  tag: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  message: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  retryable: Schema.optionalKey(Schema.Boolean)
});
export type ResolverBulkItemError = Schema.Schema.Type<
  typeof ResolverBulkItemError
>;
