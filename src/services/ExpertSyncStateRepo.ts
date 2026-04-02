import { ServiceMap, Effect } from "effect";
import type { SqlError } from "effect/unstable/sql";
import type { DbError } from "../domain/errors";
import type { Did } from "../domain/types";
import type { ExpertSyncStateRecord } from "../domain/polling";

export class ExpertSyncStateRepo extends ServiceMap.Service<
  ExpertSyncStateRepo,
  {
    readonly getByDid: (
      did: Did
    ) => Effect.Effect<ExpertSyncStateRecord | null, SqlError | DbError>;
    readonly upsert: (
      state: ExpertSyncStateRecord
    ) => Effect.Effect<void, SqlError | DbError>;
  }
>()("@skygest/ExpertSyncStateRepo") {}
