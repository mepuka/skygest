import { Schema } from "effect";

export const EmberOpenApiOperation = Schema.Struct({
  summary: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
  operationId: Schema.optionalKey(Schema.String)
});
export type EmberOpenApiOperation = Schema.Schema.Type<
  typeof EmberOpenApiOperation
>;

export const EmberOpenApiPathItem = Schema.Struct({
  get: Schema.optionalKey(EmberOpenApiOperation)
});
export type EmberOpenApiPathItem = Schema.Schema.Type<
  typeof EmberOpenApiPathItem
>;

export const EmberOpenApiDocument = Schema.Struct({
  paths: Schema.Record(Schema.String, EmberOpenApiPathItem)
});
export type EmberOpenApiDocument = Schema.Schema.Type<
  typeof EmberOpenApiDocument
>;
