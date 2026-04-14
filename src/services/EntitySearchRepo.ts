import { Effect, ServiceMap } from "effect";
import { SqlError } from "effect/unstable/sql/SqlError";
import type { DbError } from "../domain/errors";
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
    readonly searchLexical: (
      input: EntitySearchQueryInput
    ) => Effect.Effect<ReadonlyArray<EntitySearchHit>, SqlError | DbError>;
    readonly rebuildFts: () => Effect.Effect<void, SqlError | DbError>;
    readonly optimizeFts: () => Effect.Effect<void, SqlError | DbError>;
  }
>()("@skygest/EntitySearchRepo") {}
