import { Context, Effect } from "effect";
import type { SqlError } from "@effect/sql/SqlError";
import type {
  CompleteIngestRun,
  CreateQueuedIngestRun,
  FailIngestRun,
  IngestRunRecord,
  MarkIngestRunDispatching,
  MarkIngestRunFinalizing,
  MarkIngestRunPreparing
} from "../domain/polling";

export class IngestRunsRepo extends Context.Tag("@skygest/IngestRunsRepo")<
  IngestRunsRepo,
  {
    readonly createQueuedIfAbsent: (
      input: CreateQueuedIngestRun
    ) => Effect.Effect<boolean, SqlError>;
    readonly getById: (
      id: string
    ) => Effect.Effect<IngestRunRecord | null, SqlError>;
    readonly listRunning: () => Effect.Effect<ReadonlyArray<IngestRunRecord>, SqlError>;
    readonly markPreparing: (
      input: MarkIngestRunPreparing
    ) => Effect.Effect<void, SqlError>;
    readonly markDispatching: (
      input: MarkIngestRunDispatching
    ) => Effect.Effect<void, SqlError>;
    readonly markFinalizing: (
      input: MarkIngestRunFinalizing
    ) => Effect.Effect<void, SqlError>;
    readonly markComplete: (
      input: CompleteIngestRun
    ) => Effect.Effect<void, SqlError>;
    readonly markFailed: (
      input: FailIngestRun
    ) => Effect.Effect<void, SqlError>;
  }
>() {}
