import { Effect, Schema, ServiceMap } from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";

import type {
  EntityIri,
  EntityTag,
  ReindexCause,
  ReindexQueueItem
} from "../Domain/EntityGraph";

export interface ReindexRequest {
  readonly targetEntityType: EntityTag;
  readonly targetIri: EntityIri;
  readonly originIri: EntityIri;
  readonly cause: ReindexCause;
  readonly causePriority: number;
  readonly propagationDepth: number;
  readonly nextAttemptAt: number;
}

export interface ReindexBatchResult {
  readonly rendered: number;
  readonly failed: number;
}

export class ReindexDepthExceededError extends Schema.TaggedErrorClass<ReindexDepthExceededError>()(
  "ReindexDepthExceededError",
  {
    propagationDepth: Schema.Number
  }
) {}

export class ReindexQueueService extends ServiceMap.Service<
  ReindexQueueService,
  {
    readonly schedule: (
      request: ReindexRequest
    ) => Effect.Effect<void, ReindexDepthExceededError | SqlError>;
    readonly nextBatch: (
      now: number,
      limit: number
    ) => Effect.Effect<ReadonlyArray<ReindexQueueItem>, SqlError>;
    readonly markComplete: (queueId: string) => Effect.Effect<void, SqlError>;
    readonly markFailed: (
      queueId: string,
      now: number,
      message?: string
    ) => Effect.Effect<void, SqlError>;
    readonly drain: (
      batch: ReadonlyArray<ReindexQueueItem>
    ) => Effect.Effect<ReindexBatchResult, unknown>;
  }
>()("@skygest/ontology-store/ReindexQueueService") {
  static readonly Noop = ReindexQueueService.of({
    schedule: (request) =>
      request.propagationDepth > 1
        ? Effect.fail(
            new ReindexDepthExceededError({
              propagationDepth: request.propagationDepth
            })
          )
        : Effect.void,
    nextBatch: () => Effect.succeed([]),
    markComplete: () => Effect.void,
    markFailed: () => Effect.void,
    drain: (batch) => Effect.succeed({ rendered: batch.length, failed: 0 })
  });
}
