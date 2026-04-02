import { Schema } from "effect";
import { IngestErrorEnvelope } from "./errors";
import { AtUri, Did } from "./types";

const EpochMillis = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));
const Counter = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));

const IngestRunSummaryCounterFields = {
  totalExperts: Counter,
  expertsSucceeded: Counter,
  expertsFailed: Counter,
  pagesFetched: Counter,
  postsSeen: Counter,
  postsStored: Counter,
  postsDeleted: Counter
} as const;

const IngestRunItemKeyFields = {
  runId: Schema.String,
  did: Did,
  mode: Schema.Literals(["head", "backfill", "reconcile"])
} as const;

export const PollMode = Schema.Literals(["head", "backfill", "reconcile"]);
export type PollMode = Schema.Schema.Type<typeof PollMode>;

export const IngestTrigger = Schema.Literals(["admin", "cron"]);
export type IngestTrigger = Schema.Schema.Type<typeof IngestTrigger>;

export const IngestRunKind = Schema.Literals(["head-sweep", "backfill", "reconcile"]);
export type IngestRunKind = Schema.Schema.Type<typeof IngestRunKind>;

export const IngestRunStatus = Schema.Literals(["queued", "running", "complete", "failed"]);
export type IngestRunStatus = Schema.Schema.Type<typeof IngestRunStatus>;

export const IngestRunPhase = Schema.Literals([
  "queued",
  "preparing",
  "dispatching",
  "finalizing",
  "complete",
  "failed"
]);
export type IngestRunPhase = Schema.Schema.Type<typeof IngestRunPhase>;

export const IngestRunItemStatus = Schema.Literals([
  "queued",
  "dispatched",
  "running",
  "complete",
  "failed"
]);
export type IngestRunItemStatus = Schema.Schema.Type<typeof IngestRunItemStatus>;

export const ReconcileDepth = Schema.Literals(["recent", "deep"]);
export type ReconcileDepth = Schema.Schema.Type<typeof ReconcileDepth>;

export const BackfillStatus = Schema.Literals(["idle", "running", "complete", "failed"]);
export type BackfillStatus = Schema.Schema.Type<typeof BackfillStatus>;

export const PollHeadInput = Schema.Struct({
  did: Schema.optionalKey(Did)
});
export type PollHeadInput = Schema.Schema.Type<typeof PollHeadInput>;

export const PollBackfillInput = Schema.Struct({
  did: Schema.optionalKey(Did),
  maxPosts: Schema.optionalKey(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))),
  maxAgeDays: Schema.optionalKey(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))))
});
export type PollBackfillInput = Schema.Schema.Type<typeof PollBackfillInput>;

export const PollReconcileInput = Schema.Struct({
  did: Schema.optionalKey(Did),
  depth: Schema.optionalKey(ReconcileDepth)
});
export type PollReconcileInput = Schema.Schema.Type<typeof PollReconcileInput>;

export const IngestRunRecord = Schema.Struct({
  id: Schema.String,
  workflowInstanceId: Schema.String,
  kind: IngestRunKind,
  triggeredBy: IngestTrigger,
  requestedBy: Schema.NullOr(Schema.String),
  status: IngestRunStatus,
  phase: IngestRunPhase,
  startedAt: EpochMillis,
  finishedAt: Schema.NullOr(EpochMillis),
  lastProgressAt: Schema.NullOr(EpochMillis),
  ...IngestRunSummaryCounterFields,
  error: Schema.NullOr(IngestErrorEnvelope)
});
export type IngestRunRecord = Schema.Schema.Type<typeof IngestRunRecord>;

export const IngestRunItemRecord = Schema.Struct({
  ...IngestRunItemKeyFields,
  status: IngestRunItemStatus,
  enqueuedAt: Schema.NullOr(EpochMillis),
  attemptCount: Counter,
  startedAt: Schema.NullOr(EpochMillis),
  finishedAt: Schema.NullOr(EpochMillis),
  lastProgressAt: Schema.NullOr(EpochMillis),
  pagesFetched: Counter,
  postsSeen: Counter,
  postsStored: Counter,
  postsDeleted: Counter,
  error: Schema.NullOr(IngestErrorEnvelope)
});
export type IngestRunItemRecord = Schema.Schema.Type<typeof IngestRunItemRecord>;

export const IngestQueuedResponse = Schema.Struct({
  runId: Schema.String,
  workflowInstanceId: Schema.String,
  status: Schema.Literal("queued")
});
export type IngestQueuedResponse = Schema.Schema.Type<typeof IngestQueuedResponse>;

export const HeadSweepRunParams = Schema.Struct({
  kind: Schema.Literal("head-sweep"),
  dids: Schema.optionalKey(Schema.Array(Did)),
  triggeredBy: IngestTrigger,
  requestedBy: Schema.optionalKey(Schema.NullOr(Schema.String))
});
export type HeadSweepRunParams = Schema.Schema.Type<typeof HeadSweepRunParams>;

