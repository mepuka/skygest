import { Schema } from "effect";

export const EnergyChartsOpenApiOperation = Schema.Struct({
  summary: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
  operationId: Schema.optionalKey(Schema.String)
});
export type EnergyChartsOpenApiOperation = Schema.Schema.Type<
  typeof EnergyChartsOpenApiOperation
>;

export const EnergyChartsOpenApiPathItem = Schema.Struct({
  get: Schema.optionalKey(EnergyChartsOpenApiOperation)
});
export type EnergyChartsOpenApiPathItem = Schema.Schema.Type<
  typeof EnergyChartsOpenApiPathItem
>;

export const EnergyChartsOpenApiDocument = Schema.Struct({
  paths: Schema.Record(Schema.String, EnergyChartsOpenApiPathItem)
});
export type EnergyChartsOpenApiDocument = Schema.Schema.Type<
  typeof EnergyChartsOpenApiDocument
>;
