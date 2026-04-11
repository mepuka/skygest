import { Effect, ServiceMap } from "effect";
import { SqlError } from "effect/unstable/sql/SqlError";
import type { Catalog } from "../domain/data-layer";
import type { DbError } from "../domain/errors";
import type { DataLayerWriteOptions } from "./DataLayerWriteOptions";

export class CatalogsRepo extends ServiceMap.Service<
  CatalogsRepo,
  {
    readonly listAll: () => Effect.Effect<ReadonlyArray<Catalog>, SqlError | DbError>;
    readonly findByUri: (uri: string) => Effect.Effect<Catalog | null, SqlError | DbError>;
    readonly insert: (
      catalog: Catalog,
      options: DataLayerWriteOptions
    ) => Effect.Effect<void, SqlError | DbError>;
    readonly update: (
      catalog: Catalog,
      options: DataLayerWriteOptions
    ) => Effect.Effect<void, SqlError | DbError>;
    readonly delete: (
      uri: string,
      deletedAt: string,
      updatedBy: string
    ) => Effect.Effect<void, SqlError | DbError>;
  }
>()("@skygest/CatalogsRepo") {}
