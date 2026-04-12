import { Schema } from "effect";
import { ResolutionEntityId } from "./resolutionEntityId";
import { Stage1Evidence } from "./stage1Evidence";
import {
  MatchTextSource,
  Stage1MatchGrain,
  Stage1Rank,
  UrlSource
} from "./stage1Shared";

export const UnmatchedUrlResidual = Schema.TaggedStruct("UnmatchedUrlResidual", {
  source: UrlSource,
  url: Schema.String,
  normalizedUrl: Schema.optionalKey(Schema.String),
  hostname: Schema.optionalKey(Schema.String)
});
export type UnmatchedUrlResidual = Schema.Schema.Type<typeof UnmatchedUrlResidual>;

export const UnmatchedDatasetTitleResidual = Schema.TaggedStruct(
  "UnmatchedDatasetTitleResidual",
  {
    datasetName: Schema.String,
    normalizedTitle: Schema.String,
    assetKey: Schema.optionalKey(Schema.String)
  }
);
export type UnmatchedDatasetTitleResidual = Schema.Schema.Type<
  typeof UnmatchedDatasetTitleResidual
>;

export const UnmatchedTextResidual = Schema.TaggedStruct("UnmatchedTextResidual", {
  source: MatchTextSource,
  text: Schema.String,
  normalizedText: Schema.String,
  assetKey: Schema.optionalKey(Schema.String),
  location: Schema.optionalKey(Schema.String)
});
export type UnmatchedTextResidual = Schema.Schema.Type<
  typeof UnmatchedTextResidual
>;

export const AmbiguousCandidate = Schema.Struct({
  entityId: ResolutionEntityId,
  label: Schema.String
});
export type AmbiguousCandidate = Schema.Schema.Type<typeof AmbiguousCandidate>;

export const AmbiguousCandidatesResidual = Schema.TaggedStruct(
  "AmbiguousCandidatesResidual",
  {
    grain: Stage1MatchGrain,
    bestRank: Stage1Rank,
    candidates: Schema.Array(AmbiguousCandidate),
    evidence: Schema.Array(Stage1Evidence)
  }
);
export type AmbiguousCandidatesResidual = Schema.Schema.Type<
  typeof AmbiguousCandidatesResidual
>;

export const DeferredToStage2Residual = Schema.TaggedStruct(
  "DeferredToStage2Residual",
  {
    source: MatchTextSource,
    text: Schema.String,
    reason: Schema.String,
    assetKey: Schema.optionalKey(Schema.String)
  }
);
export type DeferredToStage2Residual = Schema.Schema.Type<
  typeof DeferredToStage2Residual
>;

export const Stage1Residual = Schema.Union([
  UnmatchedUrlResidual,
  UnmatchedDatasetTitleResidual,
  UnmatchedTextResidual,
  AmbiguousCandidatesResidual,
  DeferredToStage2Residual
]);
export type Stage1Residual = Schema.Schema.Type<typeof Stage1Residual>;
