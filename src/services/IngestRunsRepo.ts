import { ServiceMap, Effect } from "effect";
import type { SqlError } from "effect/unstable/sql";
import type { DbError } from "../domain/errors";
import type {
  CompleteIngestRun,
  CreateQueuedIngestRun,
  FailIngestRun,
  IngestRunRecord,
  MarkIngestRunDispatching,
  MarkIngestRunFinalizing,
  MarkIngestRunPreparing,
  UpdateIngestRunProgress
} from "../domain/polling";

export class IngestRunsRepo extends ServiceMap.Service<
  IngestRunsRepo,
  {
    readonly createQueuedIfAbsent: (
      input: CreateQueuedIngestRun
    ) => Effect.Effect<boolean, SqlError | DbError>;
    readonly getById: (
      id: string
    ) => Effect.Effect<IngestRunRecord | null, SqlError | DbError>;
    readonly listRunning: () => Effect.Effect<ReadonlyArray<IngestRunRecord>, SqlError | DbError>;
    readonly markPreparing: (
      input: MarkIngestRunPreparing
    ) => Effect.Effect<void, SqlError | DbError>;
    readonly markDispatching: (
      input: MarkIngestRunDispatching
    ) => Effect.Effect<void, SqlError | DbError>;
    readonly markFinalizing: (
      input: MarkIngestRunFinalizing
    ) => Effect.Effect<void, SqlError | DbError>;
    readonly updateProgress: (
      input: UpdateIngestRunProgress
    ) => Effect.Effect<void, SqlError | DbError>;
    readonly markComplete: (
      input: CompleteIngestRun
    ) => Effect.Effect<void, SqlError | DbError>;
    readonly markFailed: (
      input: FailIngestRun
    ) => Effect.Effect<void, SqlError | DbError>;
  }
>()("@skygest/IngestRunsRepo") {}
