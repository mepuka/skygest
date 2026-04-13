import { Schema } from "effect";
import { ZeroToOneScore } from "./confidence";
import { AgentId, DatasetId, VariableId } from "./data-layer/ids";
import { TimePeriod } from "./data-layer/variable";
import { PartialVariableFacetConflict } from "./errors";
import { ChartAxis, TemporalCoverage } from "./media";
import {
  FacetKey,
  PartialVariableShape,
  RequiredFacetKey
} from "./partialVariableAlgebra";
import { PostUri } from "./types";

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

export const VariableCandidateScore = Schema.Struct({
  variableId: VariableId,
  label: Schema.String,
  matchedFacets: Schema.Array(FacetKey),
  mismatchedFacets: Schema.Array(PartialVariableFacetConflict),
  subsumptionRatio: Schema.Number.pipe(
    Schema.check(Schema.isGreaterThanOrEqualTo(0))
  ),
  partialSpecificity: Schema.Int.pipe(
    Schema.check(Schema.isGreaterThanOrEqualTo(0))
  ),
  semanticPartial: PartialVariableShape
}).annotate({
  description:
    "Ranked registry variable candidate with facet-level match diagnostics"
});
export type VariableCandidateScore = Schema.Schema.Type<
  typeof VariableCandidateScore
>;

export const ResolutionGapReason = Schema.Literals([
  "missing-required",
  "no-candidates",
  "dataset-scope-empty",
  "agent-scope-empty",
  "ambiguous-candidates",
  "required-facet-conflict"
]);
export type ResolutionGapReason = Schema.Schema.Type<
  typeof ResolutionGapReason
>;

export const ResolutionGap = Schema.Struct({
  partial: PartialVariableShape,
  missingRequired: Schema.optionalKey(Schema.Array(RequiredFacetKey)),
  candidates: Schema.Array(VariableCandidateScore),
  reason: ResolutionGapReason,
  context: Schema.optionalKey(
    Schema.Struct({
      agentId: Schema.optionalKey(AgentId),
      datasetIds: Schema.optionalKey(Schema.Array(DatasetId)),
      attachedContext: Schema.optionalKey(AttachedContext)
    })
  )
}).annotate({
  description:
    "Preserved unresolved state emitted when the kernel cannot choose one variable"
});
export type ResolutionGap = Schema.Schema.Type<typeof ResolutionGap>;

export const BoundResolutionBoundItem = Schema.TaggedStruct("bound", {
  itemKey: Schema.optionalKey(Schema.String),
  semanticPartial: PartialVariableShape,
  attachedContext: AttachedContext,
  evidence: Schema.Array(ResolutionEvidenceReference),
  variableId: VariableId,
  label: Schema.optionalKey(Schema.String)
}).annotate({
  description:
    "Item-level resolution that successfully bound to one registry variable"
});
export type BoundResolutionBoundItem = Schema.Schema.Type<
  typeof BoundResolutionBoundItem
>;

export const BoundResolutionGapItem = Schema.TaggedStruct("gap", {
  itemKey: Schema.optionalKey(Schema.String),
  semanticPartial: PartialVariableShape,
  attachedContext: AttachedContext,
  evidence: Schema.Array(ResolutionEvidenceReference),
  candidates: Schema.Array(VariableCandidateScore),
  missingRequired: Schema.optionalKey(Schema.Array(RequiredFacetKey)),
  reason: ResolutionGapReason
}).annotate({
  description:
    "Item-level unresolved state preserved for ambiguous, underspecified, or out-of-registry branches"
});
export type BoundResolutionGapItem = Schema.Schema.Type<
  typeof BoundResolutionGapItem
>;

export const BoundResolutionItem = Schema.Union([
  BoundResolutionBoundItem,
  BoundResolutionGapItem
]).annotate({
  description:
    "Tagged item-level kernel result preserving either a bound variable or an unresolved gap"
});
export type BoundResolutionItem = Schema.Schema.Type<typeof BoundResolutionItem>;

export const Resolved = Schema.TaggedStruct("Resolved", {
  bundle: ResolutionEvidenceBundle,
  sharedPartial: PartialVariableShape,
  attachedContext: AttachedContext,
  items: Schema.Array(BoundResolutionItem),
  agentId: Schema.optionalKey(AgentId),
  datasetIds: Schema.optionalKey(Schema.Array(DatasetId)),
  confidence: Schema.optionalKey(ZeroToOneScore),
  tier: Schema.optionalKey(ResolutionEvidenceTier)
});
export type Resolved = Schema.Schema.Type<typeof Resolved>;

export const Ambiguous = Schema.TaggedStruct("Ambiguous", {
  bundle: ResolutionEvidenceBundle,
  hypotheses: Schema.Array(ResolutionHypothesis),
  items: Schema.Array(BoundResolutionItem),
  gaps: Schema.Array(ResolutionGap),
  confidence: Schema.optionalKey(ZeroToOneScore),
  tier: Schema.optionalKey(ResolutionEvidenceTier)
});
export type Ambiguous = Schema.Schema.Type<typeof Ambiguous>;

export const Underspecified = Schema.TaggedStruct("Underspecified", {
  bundle: ResolutionEvidenceBundle,
  partial: PartialVariableShape,
  missingRequired: Schema.Array(RequiredFacetKey),
  gap: ResolutionGap,
  gaps: Schema.Array(ResolutionGap),
  confidence: Schema.optionalKey(ZeroToOneScore),
  tier: Schema.optionalKey(ResolutionEvidenceTier)
});
export type Underspecified = Schema.Schema.Type<typeof Underspecified>;

export const Conflicted = Schema.TaggedStruct("Conflicted", {
  bundle: ResolutionEvidenceBundle,
  hypotheses: Schema.Array(ResolutionHypothesis),
  conflicts: Schema.Array(PartialVariableFacetConflict),
  gaps: Schema.Array(ResolutionGap),
  confidence: Schema.optionalKey(ZeroToOneScore),
  tier: Schema.optionalKey(ResolutionEvidenceTier)
});
export type Conflicted = Schema.Schema.Type<typeof Conflicted>;

export const OutOfRegistry = Schema.TaggedStruct("OutOfRegistry", {
  bundle: ResolutionEvidenceBundle,
  hypothesis: ResolutionHypothesis,
  items: Schema.Array(BoundResolutionItem),
  gap: ResolutionGap
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
