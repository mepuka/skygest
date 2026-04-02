import { ServiceMap, Effect } from "effect";
import type { SqlError } from "effect/unstable/sql";
import type { DbError } from "../domain/errors";
import type { ExpertListItem, ExpertRecord } from "../domain/bi";

export class ExpertsRepo extends ServiceMap.Service<
  ExpertsRepo,
  {
    readonly upsert: (expert: ExpertRecord) => Effect.Effect<void, SqlError | DbError>;
    readonly upsertMany: (experts: ReadonlyArray<ExpertRecord>) => Effect.Effect<void, SqlError | DbError>;
    readonly getByDid: (did: string) => Effect.Effect<ExpertRecord | null, SqlError | DbError>;
    readonly setActive: (did: string, active: boolean) => Effect.Effect<void, SqlError | DbError>;
    readonly setLastSyncedAt: (
      did: string,
      lastSyncedAt: number | null
    ) => Effect.Effect<void, SqlError | DbError>;
    readonly listActive: (
      did?: string | null
    ) => Effect.Effect<ReadonlyArray<ExpertRecord>, SqlError | DbError>;
    readonly listActiveByShard: (shard: number) => Effect.Effect<ReadonlyArray<string>, SqlError | DbError>;
    readonly list: (
      domain: string | null,
      active: boolean | null,
      limit: number
    ) => Effect.Effect<ReadonlyArray<ExpertListItem>, SqlError | DbError>;

    readonly getByDids: (
      dids: ReadonlyArray<string>
    ) => Effect.Effect<ReadonlyArray<ExpertRecord>, SqlError | DbError>;
  }
>()("@skygest/ExpertsRepo") {}
