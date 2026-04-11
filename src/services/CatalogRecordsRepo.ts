import { Effect, ServiceMap } from "effect";
import { SqlError } from "effect/unstable/sql/SqlError";
import type { CatalogRecord } from "../domain/data-layer";
import type { DbError } from "../domain/errors";
import type { DataLayerWriteOptions } from "./DataLayerWriteOptions";

export class CatalogRecordsRepo extends ServiceMap.Service<
  CatalogRecordsRepo,
  {
    readonly listAll: () => Effect.Effect<
      ReadonlyArray<CatalogRecord>,
      SqlError | DbError
    >;
    readonly findByUri: (
      uri: string
    ) => Effect.Effect<CatalogRecord | null, SqlError | DbError>;
    readonly insert: (
      record: CatalogRecord,
      options: DataLayerWriteOptions
    ) => Effect.Effect<void, SqlError | DbError>;
    readonly update: (
      record: CatalogRecord,
      options: DataLayerWriteOptions
    ) => Effect.Effect<void, SqlError | DbError>;
    readonly delete: (
      uri: string,
      deletedAt: string,
      updatedBy: string
    ) => Effect.Effect<void, SqlError | DbError>;
  }
>()("@skygest/CatalogRecordsRepo") {}
