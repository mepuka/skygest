import { Schema } from "effect";
import { VariableId } from "./data-layer/ids";
import { TimePeriod } from "./data-layer/variable";
import { PartialVariableFacetConflict } from "./errors";
import { ChartAxis, TemporalCoverage } from "./media";
import {
  PartialVariableShape,
  RequiredFacetKey
} from "./partialVariableAlgebra";
import { PostUri } from "./types";

const ZeroToOneScore = Schema.Number.pipe(
  Schema.check(Schema.isBetween({ minimum: 0, maximum: 1 }))
);

export const ResolutionOutcomeStatus = Schema.Literals([
  "Resolved",
  "Ambiguous",
  "Underspecified",
  "Conflicted",
  "OutOfRegistry",
  "NoMatch"
]);
export type ResolutionOutcomeStatus = Schema.Schema.Type<
  typeof ResolutionOutcomeStatus
>;

export const ResolutionEvidenceSource = Schema.Literals([
  "post-text",
  "chart-title",
  "x-axis",
  "y-axis",
  "series-label",
  "key-finding",
  "source-line",
  "publisher-hint"
]);
export type ResolutionEvidenceSource = Schema.Schema.Type<
  typeof ResolutionEvidenceSource
>;

export const EVIDENCE_PRECEDENCE = [
  "series-label",
  "x-axis",
  "y-axis",
  "chart-title",
  "key-finding",
  "post-text",
  "source-line",
  "publisher-hint"
] as const satisfies ReadonlyArray<ResolutionEvidenceSource>;

export const ResolutionEvidenceTier = Schema.Literals([
  "entailment",
  "strong-heuristic",
  "weak-heuristic"
]);
export type ResolutionEvidenceTier = Schema.Schema.Type<
  typeof ResolutionEvidenceTier
>;

export const ResolutionEvidenceReference = Schema.Struct({
  source: ResolutionEvidenceSource,
  text: Schema.String,
  itemKey: Schema.optionalKey(Schema.String)
});
export type ResolutionEvidenceReference = Schema.Schema.Type<
  typeof ResolutionEvidenceReference
>;

export const ResolutionBundleSeries = Schema.Struct({
  itemKey: Schema.String,
  legendLabel: Schema.String,
  unit: Schema.optionalKey(Schema.String)
});
export type ResolutionBundleSeries = Schema.Schema.Type<
  typeof ResolutionBundleSeries
>;

export const ResolutionSourceLine = Schema.Struct({
  sourceText: Schema.String,
  datasetName: Schema.optionalKey(Schema.String)
});
export type ResolutionSourceLine = Schema.Schema.Type<
  typeof ResolutionSourceLine
>;

export const ResolutionPublisherHint = Schema.Struct({
  label: Schema.String,
  confidence: Schema.optionalKey(ZeroToOneScore)
});
export type ResolutionPublisherHint = Schema.Schema.Type<
  typeof ResolutionPublisherHint
>;

export const ResolutionEvidenceBundle = Schema.Struct({
  postUri: Schema.optionalKey(PostUri),
  assetKey: Schema.optionalKey(Schema.String),
  postText: Schema.Array(Schema.String),
  chartTitle: Schema.optionalKey(Schema.String),
  xAxis: Schema.optionalKey(ChartAxis),
  yAxis: Schema.optionalKey(ChartAxis),
  series: Schema.Array(ResolutionBundleSeries),
  keyFindings: Schema.Array(Schema.String),
  sourceLines: Schema.Array(ResolutionSourceLine),
  publisherHints: Schema.Array(ResolutionPublisherHint),
  temporalCoverage: Schema.optionalKey(TemporalCoverage)
}).annotate({
  description:
    "Structured evidence bundle consumed as one unit by the resolution kernel"
});
export type ResolutionEvidenceBundle = Schema.Schema.Type<
  typeof ResolutionEvidenceBundle
>;

export const AttachedContext = Schema.Struct({
  place: Schema.optionalKey(Schema.String),
  sector: Schema.optionalKey(Schema.String),
  market: Schema.optionalKey(Schema.String),
  frequency: Schema.optionalKey(Schema.String),
  time: Schema.optionalKey(TimePeriod),
  extra: Schema.optionalKey(Schema.Record(Schema.String, Schema.String))
}).annotate({
  description:
    "Reporting context attached to a kernel interpretation without changing semantic variable identity"
});
export type AttachedContext = Schema.Schema.Type<typeof AttachedContext>;

