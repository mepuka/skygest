import { Effect, Layer, Schema } from "effect";
import { SqlClient } from "@effect/sql";
import { ExpertsRepo } from "../ExpertsRepo";
import {
  ExpertListItem as ExpertListItemSchema,
  ExpertRecord as ExpertRecordSchema,
  type ExpertListItem,
  type ExpertRecord,
  type ExpertTier
} from "../../domain/bi";
import { decodeWithDbError } from "./schemaDecode";

const ActiveFlag = Schema.Union(Schema.Literal(0), Schema.Literal(1));
const ExpertListRowSchema = Schema.Struct({
  did: Schema.String,
  handle: Schema.NullOr(Schema.String),
  displayName: Schema.NullOr(Schema.String),
  avatar: Schema.NullOr(Schema.String),
  domain: Schema.String,
  source: Schema.String,
  active: ActiveFlag,
  tier: Schema.optionalWith(Schema.NullOr(Schema.String), { default: () => null })
});
const ExpertRecordRowSchema = Schema.Struct({
  did: Schema.String,
  handle: Schema.NullOr(Schema.String),
  displayName: Schema.NullOr(Schema.String),
  description: Schema.NullOr(Schema.String),
  avatar: Schema.NullOr(Schema.String),
  domain: Schema.String,
  source: Schema.String,
  sourceRef: Schema.NullOr(Schema.String),
  shard: Schema.Number,
  active: ActiveFlag,
  tier: Schema.optionalWith(Schema.NullOr(Schema.String), { default: () => null }),
  addedAt: Schema.Number,
  lastSyncedAt: Schema.NullOr(Schema.Number)
});
const ExpertDidRowSchema = Schema.Struct({
  did: Schema.String
});
const ExpertListRowsSchema = Schema.Array(ExpertListRowSchema);
const ExpertRecordRowsSchema = Schema.Array(ExpertRecordRowSchema);
const ExpertDidRowsSchema = Schema.Array(ExpertDidRowSchema);
const isDefined = <A>(value: A | null): value is A => value !== null;
type ExpertRecordRow = Schema.Schema.Type<typeof ExpertRecordRowSchema>;
type ExpertListRow = Schema.Schema.Type<typeof ExpertListRowSchema>;

const toExpertRecord = (row: ExpertRecordRow) => ({
  ...row,
  active: row.active === 1,
  tier: (row.tier ?? "independent") as ExpertTier
});
const toExpertListItem = (row: ExpertListRow) => ({
  ...row,
  active: row.active === 1,
  tier: (row.tier ?? "independent") as ExpertTier
});

