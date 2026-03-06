import { Schema } from "effect";

export class MissingOperatorSecretEnvError extends Schema.TaggedError<MissingOperatorSecretEnvError>()(
  "MissingOperatorSecretEnvError",
  {
    envVar: Schema.String
  }
) {}

export class InvalidBaseUrlError extends Schema.TaggedError<InvalidBaseUrlError>()(
  "InvalidBaseUrlError",
  {
    value: Schema.String
  }
) {}

export class StagingRequestError extends Schema.TaggedError<StagingRequestError>()(
  "StagingRequestError",
  {
    operation: Schema.String,
    message: Schema.String,
    status: Schema.optional(Schema.Number)
  }
) {}

export class SmokeAssertionError extends Schema.TaggedError<SmokeAssertionError>()(
  "SmokeAssertionError",
  {
    message: Schema.String
  }
) {}

export class WranglerDeployError extends Schema.TaggedError<WranglerDeployError>()(
  "WranglerDeployError",
  {
    command: Schema.String,
    message: Schema.String
  }
) {}
