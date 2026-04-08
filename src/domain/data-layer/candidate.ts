import { Schema } from "effect";
import { ContentId } from "../content";
import { IsoTimestamp } from "../types";
import { DateLike } from "./base";
import {
  AgentId,
  CandidateId,
  DatasetId,
  DistributionId,
  SeriesId,
  VariableId
} from "./ids";
import { DesignDecision } from "./annotations";
import { Observation } from "./variable";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const ResolutionState = Schema.Literals([
  "source_only",
  "partially_resolved",
  "resolved"
]).annotate({
  description:
    "How far along the resolution pipeline this Candidate has progressed"
});
export type ResolutionState = Schema.Schema.Type<typeof ResolutionState>;

// ---------------------------------------------------------------------------
// SourceRef — link back to the content that produced the Candidate
// ---------------------------------------------------------------------------

export const SourceRef = Schema.Struct({
  contentId: ContentId.annotate({
    description:
      "PostUri or PodcastSegmentUri identifying the source content"
  }),
  segment: Schema.optionalKey(
    Schema.String.annotate({
      description: "Sub-content locator (e.g., 'chart-1')"
    })
  )
}).annotate({
  description:
    "Reference back to the source content that produced this Candidate"
});
export type SourceRef = Schema.Schema.Type<typeof SourceRef>;

// ---------------------------------------------------------------------------
// AssertedTime — optional time claim extracted from the source
// ---------------------------------------------------------------------------

export const AssertedTime = Schema.Struct({
  start: Schema.optionalKey(DateLike),
  end: Schema.optionalKey(DateLike),
  label: Schema.optionalKey(Schema.String)
});
export type AssertedTime = Schema.Schema.Type<typeof AssertedTime>;

// ---------------------------------------------------------------------------
// Candidate — editorial primitive produced by post extraction
// ---------------------------------------------------------------------------

export const Candidate = Schema.Struct({
  _tag: Schema.Literal("Candidate"),
  id: CandidateId,
  sourceRef: SourceRef,
  referencedDistributionId: Schema.optionalKey(DistributionId),
  referencedDatasetId: Schema.optionalKey(DatasetId),
  referencedAgentId: Schema.optionalKey(AgentId),
  referencedVariableId: Schema.optionalKey(VariableId),
  referencedSeriesId: Schema.optionalKey(SeriesId),
  assertedValue: Schema.optionalKey(
    Schema.Union([Schema.Number, Schema.String])
  ),
  assertedUnit: Schema.optionalKey(Schema.String),
  assertedTime: Schema.optionalKey(AssertedTime),
  rawLabel: Schema.optionalKey(Schema.String),
  rawDims: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  resolutionState: ResolutionState,
  createdAt: IsoTimestamp
}).annotate({
  description:
    "Editorial primitive produced by post extraction. May be fully or partially resolved. Not a degraded form of Observation — they are independent types.",
  [DesignDecision]: "D7"
});
export type Candidate = Schema.Schema.Type<typeof Candidate>;

// ---------------------------------------------------------------------------
// DataLayerRecord — discriminated union of all atomic data-layer records
// ---------------------------------------------------------------------------

export const DataLayerRecord = Schema.Union([Candidate, Observation]);
export type DataLayerRecord = Schema.Schema.Type<typeof DataLayerRecord>;
