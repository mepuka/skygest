import { Effect, ServiceMap } from "effect";
import { SqlError } from "effect/unstable/sql/SqlError";
import type { AliasScheme, Dataset } from "../domain/data-layer";
import type { DbError } from "../domain/errors";
import type { DataLayerWriteOptions } from "./DataLayerWriteOptions";

export class DatasetsRepo extends ServiceMap.Service<
  DatasetsRepo,
  {
    readonly listAll: () => Effect.Effect<ReadonlyArray<Dataset>, SqlError | DbError>;
    readonly findByUri: (uri: string) => Effect.Effect<Dataset | null, SqlError | DbError>;
    readonly insert: (
      dataset: Dataset,
      options: DataLayerWriteOptions
    ) => Effect.Effect<void, SqlError | DbError>;
    readonly update: (
      dataset: Dataset,
      options: DataLayerWriteOptions
    ) => Effect.Effect<void, SqlError | DbError>;
    readonly delete: (
      uri: string,
      deletedAt: string,
      updatedBy: string
    ) => Effect.Effect<void, SqlError | DbError>;
    readonly findByTitle: (
      title: string
    ) => Effect.Effect<Dataset | null, SqlError | DbError>;
    readonly findByAlias: (
      scheme: AliasScheme,
      value: string
    ) => Effect.Effect<Dataset | null, SqlError | DbError>;
  }
>()("@skygest/DatasetsRepo") {}
