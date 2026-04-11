import { Effect, ServiceMap } from "effect";
import { SqlError } from "effect/unstable/sql/SqlError";
import type { Series } from "../domain/data-layer";
import type { DbError } from "../domain/errors";
import type { DataLayerWriteOptions } from "./DataLayerWriteOptions";

export class SeriesRepo extends ServiceMap.Service<
  SeriesRepo,
  {
    readonly listAll: () => Effect.Effect<ReadonlyArray<Series>, SqlError | DbError>;
    readonly findByUri: (uri: string) => Effect.Effect<Series | null, SqlError | DbError>;
    readonly insert: (
      series: Series,
      options: DataLayerWriteOptions
    ) => Effect.Effect<void, SqlError | DbError>;
    readonly update: (
      series: Series,
      options: DataLayerWriteOptions
    ) => Effect.Effect<void, SqlError | DbError>;
    readonly delete: (
      uri: string,
      deletedAt: string,
      updatedBy: string
    ) => Effect.Effect<void, SqlError | DbError>;
  }
>()("@skygest/SeriesRepo") {}
