import { Schema } from "effect";
import { AtUri, Did } from "./types";

export const PollMode = Schema.Literal("head", "backfill", "reconcile");
export type PollMode = Schema.Schema.Type<typeof PollMode>;

export const ReconcileDepth = Schema.Literal("recent", "deep");
export type ReconcileDepth = Schema.Schema.Type<typeof ReconcileDepth>;

export const BackfillStatus = Schema.Literal("idle", "running", "complete", "failed");
export type BackfillStatus = Schema.Schema.Type<typeof BackfillStatus>;

export const PollFailure = Schema.Struct({
  did: Schema.optional(Did),
  message: Schema.String
});
export type PollFailure = Schema.Schema.Type<typeof PollFailure>;

export const PollRunSummary = Schema.Struct({
  runId: Schema.String,
  mode: PollMode,
  startedAt: Schema.Number,
  finishedAt: Schema.Number,
  expertsTotal: Schema.Number,
  expertsSucceeded: Schema.Number,
  expertsFailed: Schema.Number,
  pagesFetched: Schema.Number,
  postsSeen: Schema.Number,
  postsStored: Schema.Number,
  postsDeleted: Schema.Number,
  failures: Schema.Array(PollFailure)
});
export type PollRunSummary = Schema.Schema.Type<typeof PollRunSummary>;

export const PollHeadInput = Schema.Struct({
  did: Schema.optional(Did)
});
export type PollHeadInput = Schema.Schema.Type<typeof PollHeadInput>;

export const PollBackfillInput = Schema.Struct({
  did: Schema.optional(Did),
  maxPosts: Schema.optional(Schema.NonNegativeInt),
  maxAgeDays: Schema.optional(Schema.NonNegativeInt)
});
export type PollBackfillInput = Schema.Schema.Type<typeof PollBackfillInput>;

export const PollReconcileInput = Schema.Struct({
  did: Schema.optional(Did),
  depth: Schema.optional(ReconcileDepth)
});
export type PollReconcileInput = Schema.Schema.Type<typeof PollReconcileInput>;

export type PollRequest =
  | {
      readonly mode: "head";
      readonly did?: Did;
    }
  | {
      readonly mode: "backfill";
      readonly did?: Did;
      readonly maxPosts?: number;
      readonly maxAgeDays?: number;
    }
  | {
      readonly mode: "reconcile";
      readonly did?: Did;
      readonly depth?: ReconcileDepth;
    };

export const ExpertSyncStateRecord = Schema.Struct({
  did: Did,
  pdsUrl: Schema.NullOr(Schema.String),
  pdsVerifiedAt: Schema.NullOr(Schema.Number),
  headUri: Schema.NullOr(AtUri),
  headRkey: Schema.NullOr(Schema.String),
  headCreatedAt: Schema.NullOr(Schema.Number),
  lastPolledAt: Schema.NullOr(Schema.Number),
  lastCompletedAt: Schema.NullOr(Schema.Number),
  backfillCursor: Schema.NullOr(Schema.String),
  backfillStatus: BackfillStatus,
  lastError: Schema.NullOr(Schema.String)
});
export type ExpertSyncStateRecord = Schema.Schema.Type<typeof ExpertSyncStateRecord>;

export const RepoListRecordsInput = Schema.Struct({
  repo: Did,
  collection: Schema.String,
  cursor: Schema.optional(Schema.String),
  limit: Schema.NonNegativeInt,
  reverse: Schema.optional(Schema.Boolean)
});
export type RepoListRecordsInput = Schema.Schema.Type<typeof RepoListRecordsInput>;

export const ServiceListRecordsInput = Schema.Struct({
  serviceUrl: Schema.String,
  repo: Did,
  collection: Schema.String,
  cursor: Schema.optional(Schema.String),
  limit: Schema.NonNegativeInt,
  reverse: Schema.optional(Schema.Boolean)
});
export type ServiceListRecordsInput = Schema.Schema.Type<typeof ServiceListRecordsInput>;

export const RepoRecord = Schema.Struct({
  uri: AtUri,
  cid: Schema.String,
  value: Schema.Unknown
});
export type RepoRecord = Schema.Schema.Type<typeof RepoRecord>;

export const ListRecordsResult = Schema.Struct({
  records: Schema.Array(RepoRecord),
  cursor: Schema.NullOr(Schema.String)
});
export type ListRecordsResult = Schema.Schema.Type<typeof ListRecordsResult>;