export const BackfillRunParams = Schema.Struct({
  kind: Schema.Literal("backfill"),
  dids: Schema.optionalKey(Schema.Array(Did)),
  maxPosts: Schema.optionalKey(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))),
  maxAgeDays: Schema.optionalKey(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))),
  triggeredBy: Schema.Literal("admin"),
  requestedBy: Schema.optionalKey(Schema.NullOr(Schema.String))
});
export type BackfillRunParams = Schema.Schema.Type<typeof BackfillRunParams>;

export const ReconcileRunParams = Schema.Struct({
  kind: Schema.Literal("reconcile"),
  dids: Schema.optionalKey(Schema.Array(Did)),
  depth: Schema.optionalKey(ReconcileDepth),
  triggeredBy: Schema.Literal("admin"),
  requestedBy: Schema.optionalKey(Schema.NullOr(Schema.String))
});
export type ReconcileRunParams = Schema.Schema.Type<typeof ReconcileRunParams>;

export const IngestRunParams = Schema.Union([
  HeadSweepRunParams,
  BackfillRunParams,
  ReconcileRunParams
]);
export type IngestRunParams = Schema.Schema.Type<typeof IngestRunParams>;

export const IngestRunSummaryCounters = Schema.Struct(IngestRunSummaryCounterFields);
export type IngestRunSummaryCounters = Schema.Schema.Type<typeof IngestRunSummaryCounters>;

export const IngestRunItemSummary = Schema.Struct({
  ...IngestRunSummaryCounterFields,
  error: Schema.NullOr(IngestErrorEnvelope)
});
export type IngestRunItemSummary = Schema.Schema.Type<typeof IngestRunItemSummary>;

export const IngestRunRecoverySummary = Schema.Struct({
  failedItems: Counter,
  requeuedItems: Counter
});
export type IngestRunRecoverySummary = Schema.Schema.Type<typeof IngestRunRecoverySummary>;

export const IngestRepairSummary = Schema.Struct({
  repairedRuns: Counter,
  failedItems: Counter,
  requeuedItems: Counter,
  untouchedRuns: Counter
});
export type IngestRepairSummary = Schema.Schema.Type<typeof IngestRepairSummary>;

export const CreateQueuedIngestRun = Schema.Struct({
  id: Schema.String,
  workflowInstanceId: Schema.String,
  kind: IngestRunKind,
  triggeredBy: IngestTrigger,
  requestedBy: Schema.NullOr(Schema.String),
  startedAt: EpochMillis
});
export type CreateQueuedIngestRun = Schema.Schema.Type<typeof CreateQueuedIngestRun>;

export const MarkIngestRunPreparing = Schema.Struct({
  id: Schema.String,
  lastProgressAt: EpochMillis
});
export type MarkIngestRunPreparing = Schema.Schema.Type<typeof MarkIngestRunPreparing>;

export const MarkIngestRunDispatching = Schema.Struct({
  id: Schema.String,
  totalExperts: Counter,
  lastProgressAt: EpochMillis
});
export type MarkIngestRunDispatching = Schema.Schema.Type<typeof MarkIngestRunDispatching>;

export const MarkIngestRunFinalizing = Schema.Struct({
  id: Schema.String,
  lastProgressAt: EpochMillis
});
export type MarkIngestRunFinalizing = Schema.Schema.Type<typeof MarkIngestRunFinalizing>;

export const UpdateIngestRunProgress = Schema.Struct({
  id: Schema.String,
  lastProgressAt: EpochMillis,
  ...IngestRunSummaryCounterFields
});
export type UpdateIngestRunProgress = Schema.Schema.Type<typeof UpdateIngestRunProgress>;

export const CompleteIngestRun = Schema.Struct({
  id: Schema.String,
  finishedAt: EpochMillis,
  ...IngestRunSummaryCounterFields
});
export type CompleteIngestRun = Schema.Schema.Type<typeof CompleteIngestRun>;

export const FailIngestRun = Schema.Struct({
  id: Schema.String,
  finishedAt: EpochMillis,
  error: IngestErrorEnvelope,
  totalExperts: Schema.optionalKey(Counter),
  expertsSucceeded: Schema.optionalKey(Counter),
  expertsFailed: Schema.optionalKey(Counter),
  pagesFetched: Schema.optionalKey(Counter),
  postsSeen: Schema.optionalKey(Counter),
  postsStored: Schema.optionalKey(Counter),
  postsDeleted: Schema.optionalKey(Counter)
});
export type FailIngestRun = Schema.Schema.Type<typeof FailIngestRun>;

export const IngestRunItemKey = Schema.Struct(IngestRunItemKeyFields);
export type IngestRunItemKey = Schema.Schema.Type<typeof IngestRunItemKey>;

export const CreateIngestRunItem = IngestRunItemKey;
export type CreateIngestRunItem = Schema.Schema.Type<typeof CreateIngestRunItem>;

export const MarkIngestRunItemDispatched = Schema.Struct({
  ...IngestRunItemKeyFields,
  enqueuedAt: EpochMillis,
  lastProgressAt: EpochMillis
});
export type MarkIngestRunItemDispatched = Schema.Schema.Type<typeof MarkIngestRunItemDispatched>;

