import { Effect, ServiceMap } from "effect";
import { SqlError } from "effect/unstable/sql/SqlError";
import type { DataService } from "../domain/data-layer";
import type { DbError } from "../domain/errors";
import type { DataLayerWriteOptions } from "./DataLayerWriteOptions";

export class DataServicesRepo extends ServiceMap.Service<
  DataServicesRepo,
  {
    readonly listAll: () => Effect.Effect<
      ReadonlyArray<DataService>,
      SqlError | DbError
    >;
    readonly findByUri: (
      uri: string
    ) => Effect.Effect<DataService | null, SqlError | DbError>;
    readonly insert: (
      service: DataService,
      options: DataLayerWriteOptions
    ) => Effect.Effect<void, SqlError | DbError>;
    readonly update: (
      service: DataService,
      options: DataLayerWriteOptions
    ) => Effect.Effect<void, SqlError | DbError>;
    readonly delete: (
      uri: string,
      deletedAt: string,
      updatedBy: string
    ) => Effect.Effect<void, SqlError | DbError>;
  }
>()("@skygest/DataServicesRepo") {}
