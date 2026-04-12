import { Schema } from "effect";
import { ZeroToOneScore } from "./confidence";
import { FacetKey } from "./partialVariableAlgebra";
import { Stage2PartialVariableShape } from "./stage2Core";
import { Stage1Rank } from "./stage1Shared";
import { SurfaceFormEntryAny } from "./surfaceForm";

export const FacetDecompositionEvidence = Schema.TaggedStruct(
  "FacetDecompositionEvidence",
  {
    signal: Schema.Literal("facet-decomposition"),
    rank: Stage1Rank,
    matchedFacets: Schema.Array(FacetKey),
    partialShape: Stage2PartialVariableShape,
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

// Reserved for a future free-text title lane once Stage 2 broadens beyond the
// current dataset-title and agent-label handlers.
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
