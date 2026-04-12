import { Schema } from "effect";
import { IsoTimestamp } from "./types";

const NonEmptyString = Schema.String.pipe(Schema.check(Schema.isMinLength(1)));

export const EnergyProfileFacetKey = Schema.Union([
  Schema.Literal("measuredProperty"),
  Schema.Literal("domainObject"),
  Schema.Literal("technologyOrFuel"),
  Schema.Literal("statisticType"),
  Schema.Literal("aggregation"),
  Schema.Literal("unitFamily"),
  Schema.Literal("policyInstrument")
]);
export type EnergyProfileFacetKey = Schema.Schema.Type<
  typeof EnergyProfileFacetKey
>;

export const EnergyProfileClosedEnumSpec = Schema.Struct({
  shapeIri: NonEmptyString,
  values: Schema.Array(NonEmptyString)
});
export type EnergyProfileClosedEnumSpec = Schema.Schema.Type<
  typeof EnergyProfileClosedEnumSpec
>;

export const EnergyProfileManifest = Schema.Struct({
  manifestVersion: Schema.Literal(1),
  sourceCommit: NonEmptyString,
  generatedAt: IsoTimestamp,
  inputHash: NonEmptyString,
  facetKeys: Schema.Array(EnergyProfileFacetKey),
  requiredFacetKeys: Schema.Array(EnergyProfileFacetKey),
  closedEnums: Schema.Struct({
    StatisticType: EnergyProfileClosedEnumSpec,
    Aggregation: EnergyProfileClosedEnumSpec,
    UnitFamily: EnergyProfileClosedEnumSpec
  })
});
export type EnergyProfileManifest = Schema.Schema.Type<
  typeof EnergyProfileManifest
>;
