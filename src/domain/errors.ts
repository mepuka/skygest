import { Schema } from "effect";

export class AuthError extends Schema.TaggedError<AuthError>()("AuthError", {
  message: Schema.String
}) {}

export class BlueskyApiError extends Schema.TaggedError<BlueskyApiError>()(
  "BlueskyApiError",
  {
    message: Schema.String,
    status: Schema.optional(Schema.Number)
  }
) {}

export class DbError extends Schema.TaggedError<DbError>()("DbError", {
  message: Schema.String
}) {}

export class QueueError extends Schema.TaggedError<QueueError>()("QueueError", {
  message: Schema.String
}) {}