export const ResolutionHypothesisItem = Schema.Struct({
  itemKey: Schema.optionalKey(Schema.String),
  partial: PartialVariableShape,
  attachedContext: Schema.optionalKey(AttachedContext),
  evidence: Schema.Array(ResolutionEvidenceReference)
});
export type ResolutionHypothesisItem = Schema.Schema.Type<
  typeof ResolutionHypothesisItem
>;

export const ResolutionHypothesis = Schema.Struct({
  sharedPartial: PartialVariableShape,
  attachedContext: AttachedContext,
  items: Schema.Array(ResolutionHypothesisItem),
  evidence: Schema.Array(ResolutionEvidenceReference),
  confidence: Schema.optionalKey(ZeroToOneScore),
  tier: Schema.optionalKey(ResolutionEvidenceTier)
}).annotate({
  description:
    "Structured interpretation assembled from one bundle before registry binding"
});
export type ResolutionHypothesis = Schema.Schema.Type<typeof ResolutionHypothesis>;

export const BoundResolutionItem = Schema.Struct({
  itemKey: Schema.optionalKey(Schema.String),
  semanticPartial: PartialVariableShape,
  attachedContext: AttachedContext,
  evidence: Schema.Array(ResolutionEvidenceReference),
  variableId: Schema.optionalKey(VariableId),
  label: Schema.optionalKey(Schema.String)
}).annotate({
  description:
    "Item-level resolution candidate after registry binding has been attempted"
});
export type BoundResolutionItem = Schema.Schema.Type<typeof BoundResolutionItem>;

export const Resolved = Schema.TaggedStruct("Resolved", {
  bundle: ResolutionEvidenceBundle,
  sharedPartial: PartialVariableShape,
  attachedContext: AttachedContext,
  items: Schema.Array(BoundResolutionItem),
  confidence: Schema.optionalKey(ZeroToOneScore),
  tier: Schema.optionalKey(ResolutionEvidenceTier)
});
export type Resolved = Schema.Schema.Type<typeof Resolved>;

export const Ambiguous = Schema.TaggedStruct("Ambiguous", {
  bundle: ResolutionEvidenceBundle,
  hypotheses: Schema.Array(ResolutionHypothesis),
  confidence: Schema.optionalKey(ZeroToOneScore),
  tier: Schema.optionalKey(ResolutionEvidenceTier)
});
export type Ambiguous = Schema.Schema.Type<typeof Ambiguous>;

export const Underspecified = Schema.TaggedStruct("Underspecified", {
  bundle: ResolutionEvidenceBundle,
  partial: PartialVariableShape,
  missingRequired: Schema.Array(RequiredFacetKey),
  hypotheses: Schema.Array(ResolutionHypothesis),
  confidence: Schema.optionalKey(ZeroToOneScore),
  tier: Schema.optionalKey(ResolutionEvidenceTier)
});
export type Underspecified = Schema.Schema.Type<typeof Underspecified>;

export const Conflicted = Schema.TaggedStruct("Conflicted", {
  bundle: ResolutionEvidenceBundle,
  hypotheses: Schema.Array(ResolutionHypothesis),
  conflicts: Schema.Array(PartialVariableFacetConflict)
});
export type Conflicted = Schema.Schema.Type<typeof Conflicted>;

export const OutOfRegistry = Schema.TaggedStruct("OutOfRegistry", {
  bundle: ResolutionEvidenceBundle,
  hypothesis: ResolutionHypothesis,
  items: Schema.Array(BoundResolutionItem)
});
export type OutOfRegistry = Schema.Schema.Type<typeof OutOfRegistry>;

export const NoMatch = Schema.TaggedStruct("NoMatch", {
  bundle: ResolutionEvidenceBundle,
  reason: Schema.optionalKey(Schema.String)
});
export type NoMatch = Schema.Schema.Type<typeof NoMatch>;

export const ResolutionOutcome = Schema.Union([
  Resolved,
  Ambiguous,
  Underspecified,
  Conflicted,
  OutOfRegistry,
  NoMatch
]).annotate({
  description:
    "Authoritative kernel outcome for one structured evidence bundle"
});
export type ResolutionOutcome = Schema.Schema.Type<typeof ResolutionOutcome>;
