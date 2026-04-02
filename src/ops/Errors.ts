import { Schema } from "effect";

export class MissingOperatorSecretEnvError extends Schema.TaggedErrorClass<MissingOperatorSecretEnvError>()(
  "MissingOperatorSecretEnvError",
  {
    envVar: Schema.String
  }
) {}

export class InvalidBaseUrlError extends Schema.TaggedErrorClass<InvalidBaseUrlError>()(
  "InvalidBaseUrlError",
  {
    value: Schema.String
  }
) {}

export class StagingRequestError extends Schema.TaggedErrorClass<StagingRequestError>()(
  "StagingRequestError",
  {
    operation: Schema.String,
    message: Schema.String,
    status: Schema.optionalKey(Schema.Number)
  }
) {}

export class SmokeAssertionError extends Schema.TaggedErrorClass<SmokeAssertionError>()(
  "SmokeAssertionError",
  {
    message: Schema.String
  }
) {}

export class WranglerDeployError extends Schema.TaggedErrorClass<WranglerDeployError>()(
  "WranglerDeployError",
  {
    command: Schema.String,
    message: Schema.String
  }
) {}
