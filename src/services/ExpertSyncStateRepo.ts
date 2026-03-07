import { Context, Effect } from "effect";
import type { SqlError } from "@effect/sql/SqlError";
import type { Did } from "../domain/types";
import type { ExpertSyncStateRecord } from "../domain/polling";

export class ExpertSyncStateRepo extends Context.Tag("@skygest/ExpertSyncStateRepo")<
  ExpertSyncStateRepo,
  {
    readonly getByDid: (
      did: Did
    ) => Effect.Effect<ExpertSyncStateRecord | null, SqlError>;
    readonly upsert: (
      state: ExpertSyncStateRecord
    ) => Effect.Effect<void, SqlError>;
  }
>() {}
