import { Effect, ServiceMap } from "effect";
import { SqlError } from "effect/unstable/sql/SqlError";
import type { AliasScheme, Variable } from "../domain/data-layer";
import type { DbError } from "../domain/errors";
import type { DataLayerWriteOptions } from "./DataLayerWriteOptions";

export class VariablesRepo extends ServiceMap.Service<
  VariablesRepo,
  {
    readonly listAll: () => Effect.Effect<
      ReadonlyArray<Variable>,
      SqlError | DbError
    >;
    readonly findByUri: (
      uri: string
    ) => Effect.Effect<Variable | null, SqlError | DbError>;
    readonly insert: (
      variable: Variable,
      options: DataLayerWriteOptions
    ) => Effect.Effect<void, SqlError | DbError>;
    readonly update: (
      variable: Variable,
      options: DataLayerWriteOptions
    ) => Effect.Effect<void, SqlError | DbError>;
    readonly delete: (
      uri: string,
      deletedAt: string,
      updatedBy: string
    ) => Effect.Effect<void, SqlError | DbError>;
    readonly findByAlias: (
      scheme: AliasScheme,
      value: string
    ) => Effect.Effect<Variable | null, SqlError | DbError>;
  }
>()("@skygest/VariablesRepo") {}
