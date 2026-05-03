import { Effect, Layer, ServiceMap } from "effect";
import { SqlError } from "effect/unstable/sql/SqlError";
import { DbError } from "../domain/errors";
import type {
  EntitySearchDocument,
  EntitySearchEntityId,
  EntitySearchHit,
  EntitySearchQueryInput
} from "../domain/entitySearch";

export class EntitySearchRepo extends ServiceMap.Service<
  EntitySearchRepo,
  {
    readonly replaceAllDocuments: (
      documents: ReadonlyArray<EntitySearchDocument>
    ) => Effect.Effect<void, SqlError | DbError>;
    readonly upsertDocuments: (
      documents: ReadonlyArray<EntitySearchDocument>
    ) => Effect.Effect<void, SqlError | DbError>;
    readonly deleteDocuments: (
      entityIds: ReadonlyArray<EntitySearchEntityId>
    ) => Effect.Effect<void, SqlError | DbError>;
    readonly getByEntityId: (
      entityId: EntitySearchEntityId
    ) => Effect.Effect<EntitySearchDocument | null, SqlError | DbError>;
    readonly getManyByEntityId: (
      entityIds: ReadonlyArray<EntitySearchEntityId>
    ) => Effect.Effect<ReadonlyArray<EntitySearchDocument>, SqlError | DbError>;
    readonly searchLexical: (
      input: EntitySearchQueryInput
    ) => Effect.Effect<ReadonlyArray<EntitySearchHit>, SqlError | DbError>;
    readonly rebuildFts: () => Effect.Effect<void, SqlError | DbError>;
    readonly optimizeFts: () => Effect.Effect<void, SqlError | DbError>;
  }
>()("@skygest/EntitySearchRepo") {}

export const emptyEntitySearchRepoLayer = Layer.succeed(
  EntitySearchRepo,
  EntitySearchRepo.of({
    replaceAllDocuments: () => Effect.void,
    upsertDocuments: () => Effect.void,
    deleteDocuments: () => Effect.void,
    getByEntityId: () => Effect.succeed(null),
    getManyByEntityId: () => Effect.succeed([]),
    searchLexical: () => Effect.succeed([]),
    rebuildFts: () => Effect.void,
    optimizeFts: () => Effect.void
  })
);

export const missingEntitySearchRepoLayer = Layer.succeed(
  EntitySearchRepo,
  EntitySearchRepo.of({
    replaceAllDocuments: () =>
      Effect.fail(new DbError({ message: "missing SEARCH_DB binding" })),
    upsertDocuments: () =>
      Effect.fail(new DbError({ message: "missing SEARCH_DB binding" })),
    deleteDocuments: () =>
      Effect.fail(new DbError({ message: "missing SEARCH_DB binding" })),
    getByEntityId: () =>
      Effect.fail(new DbError({ message: "missing SEARCH_DB binding" })),
    getManyByEntityId: () =>
      Effect.fail(new DbError({ message: "missing SEARCH_DB binding" })),
    searchLexical: () =>
      Effect.fail(new DbError({ message: "missing SEARCH_DB binding" })),
    rebuildFts: () =>
      Effect.fail(new DbError({ message: "missing SEARCH_DB binding" })),
    optimizeFts: () =>
      Effect.fail(new DbError({ message: "missing SEARCH_DB binding" }))
  })
);
