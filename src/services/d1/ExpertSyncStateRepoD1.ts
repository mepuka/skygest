import { Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { ExpertSyncStateRepo } from "../ExpertSyncStateRepo";
import {
  ExpertSyncStateRecord as ExpertSyncStateRecordSchema,
  type ExpertSyncStateRecord
} from "../../domain/polling";
import {
  decodeStoredIngestError,
  encodeStoredIngestError
} from "../../domain/errors";
import { decodeWithDbError } from "./schemaDecode";

const RawExpertSyncStateRowSchema = Schema.Struct({
  did: Schema.String,
  pdsUrl: Schema.NullOr(Schema.String),
  pdsVerifiedAt: Schema.NullOr(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))),
  headUri: Schema.NullOr(Schema.String),
  headRkey: Schema.NullOr(Schema.String),
  headCreatedAt: Schema.NullOr(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))),
  lastPolledAt: Schema.NullOr(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))),
  lastCompletedAt: Schema.NullOr(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))),
  backfillCursor: Schema.NullOr(Schema.String),
  backfillStatus: Schema.String,
  lastError: Schema.NullOr(Schema.String)
});
const RawExpertSyncStateRowsSchema = Schema.Array(RawExpertSyncStateRowSchema);

export const ExpertSyncStateRepoD1 = {
  layer: Layer.effect(ExpertSyncStateRepo, Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const getByDid = (did: string) =>
      sql<any>`
        SELECT
          did as did,
          pds_url as pdsUrl,
          pds_verified_at as pdsVerifiedAt,
          head_uri as headUri,
          head_rkey as headRkey,
          head_created_at as headCreatedAt,
          last_polled_at as lastPolledAt,
          last_completed_at as lastCompletedAt,
          backfill_cursor as backfillCursor,
          backfill_status as backfillStatus,
          last_error as lastError
        FROM expert_sync_state
        WHERE did = ${did}
        LIMIT 1
      `.pipe(
        Effect.flatMap((rows) =>
          decodeWithDbError(
            RawExpertSyncStateRowsSchema,
            rows,
            `Failed to decode expert sync state row for ${did}`
          )
        ),
        Effect.map((rows) =>
          rows.map((row) => ({
            ...row,
            lastError: decodeStoredIngestError(row.lastError)
          }))
        ),
        Effect.flatMap((rows) =>
          decodeWithDbError(
            Schema.Array(ExpertSyncStateRecordSchema),
            rows,
            `Failed to normalize expert sync state row for ${did}`
          )
        ),
        Effect.map((rows) => rows[0] ?? null)
      );

    const upsert = (state: ExpertSyncStateRecord) =>
      decodeWithDbError(
        ExpertSyncStateRecordSchema,
        state,
        "Invalid expert sync state upsert input"
      ).pipe(
        Effect.flatMap((validated) =>
          sql`
            INSERT INTO expert_sync_state (
              did,
              pds_url,
              pds_verified_at,
              head_uri,
              head_rkey,
              head_created_at,
              last_polled_at,
              last_completed_at,
              backfill_cursor,
              backfill_status,
              last_error
            ) VALUES (
              ${validated.did},
              ${validated.pdsUrl},
              ${validated.pdsVerifiedAt},
              ${validated.headUri},
              ${validated.headRkey},
              ${validated.headCreatedAt},
              ${validated.lastPolledAt},
              ${validated.lastCompletedAt},
              ${validated.backfillCursor},
              ${validated.backfillStatus},
              ${encodeStoredIngestError(validated.lastError)}
            )
            ON CONFLICT(did) DO UPDATE SET
              pds_url = excluded.pds_url,
              pds_verified_at = excluded.pds_verified_at,
              head_uri = excluded.head_uri,
              head_rkey = excluded.head_rkey,
              head_created_at = excluded.head_created_at,
              last_polled_at = excluded.last_polled_at,
              last_completed_at = excluded.last_completed_at,
              backfill_cursor = excluded.backfill_cursor,
              backfill_status = excluded.backfill_status,
              last_error = excluded.last_error
          `.pipe(Effect.asVoid)
        )
      );

    return {
      getByDid,
      upsert
    };
  }))
};
