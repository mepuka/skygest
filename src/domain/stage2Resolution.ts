import { Schema } from "effect";
import {
  Aggregation,
  FixedDims,
  StatisticType,
  UnitFamily,
  type Variable
} from "./data-layer/variable";
import { PostUri } from "./types";
import {
  Stage1MatchGrain,
  Stage1Rank,
  Stage1Residual
} from "./stage1Resolution";

const ZeroToOneScore = Schema.Number.pipe(
  Schema.check(Schema.isBetween({ minimum: 0, maximum: 1 }))
);

// TODO(2d-3.2): replace Schema.Unknown with the Phase 3 SurfaceFormEntry union.
export const SurfaceFormEntryAny = Schema.Unknown;
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

export const FacetDecompositionEvidence = Schema.TaggedStruct(
  "FacetDecompositionEvidence",
  {
    signal: Schema.Literal("facet-decomposition"),
    rank: Stage1Rank,
    matchedFacets: Schema.Array(Schema.String),
    partialShape: PartialVariableShape,
    matchedSurfaceForms: Schema.Array(SurfaceFormEntryAny)
  }
);
export type FacetDecompositionEvidence = Schema.Schema.Type<
  typeof FacetDecompositionEvidence
>;

export const FuzzyDatasetTitleEvidence = Schema.TaggedStruct(
  "FuzzyDatasetTitleEvidence",
  {
    signal: Schema.Literal("fuzzy-dataset-title"),
    rank: Stage1Rank,
    candidateTitle: Schema.String,
    score: ZeroToOneScore,
    threshold: ZeroToOneScore
  }
);
export type FuzzyDatasetTitleEvidence = Schema.Schema.Type<
  typeof FuzzyDatasetTitleEvidence
>;

export const FuzzyAgentLabelEvidence = Schema.TaggedStruct(
  "FuzzyAgentLabelEvidence",
  {
    signal: Schema.Literal("fuzzy-agent-label"),
    rank: Stage1Rank,
    candidateLabel: Schema.String,
    score: ZeroToOneScore,
    threshold: ZeroToOneScore
  }
);
export type FuzzyAgentLabelEvidence = Schema.Schema.Type<
  typeof FuzzyAgentLabelEvidence
>;

export const FuzzyTitleEvidence = Schema.TaggedStruct("FuzzyTitleEvidence", {
  signal: Schema.Literal("fuzzy-title"),
  rank: Stage1Rank,
  candidateLabel: Schema.String,
  score: ZeroToOneScore,
  threshold: ZeroToOneScore
});
export type FuzzyTitleEvidence = Schema.Schema.Type<typeof FuzzyTitleEvidence>;

export const Stage2Evidence = Schema.Union([
  FacetDecompositionEvidence,
  FuzzyDatasetTitleEvidence,
  FuzzyAgentLabelEvidence,
  FuzzyTitleEvidence
]);
export type Stage2Evidence = Schema.Schema.Type<typeof Stage2Evidence>;

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
