import { Effect, Layer } from "effect";
import { SqlClient } from "@effect/sql";
import { ExpertsRepo } from "../ExpertsRepo";
import type { ExpertListItem, ExpertRecord } from "../../domain/bi";

type ExpertListRow = Omit<ExpertListItem, "active"> & { readonly active: number };
type ExpertRecordRow = Omit<ExpertRecord, "active"> & { readonly active: number };
const isDefined = <A>(value: A | null): value is A => value !== null;
const toExpertRecord = (row: ExpertRecordRow): ExpertRecord => ({
  ...row,
  active: row.active === 1
});

export const ExpertsRepoD1 = {
  layer: Layer.effect(ExpertsRepo, Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const upsertOne = (expert: ExpertRecord) =>
      sql`
        INSERT INTO experts (
          did, handle, display_name, description, domain,
          source, source_ref, shard, active, added_at, last_synced_at
        ) VALUES (
          ${expert.did},
          ${expert.handle},
          ${expert.displayName},
          ${expert.description},
          ${expert.domain},
          ${expert.source},
          ${expert.sourceRef},
          ${expert.shard},
          ${expert.active ? 1 : 0},
          ${expert.addedAt},
          ${expert.lastSyncedAt}
        )
        ON CONFLICT(did) DO UPDATE SET
          handle = excluded.handle,
          display_name = excluded.display_name,
          description = excluded.description,
          domain = excluded.domain,
          source = excluded.source,
          source_ref = excluded.source_ref,
          shard = excluded.shard,
          active = excluded.active,
          last_synced_at = excluded.last_synced_at
      `.pipe(Effect.asVoid);

    const upsert = (expert: ExpertRecord) => upsertOne(expert);

    const upsertMany = (experts: ReadonlyArray<ExpertRecord>) =>
      Effect.forEach(experts, upsertOne, { discard: true });

    const getByDid = (did: string) =>
      sql<ExpertRecordRow>`
        SELECT
          did as did,
          handle as handle,
          display_name as displayName,
          description as description,
          domain as domain,
          source as source,
          source_ref as sourceRef,
          shard as shard,
          active as active,
          added_at as addedAt,
          last_synced_at as lastSyncedAt
        FROM experts
        WHERE did = ${did}
        LIMIT 1
      `.pipe(
        Effect.map((rows) => {
          const row = rows[0];
          return row ? toExpertRecord(row) : null;
        })
      );

    const setActive = (did: string, active: boolean) =>
      sql`
        UPDATE experts
        SET active = ${active ? 1 : 0}
        WHERE did = ${did}
      `.pipe(Effect.asVoid);

    const setLastSyncedAt = (did: string, lastSyncedAt: number | null) =>
      sql`
        UPDATE experts
        SET last_synced_at = ${lastSyncedAt}
        WHERE did = ${did}
      `.pipe(Effect.asVoid);

    const listActive = (did?: string | null) =>
      sql<ExpertRecordRow>`
        SELECT
          did as did,
          handle as handle,
          display_name as displayName,
          description as description,
          domain as domain,
          source as source,
          source_ref as sourceRef,
          shard as shard,
          active as active,
          added_at as addedAt,
          last_synced_at as lastSyncedAt
        FROM experts
        WHERE ${
          did == null
            ? sql`active = 1`
            : sql`did = ${did}`
        }
        ORDER BY added_at ASC, did ASC
      `.pipe(
        Effect.map((rows) => rows.map(toExpertRecord))
      );

    const listActiveByShard = (shard: number) =>
      sql<{ did: string }>`
        SELECT did as did
        FROM experts
        WHERE active = 1 AND shard = ${shard}
        ORDER BY added_at ASC, did ASC
      `.pipe(Effect.map((rows) => rows.map((row) => row.did)));

    const list = (domain: string | null, active: boolean | null, limit: number) => {
      const conditions = [
        domain === null ? null : sql`domain = ${domain}`,
        active === null ? null : sql`active = ${active ? 1 : 0}`
      ].filter(isDefined);

      const whereClause = conditions.length === 0
        ? sql`1 = 1`
        : sql.join(" AND ", false)(conditions);

      return sql<ExpertListRow>`
        SELECT
          did as did,
          handle as handle,
          display_name as displayName,
          domain as domain,
          source as source,
          active as active
        FROM experts
        WHERE ${whereClause}
        ORDER BY added_at DESC, did ASC
        LIMIT ${limit}
      `.pipe(
        Effect.map((rows) =>
          rows.map((row) => ({
            ...row,
            active: row.active === 1
          }))
        )
      );
    };

    return ExpertsRepo.of({
      upsert,
      upsertMany,
      getByDid,
      setActive,
      setLastSyncedAt,
      listActive,
      listActiveByShard,
      list
    });
  }))
};
