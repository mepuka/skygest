import { Context, Effect } from "effect";
import type { SqlError } from "@effect/sql/SqlError";
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

export class IngestRunItemsRepo extends Context.Tag("@skygest/IngestRunItemsRepo")<
  IngestRunItemsRepo,
  {
    readonly createMany: (
      items: ReadonlyArray<CreateIngestRunItem>
    ) => Effect.Effect<void, SqlError>;
    readonly markDispatched: (
      input: MarkIngestRunItemDispatched
    ) => Effect.Effect<void, SqlError>;
    readonly markQueued: (
      input: MarkIngestRunItemQueued
    ) => Effect.Effect<void, SqlError>;
    readonly markRunning: (
      input: MarkIngestRunItemRunning
    ) => Effect.Effect<void, SqlError>;
    readonly markProgress: (
      input: UpdateIngestRunItemCounts
    ) => Effect.Effect<void, SqlError>;
    readonly markComplete: (
      input: CompleteIngestRunItem
    ) => Effect.Effect<void, SqlError>;
    readonly markFailed: (
      input: FailIngestRunItem
    ) => Effect.Effect<void, SqlError>;
    readonly listByRun: (
      runId: string
    ) => Effect.Effect<ReadonlyArray<IngestRunItemRecord>, SqlError>;
    readonly countActiveByRun: (
      runId: string
    ) => Effect.Effect<number, SqlError>;
    readonly countIncompleteByRun: (
      runId: string
    ) => Effect.Effect<number, SqlError>;
    readonly listUndispatchedByRun: (
      runId: string,
      limit: number
    ) => Effect.Effect<ReadonlyArray<IngestRunItemRecord>, SqlError>;
    readonly listStaleDispatchedByRun: (
      runId: string,
      staleBefore: number
    ) => Effect.Effect<ReadonlyArray<IngestRunItemRecord>, SqlError>;
    readonly listStaleRunningByRun: (
      runId: string,
      staleBefore: number
    ) => Effect.Effect<ReadonlyArray<IngestRunItemRecord>, SqlError>;
    readonly summarizeByRun: (
      runId: string
    ) => Effect.Effect<IngestRunItemSummary, SqlError>;
  }
>() {}
