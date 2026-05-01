import { Clock, Effect, Layer, Schema, ServiceMap } from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";

import type { ReindexQueueItem } from "../Domain/EntityGraph";
import type { EntityNotFoundError } from "../Domain/Errors";
import { ProjectionWriteError } from "../Domain/Projection";
import {
  AiSearchClient,
  DEFAULT_ENTITY_SEARCH_INSTANCE
} from "./AiSearchClient";
import {
  EntityProjectionRegistry,
  EntityProjectionRegistryLookupError
} from "./EntityProjectionRegistry";
import { ReindexQueueService } from "./ReindexQueue";

export class EntityProjectionDrainItemError extends Schema.TaggedErrorClass<EntityProjectionDrainItemError>()(
  "EntityProjectionDrainItemError",
  {
    queueId: Schema.String,
    targetIri: Schema.String,
    entityType: Schema.String,
    message: Schema.String,
    cause: Schema.Unknown
  }
) {}

export interface EntityProjectionDrainResult {
  readonly pulled: number;
  readonly rendered: number;
  readonly failed: number;
}

export interface EntityProjectionDrainOptions {
  readonly concurrency?: number;
}

export const ENTITY_PROJECTION_DRAIN_DEFAULT_CONCURRENCY = 1;
export const ENTITY_PROJECTION_DRAIN_MAX_CONCURRENCY = 16;

type DrainItemError =
  | EntityProjectionRegistryLookupError
  | EntityProjectionDrainItemError
  | EntityNotFoundError
  | ProjectionWriteError
  | Schema.SchemaError
  | SqlError;

const messageFromUnknown = (cause: unknown): string => {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === "object" && cause !== null) {
    const record = cause as Record<string, unknown>;
    const tag = record._tag;
    const message = record.message;
    if (typeof tag === "string" && typeof message === "string") {
      return `${tag}: ${message}`;
    }
    if (typeof tag === "string") return tag;
  }
  return String(cause);
};

const drainItemFailure = (
  item: ReindexQueueItem,
  cause: unknown
): EntityProjectionDrainItemError =>
  new EntityProjectionDrainItemError({
    queueId: item.queueId,
    targetIri: item.targetIri,
    entityType: item.targetEntityType,
    message: messageFromUnknown(cause),
    cause
  });

const normalizeConcurrency = (
  options: EntityProjectionDrainOptions | undefined
): number => {
  const requested =
    options?.concurrency ?? ENTITY_PROJECTION_DRAIN_DEFAULT_CONCURRENCY;
  if (!Number.isFinite(requested)) {
    return ENTITY_PROJECTION_DRAIN_DEFAULT_CONCURRENCY;
  }
  return Math.min(
    ENTITY_PROJECTION_DRAIN_MAX_CONCURRENCY,
    Math.max(1, Math.floor(requested))
  );
};

export class EntityProjectionDrainService extends ServiceMap.Service<
  EntityProjectionDrainService,
  {
    readonly drainBatch: (
      batch: ReadonlyArray<ReindexQueueItem>,
      options?: EntityProjectionDrainOptions
    ) => Effect.Effect<EntityProjectionDrainResult, SqlError>;
    readonly drainNext: (
      limit: number,
      options?: EntityProjectionDrainOptions
    ) => Effect.Effect<EntityProjectionDrainResult, SqlError>;
  }
>()("@skygest/ontology-store/EntityProjectionDrainService") {
  static readonly layer = Layer.effect(
    EntityProjectionDrainService,
    Effect.gen(function* () {
      const registry = yield* EntityProjectionRegistry;
      const queue = yield* ReindexQueueService;
      const client = yield* AiSearchClient;

      const projectOne = (
        item: ReindexQueueItem
      ): Effect.Effect<void, DrainItemError> =>
        Effect.gen(function* () {
          const entry = yield* registry.get(item.targetEntityType);
          const entity = yield* entry.storage.load(item.targetIri as never);
          yield* client.upload(
            DEFAULT_ENTITY_SEARCH_INSTANCE,
            entry.projection.toKey(entity as never),
            entry.projection.toBody(entity as never),
            entry.projection.toMetadata(entity as never)
          ).pipe(
            Effect.mapError(
              (cause) => new ProjectionWriteError({ op: "upsert", cause })
            )
          );
          yield* queue.markComplete(item.queueId);
        }).pipe(
          Effect.mapError((cause) =>
            cause instanceof EntityProjectionRegistryLookupError ||
            cause instanceof EntityProjectionDrainItemError
              ? cause
              : drainItemFailure(item, cause)
          )
        );

      const drainOne = (
        item: ReindexQueueItem
      ): Effect.Effect<boolean, SqlError> =>
        projectOne(item).pipe(
          Effect.as(true),
          Effect.catch((cause) =>
            Effect.gen(function* () {
              const now = yield* Clock.currentTimeMillis;
              yield* queue.markFailed(item.queueId, now, messageFromUnknown(cause));
              return false;
            })
          )
        );

      const drainBatch = (
        batch: ReadonlyArray<ReindexQueueItem>,
        options?: EntityProjectionDrainOptions
      ) =>
        Effect.gen(function* () {
          const results = yield* Effect.forEach(batch, drainOne, {
            concurrency: normalizeConcurrency(options)
          });
          const rendered = results.filter((result) => result).length;
          return {
            pulled: batch.length,
            rendered,
            failed: batch.length - rendered
          };
        });

      const drainNext = (
        limit: number,
        options?: EntityProjectionDrainOptions
      ) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          const batch = yield* queue.nextBatch(now, limit);
          return yield* drainBatch(batch, options);
        });

      return EntityProjectionDrainService.of({ drainBatch, drainNext });
    })
  );
}
