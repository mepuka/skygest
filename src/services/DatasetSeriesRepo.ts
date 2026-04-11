import { Effect, ServiceMap } from "effect";
import { SqlError } from "effect/unstable/sql/SqlError";
import type { DatasetSeries } from "../domain/data-layer";
import type { DbError } from "../domain/errors";
import type { DataLayerWriteOptions } from "./DataLayerWriteOptions";

export class DatasetSeriesRepo extends ServiceMap.Service<
  DatasetSeriesRepo,
  {
    readonly listAll: () => Effect.Effect<
      ReadonlyArray<DatasetSeries>,
      SqlError | DbError
    >;
    readonly findByUri: (
      uri: string
    ) => Effect.Effect<DatasetSeries | null, SqlError | DbError>;
    readonly insert: (
      series: DatasetSeries,
      options: DataLayerWriteOptions
    ) => Effect.Effect<void, SqlError | DbError>;
    readonly update: (
      series: DatasetSeries,
      options: DataLayerWriteOptions
    ) => Effect.Effect<void, SqlError | DbError>;
    readonly delete: (
      uri: string,
      deletedAt: string,
      updatedBy: string
    ) => Effect.Effect<void, SqlError | DbError>;
  }
>()("@skygest/DatasetSeriesRepo") {}
