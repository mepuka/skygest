import { Effect, Layer, Result, Schema, ServiceMap } from "effect";
import type {
  EntitySearchEntityType,
  EntitySearchIndexError,
  EntitySearchSemanticRecallHit,
  EntitySearchSemanticRecallInput
} from "../domain/entitySearch";
import {
  EntitySearchEntityId,
  EntitySearchSemanticRecallHit as EntitySearchSemanticRecallHitSchema,
  EntitySearchEntityType as EntitySearchEntityTypeSchema,
  EntitySearchIndexError as EntitySearchIndexErrorClass
} from "../domain/entitySearch";
import { CloudflareEnv } from "../platform/Env";
import {
  decodeUnknownEitherWith,
  stringifyUnknown
} from "../platform/Json";

export class EntitySemanticRecall extends ServiceMap.Service<
  EntitySemanticRecall,
  {
    readonly recall: (
      input: EntitySearchSemanticRecallInput
    ) => Effect.Effect<
      ReadonlyArray<EntitySearchSemanticRecallHit>,
      EntitySearchIndexError
    >;
  }
>()("@skygest/EntitySemanticRecall") {
  static readonly noneLayer = Layer.succeed(
    EntitySemanticRecall,
    EntitySemanticRecall.of({
      recall: () => Effect.succeed([])
    })
  );

  static readonly cloudflareLayer = Layer.effect(
    EntitySemanticRecall,
    Effect.gen(function* () {
      const env = yield* CloudflareEnv;

      const recall = (input: EntitySearchSemanticRecallInput) =>
        env.ENERGY_INTEL_SEARCH === undefined
          ? Effect.fail(
              new EntitySearchIndexErrorClass({
                operation: "EntitySemanticRecall.recall",
                message: "missing ENERGY_INTEL_SEARCH binding"
              })
            )
          : Effect.tryPromise({
              try: () =>
                env.ENERGY_INTEL_SEARCH!.get("entity-search").search({
                  messages: [{ role: "user", content: input.text }],
                  ai_search_options: {
                    retrieval: {
                      retrieval_type: "hybrid",
                      max_num_results: input.limit ?? 20,
                      context_expansion: 0
                    }
                  }
                }),
              catch: (cause) =>
                new EntitySearchIndexErrorClass({
                  operation: "EntitySemanticRecall.recall",
                  message: stringifyUnknown(cause)
                })
            }).pipe(
              Effect.map((response) =>
                response.chunks.flatMap((chunk) =>
                  toRecallHit(chunk, input.entityTypes)
                )
              )
            );

      return EntitySemanticRecall.of({ recall });
    })
  );
}

const decodeEntityId = decodeUnknownEitherWith(EntitySearchEntityId);
const decodeEntityType = decodeUnknownEitherWith(EntitySearchEntityTypeSchema);
const decodeRecallHit = Schema.decodeUnknownResult(
  EntitySearchSemanticRecallHitSchema
);

const firstStringMetadata = (
  metadata: Record<string, unknown> | undefined,
  keys: ReadonlyArray<string>
): string | undefined => {
  if (metadata === undefined) {
    return undefined;
  }

  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return undefined;
};

const toRecallHit = (
  chunk: AiSearchSearchResponse["chunks"][number],
  entityTypes: ReadonlyArray<EntitySearchEntityType> | undefined
): ReadonlyArray<EntitySearchSemanticRecallHit> => {
  const metadata = chunk.item.metadata;
  const entityId = firstStringMetadata(metadata, ["iri", "entity_id", "entityId"]);
  const entityType = firstStringMetadata(metadata, [
    "entity_type",
    "entityType"
  ]);

  if (entityId === undefined || entityType === undefined) {
    return [];
  }

  const decodedEntityId = decodeEntityId(entityId);
  const decodedEntityType = decodeEntityType(entityType);

  if (Result.isFailure(decodedEntityId) || Result.isFailure(decodedEntityType)) {
    return [];
  }

  if (
    entityTypes !== undefined &&
    !entityTypes.includes(decodedEntityType.success)
  ) {
    return [];
  }

  const hit = decodeRecallHit({
    entityId: decodedEntityId.success,
    entityType: decodedEntityType.success,
    score: chunk.score
  });

  return Result.isSuccess(hit) ? [hit.success] : [];
};
