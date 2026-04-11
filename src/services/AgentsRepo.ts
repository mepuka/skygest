import { Effect, ServiceMap } from "effect";
import { SqlError } from "effect/unstable/sql/SqlError";
import type { Agent } from "../domain/data-layer";
import type { DbError } from "../domain/errors";
import type { DataLayerWriteOptions } from "./DataLayerWriteOptions";

export class AgentsRepo extends ServiceMap.Service<
  AgentsRepo,
  {
    readonly listAll: () => Effect.Effect<ReadonlyArray<Agent>, SqlError | DbError>;
    readonly findByUri: (uri: string) => Effect.Effect<Agent | null, SqlError | DbError>;
    readonly insert: (
      agent: Agent,
      options: DataLayerWriteOptions
    ) => Effect.Effect<void, SqlError | DbError>;
    readonly update: (
      agent: Agent,
      options: DataLayerWriteOptions
    ) => Effect.Effect<void, SqlError | DbError>;
    readonly delete: (
      uri: string,
      deletedAt: string,
      updatedBy: string
    ) => Effect.Effect<void, SqlError | DbError>;
    readonly findByLabel: (
      label: string
    ) => Effect.Effect<Agent | null, SqlError | DbError>;
    readonly findByHomepageDomain: (
      domain: string
    ) => Effect.Effect<Agent | null, SqlError | DbError>;
  }
>()("@skygest/AgentsRepo") {}