export const MarkIngestRunItemQueued = Schema.Struct({
  ...IngestRunItemKeyFields,
  lastProgressAt: EpochMillis
});
export type MarkIngestRunItemQueued = Schema.Schema.Type<typeof MarkIngestRunItemQueued>;

export const MarkIngestRunItemRunning = Schema.Struct({
  ...IngestRunItemKeyFields,
  startedAt: EpochMillis,
  lastProgressAt: EpochMillis
});
export type MarkIngestRunItemRunning = Schema.Schema.Type<typeof MarkIngestRunItemRunning>;

export const UpdateIngestRunItemCounts = Schema.Struct({
  ...IngestRunItemKeyFields,
  attemptCount: Counter,
  pagesFetched: Counter,
  postsSeen: Counter,
  postsStored: Counter,
  postsDeleted: Counter,
  lastProgressAt: EpochMillis
});
export type UpdateIngestRunItemCounts = Schema.Schema.Type<typeof UpdateIngestRunItemCounts>;

export const CompleteIngestRunItem = Schema.Struct({
  ...IngestRunItemKeyFields,
  attemptCount: Counter,
  pagesFetched: Counter,
  postsSeen: Counter,
  postsStored: Counter,
  postsDeleted: Counter,
  finishedAt: EpochMillis
});
export type CompleteIngestRunItem = Schema.Schema.Type<typeof CompleteIngestRunItem>;

export const FailIngestRunItem = Schema.Struct({
  ...IngestRunItemKeyFields,
  attemptCount: Counter,
  pagesFetched: Counter,
  postsSeen: Counter,
  postsStored: Counter,
  postsDeleted: Counter,
  finishedAt: EpochMillis,
  error: IngestErrorEnvelope
});
export type FailIngestRunItem = Schema.Schema.Type<typeof FailIngestRunItem>;

export const HeadPollRequest = Schema.Struct({
  mode: Schema.Literal("head"),
  did: Schema.optionalKey(Did)
});
export const BackfillPollRequest = Schema.Struct({
  mode: Schema.Literal("backfill"),
  did: Schema.optionalKey(Did),
  maxPosts: Schema.optionalKey(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))),
  maxAgeDays: Schema.optionalKey(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))))
});
export const ReconcilePollRequest = Schema.Struct({
  mode: Schema.Literal("reconcile"),
  did: Schema.optionalKey(Did),
  depth: Schema.optionalKey(ReconcileDepth)
});
export const PollRequest = Schema.Union([
  HeadPollRequest,
  BackfillPollRequest,
  ReconcilePollRequest
]);
export type PollRequest = Schema.Schema.Type<typeof PollRequest>;

export const ExpertSyncStateRecord = Schema.Struct({
  did: Did,
  pdsUrl: Schema.NullOr(Schema.String),
  pdsVerifiedAt: Schema.NullOr(EpochMillis),
  headUri: Schema.NullOr(AtUri),
  headRkey: Schema.NullOr(Schema.String),
  headCreatedAt: Schema.NullOr(EpochMillis),
  lastPolledAt: Schema.NullOr(EpochMillis),
  lastCompletedAt: Schema.NullOr(EpochMillis),
  backfillCursor: Schema.NullOr(Schema.String),
  backfillStatus: BackfillStatus,
  lastError: Schema.NullOr(IngestErrorEnvelope)
});
export type ExpertSyncStateRecord = Schema.Schema.Type<typeof ExpertSyncStateRecord>;

export const RepoListRecordsInput = Schema.Struct({
  repo: Did,
  collection: Schema.String,
  cursor: Schema.optionalKey(Schema.String),
  limit: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  reverse: Schema.optionalKey(Schema.Boolean)
});
export type RepoListRecordsInput = Schema.Schema.Type<typeof RepoListRecordsInput>;

export const ServiceListRecordsInput = Schema.Struct({
  serviceUrl: Schema.String,
  repo: Did,
  collection: Schema.String,
  cursor: Schema.optionalKey(Schema.String),
  limit: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  reverse: Schema.optionalKey(Schema.Boolean)
});
export type ServiceListRecordsInput = Schema.Schema.Type<typeof ServiceListRecordsInput>;

export const RepoPostRecordValue = Schema.Struct({
  createdAt: Schema.String,
  text: Schema.optionalKey(Schema.String),
  facets: Schema.optionalKey(Schema.Array(Schema.Unknown)),
  embed: Schema.optionalKey(Schema.Unknown),
  tags: Schema.optionalKey(Schema.Array(Schema.String)),
  labels: Schema.optionalKey(Schema.Unknown)
});
export type RepoPostRecordValue = Schema.Schema.Type<typeof RepoPostRecordValue>;

export const RepoRecord = Schema.Struct({
  uri: AtUri,
  cid: Schema.String,
  value: RepoPostRecordValue
});
export type RepoRecord = Schema.Schema.Type<typeof RepoRecord>;

export const ListRecordsResult = Schema.Struct({
  records: Schema.Array(RepoRecord),
  cursor: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefaultKey(() => null))
});
export type ListRecordsResult = Schema.Schema.Type<typeof ListRecordsResult>;
