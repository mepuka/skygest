import { Context, Effect } from "effect";
import type { SqlError } from "@effect/sql/SqlError";
import type { ExpertListItem, ExpertRecord } from "../domain/bi";

export class ExpertsRepo extends Context.Tag("@skygest/ExpertsRepo")<
  ExpertsRepo,
  {
    readonly upsert: (expert: ExpertRecord) => Effect.Effect<void, SqlError>;
    readonly upsertMany: (experts: ReadonlyArray<ExpertRecord>) => Effect.Effect<void, SqlError>;
    readonly getByDid: (did: string) => Effect.Effect<ExpertRecord | null, SqlError>;
    readonly setActive: (did: string, active: boolean) => Effect.Effect<void, SqlError>;
    readonly setLastSyncedAt: (
      did: string,
      lastSyncedAt: number | null
    ) => Effect.Effect<void, SqlError>;
    readonly listActive: (
      did?: string | null
    ) => Effect.Effect<ReadonlyArray<ExpertRecord>, SqlError>;
    readonly listActiveByShard: (shard: number) => Effect.Effect<ReadonlyArray<string>, SqlError>;
    readonly list: (
      domain: string | null,
      active: boolean | null,
      limit: number
    ) => Effect.Effect<ReadonlyArray<ExpertListItem>, SqlError>;
  }
>() {}
