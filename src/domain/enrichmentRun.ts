import { Schema } from "effect";
import { EnrichmentErrorEnvelope } from "./errors";
import { EnrichmentKind } from "./enrichment";
import { AtUri } from "./types";

const EpochMillis = Schema.NonNegativeInt;
const Counter = Schema.NonNegativeInt;

export const EnrichmentTrigger = Schema.Literal("pick", "admin", "repair");
export type EnrichmentTrigger = Schema.Schema.Type<typeof EnrichmentTrigger>;

export const EnrichmentRunStatus = Schema.Literal(
  "queued",
  "running",
  "complete",
  "failed",
  "needs-review"
);
export type EnrichmentRunStatus = Schema.Schema.Type<typeof EnrichmentRunStatus>;

export const EnrichmentRunPhase = Schema.Literal(
  "queued",
  "assembling",
  "planning",
  "executing",
  "validating",
  "persisting",
  "complete",
  "failed",
  "needs-review"
);
export type EnrichmentRunPhase = Schema.Schema.Type<typeof EnrichmentRunPhase>;

export const EnrichmentRunActivePhase = Schema.Literal(
  "assembling",
  "planning",
  "executing",
  "validating",
  "persisting"
);
export type EnrichmentRunActivePhase = Schema.Schema.Type<
  typeof EnrichmentRunActivePhase
>;

export const EnrichmentRunRecord = Schema.Struct({
  id: Schema.String,
  workflowInstanceId: Schema.String,
  postUri: AtUri,
  enrichmentType: EnrichmentKind,
  schemaVersion: Schema.String.pipe(Schema.minLength(1)),
  triggeredBy: EnrichmentTrigger,
  requestedBy: Schema.NullOr(Schema.String),
  status: EnrichmentRunStatus,
  phase: EnrichmentRunPhase,
  attemptCount: Schema.NonNegativeInt,
  modelLane: Schema.NullOr(Schema.String),
  promptVersion: Schema.NullOr(Schema.String),
  inputFingerprint: Schema.NullOr(Schema.String),
  startedAt: EpochMillis,
  finishedAt: Schema.NullOr(EpochMillis),
  lastProgressAt: Schema.NullOr(EpochMillis),
  resultWrittenAt: Schema.NullOr(EpochMillis),
  error: Schema.NullOr(EnrichmentErrorEnvelope)
});
export type EnrichmentRunRecord = Schema.Schema.Type<typeof EnrichmentRunRecord>;

export const CreateQueuedEnrichmentRun = Schema.Struct({
  id: Schema.String,
  workflowInstanceId: Schema.String,
  postUri: AtUri,
  enrichmentType: EnrichmentKind,
  schemaVersion: Schema.String.pipe(Schema.minLength(1)),
  triggeredBy: EnrichmentTrigger,
  requestedBy: Schema.NullOr(Schema.String),
  modelLane: Schema.NullOr(Schema.String),
  promptVersion: Schema.NullOr(Schema.String),
  inputFingerprint: Schema.NullOr(Schema.String),
  startedAt: EpochMillis
});
export type CreateQueuedEnrichmentRun = Schema.Schema.Type<
  typeof CreateQueuedEnrichmentRun
>;

export const MarkEnrichmentRunPhase = Schema.Struct({
  id: Schema.String,
  phase: EnrichmentRunActivePhase,
  lastProgressAt: EpochMillis
});
export type MarkEnrichmentRunPhase = Schema.Schema.Type<
  typeof MarkEnrichmentRunPhase
>;

export const CompleteEnrichmentRun = Schema.Struct({
  id: Schema.String,
  finishedAt: EpochMillis,
  resultWrittenAt: Schema.NullOr(EpochMillis)
});
export type CompleteEnrichmentRun = Schema.Schema.Type<
  typeof CompleteEnrichmentRun
>;

export const FailEnrichmentRun = Schema.Struct({
  id: Schema.String,
  finishedAt: EpochMillis,
  error: EnrichmentErrorEnvelope
});
export type FailEnrichmentRun = Schema.Schema.Type<typeof FailEnrichmentRun>;

export const MarkEnrichmentRunNeedsReview = Schema.Struct({
  id: Schema.String,
  lastProgressAt: EpochMillis,
  resultWrittenAt: Schema.optional(Schema.NullOr(EpochMillis)),
  error: Schema.NullOr(EnrichmentErrorEnvelope)
});
export type MarkEnrichmentRunNeedsReview = Schema.Schema.Type<
  typeof MarkEnrichmentRunNeedsReview
>;

export const EnrichmentRunParams = Schema.Struct({
  postUri: AtUri,
  enrichmentType: EnrichmentKind,
  schemaVersion: Schema.String.pipe(Schema.minLength(1)),
  triggeredBy: EnrichmentTrigger,
  requestedBy: Schema.optional(Schema.NullOr(Schema.String))
});
export type EnrichmentRunParams = Schema.Schema.Type<typeof EnrichmentRunParams>;

export const EnrichmentQueuedResponse = Schema.Struct({
  runId: Schema.String,
  workflowInstanceId: Schema.String,
  status: Schema.Literal("queued")
});
export type EnrichmentQueuedResponse = Schema.Schema.Type<
  typeof EnrichmentQueuedResponse
>;

export const EnrichmentRunListOptions = Schema.Struct({
  status: Schema.optional(EnrichmentRunStatus),
  limit: Schema.Int.pipe(Schema.between(1, 100))
});
export type EnrichmentRunListOptions = Schema.Schema.Type<
  typeof EnrichmentRunListOptions
>;

export const ListStaleEnrichmentRuns = Schema.Struct({
  queuedBefore: EpochMillis,
  runningBefore: EpochMillis
});
export type ListStaleEnrichmentRuns = Schema.Schema.Type<
  typeof ListStaleEnrichmentRuns
>;

export const ResetEnrichmentRunForRetry = Schema.Struct({
  id: Schema.String,
  queuedAt: EpochMillis
});
export type ResetEnrichmentRunForRetry = Schema.Schema.Type<
  typeof ResetEnrichmentRunForRetry
>;

export const EnrichmentRunsOutput = Schema.Struct({
  items: Schema.Array(EnrichmentRunRecord)
});
export type EnrichmentRunsOutput = Schema.Schema.Type<
  typeof EnrichmentRunsOutput
>;

export const EnrichmentRepairSummary = Schema.Struct({
  repairedRuns: Counter,
  staleQueuedRuns: Counter,
  staleRunningRuns: Counter,
  untouchedRuns: Counter
});
export type EnrichmentRepairSummary = Schema.Schema.Type<
  typeof EnrichmentRepairSummary
>;
