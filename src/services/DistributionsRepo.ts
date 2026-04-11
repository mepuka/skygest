import { Effect, ServiceMap } from "effect";
import { SqlError } from "effect/unstable/sql/SqlError";
import type { Distribution } from "../domain/data-layer";
import type { DbError } from "../domain/errors";
import type { DataLayerWriteOptions } from "./DataLayerWriteOptions";

export class DistributionsRepo extends ServiceMap.Service<
  DistributionsRepo,
  {
    readonly listAll: () => Effect.Effect<
      ReadonlyArray<Distribution>,
      SqlError | DbError
    >;
    readonly findByUri: (
      uri: string
    ) => Effect.Effect<Distribution | null, SqlError | DbError>;
    readonly insert: (
      distribution: Distribution,
      options: DataLayerWriteOptions
    ) => Effect.Effect<void, SqlError | DbError>;
    readonly update: (
      distribution: Distribution,
      options: DataLayerWriteOptions
    ) => Effect.Effect<void, SqlError | DbError>;
    readonly delete: (
      uri: string,
      deletedAt: string,
      updatedBy: string
    ) => Effect.Effect<void, SqlError | DbError>;
    readonly findByHostname: (
      hostname: string
    ) => Effect.Effect<ReadonlyArray<Distribution>, SqlError | DbError>;
  }
>()("@skygest/DistributionsRepo") {}
