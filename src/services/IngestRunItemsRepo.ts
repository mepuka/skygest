import { ServiceMap, Effect } from "effect";
import { SqlError } from "effect/unstable/sql/SqlError";
import type { DbError } from "../domain/errors";
import type {
  CompleteIngestRunItem,
  CreateIngestRunItem,
  FailIngestRunItem,
  IngestRunItemKey,
  IngestRunItemRecord,
  IngestRunItemSummary,
  MarkIngestRunItemDispatched,
  MarkIngestRunItemQueued,
  MarkIngestRunItemRunning,
  UpdateIngestRunItemCounts
} from "../domain/polling";

export class IngestRunItemsRepo extends ServiceMap.Service<
  IngestRunItemsRepo,
  {
    readonly createMany: (
      items: ReadonlyArray<CreateIngestRunItem>
    ) => Effect.Effect<void, SqlError | DbError>;
    readonly markDispatched: (
      input: MarkIngestRunItemDispatched
    ) => Effect.Effect<void, SqlError | DbError>;
    readonly markQueued: (
      input: MarkIngestRunItemQueued
    ) => Effect.Effect<void, SqlError | DbError>;
    readonly markRunning: (
      input: MarkIngestRunItemRunning
    ) => Effect.Effect<void, SqlError | DbError>;
    readonly markProgress: (
      input: UpdateIngestRunItemCounts
    ) => Effect.Effect<void, SqlError | DbError>;
    readonly markComplete: (
      input: CompleteIngestRunItem
    ) => Effect.Effect<void, SqlError | DbError>;
    readonly markFailed: (
      input: FailIngestRunItem
    ) => Effect.Effect<void, SqlError | DbError>;
    readonly listByRun: (
      runId: string
    ) => Effect.Effect<ReadonlyArray<IngestRunItemRecord>, SqlError | DbError>;
    readonly countActiveByRun: (
      runId: string
    ) => Effect.Effect<number, SqlError | DbError>;
    readonly countIncompleteByRun: (
      runId: string
    ) => Effect.Effect<number, SqlError | DbError>;
    readonly listUndispatchedByRun: (
      runId: string,
      limit: number
    ) => Effect.Effect<ReadonlyArray<IngestRunItemRecord>, SqlError | DbError>;
    readonly listStaleDispatchedByRun: (
      runId: string,
      staleBefore: number
    ) => Effect.Effect<ReadonlyArray<IngestRunItemRecord>, SqlError | DbError>;
    readonly listStaleRunningByRun: (
      runId: string,
      staleBefore: number
    ) => Effect.Effect<ReadonlyArray<IngestRunItemRecord>, SqlError | DbError>;
    readonly summarizeByRun: (
      runId: string
    ) => Effect.Effect<IngestRunItemSummary, SqlError | DbError>;
  }
>()("@skygest/IngestRunItemsRepo") {}
