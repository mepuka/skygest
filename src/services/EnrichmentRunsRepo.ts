import { Context, Effect } from "effect";
import type { SqlError } from "effect/unstable/sql";
import type { DbError } from "../domain/errors";
import type {
  CompleteEnrichmentRun,
  CreateQueuedEnrichmentRun,
  EnrichmentRunRecord,
  EnrichmentRunListOptions,
  FailEnrichmentRun,
  ListStaleEnrichmentRuns,
  MarkEnrichmentRunNeedsReview,
  MarkEnrichmentRunPhase,
  ResetEnrichmentRunForRetry
} from "../domain/enrichmentRun";

export class EnrichmentRunsRepo extends Context.Tag("@skygest/EnrichmentRunsRepo")<
  EnrichmentRunsRepo,
  {
    readonly createQueuedIfAbsent: (
      input: CreateQueuedEnrichmentRun
    ) => Effect.Effect<boolean, SqlError | DbError>;
    readonly getById: (
      id: string
    ) => Effect.Effect<EnrichmentRunRecord | null, SqlError | DbError>;
    readonly listRunning: () => Effect.Effect<ReadonlyArray<EnrichmentRunRecord>, SqlError | DbError>;
    readonly listRecent: (
      input: EnrichmentRunListOptions
    ) => Effect.Effect<ReadonlyArray<EnrichmentRunRecord>, SqlError | DbError>;
    readonly listActive: () => Effect.Effect<ReadonlyArray<EnrichmentRunRecord>, SqlError | DbError>;
    readonly listStaleActive: (
      input: ListStaleEnrichmentRuns
    ) => Effect.Effect<ReadonlyArray<EnrichmentRunRecord>, SqlError | DbError>;
    readonly markPhase: (
      input: MarkEnrichmentRunPhase
    ) => Effect.Effect<void, SqlError | DbError>;
    readonly markComplete: (
      input: CompleteEnrichmentRun
    ) => Effect.Effect<void, SqlError | DbError>;
    readonly markFailed: (
      input: FailEnrichmentRun
    ) => Effect.Effect<void, SqlError | DbError>;
    readonly markNeedsReview: (
      input: MarkEnrichmentRunNeedsReview
    ) => Effect.Effect<void, SqlError | DbError>;
    readonly resetForRetry: (
      input: ResetEnrichmentRunForRetry
    ) => Effect.Effect<boolean, SqlError | DbError>;
    readonly listLatestByPostUri: (
      postUri: string
    ) => Effect.Effect<ReadonlyArray<EnrichmentRunRecord>, SqlError | DbError>;
  }
>() {}
