import { Schema } from "effect";
import { FixedDims } from "./data-layer/variable";
import {
  FacetKey,
  PARTIAL_VARIABLE_FIELDS
} from "./partialVariableAlgebra";
import { PostUri } from "./types";
import { ResolutionEntityId } from "./resolutionEntityId";
import { Stage2Lane as Stage2LaneSchema } from "./stage2Lane";
import { SurfaceFormEntryAny } from "./surfaceForm";
import { Stage1Residual } from "./stage1Residual";
import { Stage1MatchGrain, Stage1Rank } from "./stage1Shared";

export { PartialVariableShape as KernelPartialVariableShape } from "./partialVariableAlgebra";
export { Stage2Lane } from "./stage2Lane";

export const Stage2PartialVariableShape = Schema.Struct({
  ...PARTIAL_VARIABLE_FIELDS,
  label: Schema.optionalKey(Schema.String),
  definition: Schema.optionalKey(Schema.String),
  fixedDims: Schema.optionalKey(FixedDims)
}).annotate({
  description:
    "Stage 2's partial Variable guess: semantic facets plus optional fixed dimensions"
});
export type Stage2PartialVariableShape = Schema.Schema.Type<
  typeof Stage2PartialVariableShape
>;

export const CandidateEntry = Schema.Struct({
  entityId: ResolutionEntityId,
  label: Schema.String,
  grain: Stage1MatchGrain,
  matchedFacets: Schema.Array(FacetKey),
  rank: Stage1Rank
});
export type CandidateEntry = Schema.Schema.Type<typeof CandidateEntry>;

export const Stage3Input = Schema.TaggedStruct("Stage3Input", {
  postUri: PostUri,
  originalResidual: Stage1Residual,
  stage2Lane: Stage2LaneSchema,
  partialDecomposition: Schema.optionalKey(Stage2PartialVariableShape),
  candidateSet: Schema.Array(CandidateEntry),
  matchedSurfaceForms: Schema.Array(SurfaceFormEntryAny),
  unmatchedSurfaceForms: Schema.Array(Schema.String),
  reason: Schema.String
});
export type Stage3Input = Schema.Schema.Type<typeof Stage3Input>;
