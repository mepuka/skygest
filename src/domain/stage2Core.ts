import { Schema } from "effect";
import {
  Aggregation,
  FixedDims,
  StatisticType,
  UnitFamily,
  type Variable
} from "./data-layer/variable";
import { PostUri } from "./types";
import { Stage1Residual } from "./stage1Residual";
import { Stage1MatchGrain, Stage1Rank } from "./stage1Shared";

// TODO(2d-3.2): replace this JSON-safe placeholder with the Phase 3 SurfaceFormEntry union.
export const SurfaceFormEntryAny = Schema.Struct({
  surfaceForm: Schema.String,
  normalizedSurfaceForm: Schema.optionalKey(Schema.String),
  canonical: Schema.optionalKey(Schema.String),
  provenance: Schema.optionalKey(Schema.String),
  notes: Schema.optionalKey(Schema.String),
  addedAt: Schema.optionalKey(Schema.String),
  source: Schema.optionalKey(Schema.String)
});
export type SurfaceFormEntryAny = Schema.Schema.Type<typeof SurfaceFormEntryAny>;

export const PartialVariableShape = Schema.Struct({
  label: Schema.optionalKey(Schema.String),
  definition: Schema.optionalKey(Schema.String),
  measuredProperty: Schema.optionalKey(Schema.String),
  domainObject: Schema.optionalKey(Schema.String),
  technologyOrFuel: Schema.optionalKey(Schema.String),
  statisticType: Schema.optionalKey(StatisticType),
  aggregation: Schema.optionalKey(Aggregation),
  basis: Schema.optionalKey(Schema.Array(Schema.String)),
  unitFamily: Schema.optionalKey(UnitFamily),
  fixedDims: Schema.optionalKey(FixedDims)
}).annotate({
  description:
    "Stage 2's partial Variable guess: semantic facets plus optional fixed dimensions"
});
export type PartialVariableShape = Schema.Schema.Type<
  typeof PartialVariableShape
>;

export const CandidateEntry = Schema.Struct({
  entityId: Schema.String,
  label: Schema.String,
  grain: Stage1MatchGrain,
  matchedFacets: Schema.Array(Schema.String),
  rank: Stage1Rank
});
export type CandidateEntry = Schema.Schema.Type<typeof CandidateEntry>;

export const Stage2Lane = Schema.Literals([
  "facet-decomposition",
  "fuzzy-dataset-title",
  "fuzzy-agent-label",
  "tie-breaker",
  "no-op"
]);
export type Stage2Lane = Schema.Schema.Type<typeof Stage2Lane>;

export const Stage3Input = Schema.TaggedStruct("Stage3Input", {
  postUri: PostUri,
  originalResidual: Stage1Residual,
  stage2Lane: Stage2Lane,
  partialDecomposition: Schema.optionalKey(PartialVariableShape),
  candidateSet: Schema.Array(CandidateEntry),
  matchedSurfaceForms: Schema.Array(SurfaceFormEntryAny),
  unmatchedSurfaceForms: Schema.Array(Schema.String),
  reason: Schema.String
});
export type Stage3Input = Schema.Schema.Type<typeof Stage3Input>;

export type PartialVariableAsVariableSubset = Partial<
  Pick<
    Variable,
    | "label"
    | "definition"
    | "measuredProperty"
    | "domainObject"
    | "technologyOrFuel"
    | "statisticType"
    | "aggregation"
    | "basis"
    | "unitFamily"
  >
>;