export const ExpertsRepoD1 = {
  layer: Layer.effect(ExpertsRepo, Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const upsertOne = (expert: ExpertRecord) =>
      decodeWithDbError(
        ExpertRecordSchema,
        expert,
        "Invalid expert upsert input"
      ).pipe(
        Effect.flatMap((validated) =>
          sql`
            INSERT INTO experts (
              did, handle, display_name, description, avatar, domain,
              source, source_ref, shard, active, tier, added_at, last_synced_at
            ) VALUES (
              ${validated.did},
              ${validated.handle},
              ${validated.displayName},
              ${validated.description},
              ${validated.avatar},
              ${validated.domain},
              ${validated.source},
              ${validated.sourceRef},
              ${validated.shard},
              ${validated.active ? 1 : 0},
              ${validated.tier},
              ${validated.addedAt},
              ${validated.lastSyncedAt}
            )
            ON CONFLICT(did) DO UPDATE SET
              handle = excluded.handle,
              display_name = excluded.display_name,
              description = excluded.description,
              avatar = excluded.avatar,
              domain = excluded.domain,
              source = excluded.source,
              source_ref = excluded.source_ref,
              shard = excluded.shard,
              active = excluded.active,
              tier = excluded.tier,
              last_synced_at = excluded.last_synced_at
          `.pipe(Effect.asVoid)
        )
      );

    const upsert = (expert: ExpertRecord) => upsertOne(expert);

    const upsertMany = (experts: ReadonlyArray<ExpertRecord>) =>
      Effect.forEach(experts, upsertOne, { discard: true });

    const getByDid = (did: string) =>
      sql<any>`
        SELECT
          did as did,
          handle as handle,
          display_name as displayName,
          description as description,
          avatar as avatar,
          domain as domain,
          source as source,
          source_ref as sourceRef,
          shard as shard,
          active as active,
          COALESCE(tier, 'independent') as tier,
          added_at as addedAt,
          last_synced_at as lastSyncedAt
        FROM experts
        WHERE did = ${did}
        LIMIT 1
      `.pipe(
        Effect.flatMap((rows) =>
          decodeWithDbError(
            ExpertRecordRowsSchema,
            rows,
            `Failed to decode expert row for ${did}`
          )
        ),
        Effect.map((rows) => rows.map(toExpertRecord)),
        Effect.flatMap((rows) =>
          decodeWithDbError(
            Schema.Array(ExpertRecordSchema),
            rows,
            `Failed to normalize expert row for ${did}`
          )
        ),
        Effect.map((rows) => {
          const row = rows[0];
          return row ?? null;
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
      sql<any>`
        SELECT
          did as did,
          handle as handle,
          display_name as displayName,
          description as description,
          avatar as avatar,
          domain as domain,
          source as source,
          source_ref as sourceRef,
          shard as shard,
          active as active,
          COALESCE(tier, 'independent') as tier,
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
        Effect.flatMap((rows) =>
          decodeWithDbError(
            ExpertRecordRowsSchema,
            rows,
            did == null
              ? "Failed to decode active experts"
              : `Failed to decode active expert row for ${did}`
          )
        ),
        Effect.map((rows) => rows.map(toExpertRecord)),
        Effect.flatMap((rows) =>
          decodeWithDbError(
            Schema.Array(ExpertRecordSchema),
            rows,
            did == null
              ? "Failed to normalize active experts"
              : `Failed to normalize active expert row for ${did}`
          )
        )
      );

    const listActiveByShard = (shard: number) =>
      sql<any>`
        SELECT did as did
        FROM experts
        WHERE active = 1 AND shard = ${shard}
        ORDER BY added_at ASC, did ASC
      `.pipe(
        Effect.flatMap((rows) =>
          decodeWithDbError(
            ExpertDidRowsSchema,
            rows,
            `Failed to decode active expert dids for shard ${shard}`
          )
        ),
        Effect.map((rows) => rows.map((row) => row.did))
      );

    const list = (domain: string | null, active: boolean | null, limit: number) => {
      const conditions = [
        domain === null ? null : sql`domain = ${domain}`,
        active === null ? null : sql`active = ${active ? 1 : 0}`
      ].filter(isDefined);

      const whereClause = conditions.length === 0
        ? sql`1 = 1`
        : sql.join(" AND ", false)(conditions);

      return sql<any>`
        SELECT
          did as did,
          handle as handle,
          display_name as displayName,
          avatar as avatar,
          domain as domain,
          source as source,
          active as active,
          COALESCE(tier, 'independent') as tier
        FROM experts
        WHERE ${whereClause}
        ORDER BY added_at DESC, did ASC
        LIMIT ${limit}
      `.pipe(
        Effect.flatMap((rows) =>
          decodeWithDbError(
            ExpertListRowsSchema,
            rows,
            "Failed to decode expert list rows"
          )
        ),
        Effect.map((rows) => rows.map(toExpertListItem)),
        Effect.flatMap((rows) =>
          decodeWithDbError(
            Schema.Array(ExpertListItemSchema),
            rows,
            "Failed to normalize expert list rows"
          )
        )
      );
    };

    const getByDids = (dids: ReadonlyArray<string>) => {
      if (dids.length === 0) return Effect.succeed([] as ReadonlyArray<ExpertRecord>);

      // Chunk into groups of 50 to avoid SQLite variable limits
      const chunks: string[][] = [];
      for (let i = 0; i < dids.length; i += 50) {
        chunks.push(dids.slice(i, i + 50) as string[]);
      }

      return Effect.forEach(chunks, (chunk) => {
        const placeholders = chunk.map((did) => sql`${did}`);
        return sql<any>`
          SELECT
            did as did,
            handle as handle,
            display_name as displayName,
            description as description,
            avatar as avatar,
            domain as domain,
            source as source,
            source_ref as sourceRef,
            shard as shard,
            active as active,
            COALESCE(tier, 'independent') as tier,
            added_at as addedAt,
            last_synced_at as lastSyncedAt
          FROM experts
          WHERE did IN (${sql.join(", ", false)(placeholders)})
        `.pipe(
          Effect.flatMap((rows) =>
            decodeWithDbError(
              ExpertRecordRowsSchema,
              rows,
              "Failed to decode expert rows for batch lookup"
            )
          ),
          Effect.map((rows) => rows.map(toExpertRecord)),
          Effect.flatMap((rows) =>
            decodeWithDbError(
              Schema.Array(ExpertRecordSchema),
              rows,
              "Failed to normalize expert rows for batch lookup"
            )
          )
        );
      }).pipe(
        Effect.map((chunks) => chunks.flat())
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
      list,
      getByDids
    });
  }))
};
