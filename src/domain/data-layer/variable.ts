import { Schema } from "effect";
import { DesignDecision, SchemaOrgType, SdmxConcept } from "./annotations";
import { DateLike, TimestampedAliasedFields } from "./base";
import {
  SeriesOntologyFields,
  VariableOntologyFields
} from "../generated/dataLayerSpine";
import { DistributionId, ObservationId, SeriesId, VariableId } from "./ids";

export { Aggregation, StatisticType, UnitFamily } from "./variable-enums";

export const TimePeriod = Schema.Struct({
  start: DateLike,
  end: Schema.optionalKey(DateLike)
}).annotate({ description: "Time period with required start and optional end (YYYY, YYYY-MM, YYYY-MM-DD, or ISO 8601)" });
export type TimePeriod = Schema.Schema.Type<typeof TimePeriod>;

export const FixedDims = Schema.Struct({
  place: Schema.optionalKey(Schema.String),
  sector: Schema.optionalKey(Schema.String),
  market: Schema.optionalKey(Schema.String),
  frequency: Schema.optionalKey(Schema.String),
  extra: Schema.optionalKey(Schema.Record(Schema.String, Schema.String))
}).annotate({ description: "Reporting-context dimensions that lock a Variable into a Series" });
export type FixedDims = Schema.Schema.Type<typeof FixedDims>;

// ---------------------------------------------------------------------------
// Variable — seven-facet composition
// ---------------------------------------------------------------------------

export const Variable = Schema.Struct({
  ...TimestampedAliasedFields,
  _tag: Schema.Literal("Variable"),
  id: VariableId,
  ...VariableOntologyFields
}).annotate({
  description: "Statistical variable defined by up to seven semantic facets (D1, D2)",
  [SchemaOrgType]: "https://schema.org/StatisticalVariable",
  [SdmxConcept]: "Concept",
  [DesignDecision]: "D1, D2"
});
export type Variable = Schema.Schema.Type<typeof Variable>;

// ---------------------------------------------------------------------------
// Series — Variable locked to a reporting context
// ---------------------------------------------------------------------------

export const Series = Schema.Struct({
  ...TimestampedAliasedFields,
  _tag: Schema.Literal("Series"),
  id: SeriesId,
  ...SeriesOntologyFields,
  fixedDims: FixedDims
}).annotate({
  description: "A Variable locked to a specific reporting context via fixed dimensions (D1)",
  [SdmxConcept]: "SeriesKey",
  [DesignDecision]: "D1"
});
export type Series = Schema.Schema.Type<typeof Series>;

// ---------------------------------------------------------------------------
// Observation — data primitive
// ---------------------------------------------------------------------------

export const Observation = Schema.Struct({
  _tag: Schema.Literal("Observation"),
  id: ObservationId,
  seriesId: SeriesId,
  time: TimePeriod,
  value: Schema.Number,
  unit: Schema.String,
  sourceDistributionId: DistributionId,
  qualification: Schema.optionalKey(Schema.String)
}).annotate({
  description: "Single data point within a Series — the atomic unit of measurement (D1, D7)",
  [SchemaOrgType]: "https://schema.org/Observation",
  [SdmxConcept]: "Observation",
  [DesignDecision]: "D1, D7"
});
export type Observation = Schema.Schema.Type<typeof Observation>;
