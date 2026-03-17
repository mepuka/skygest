import { Effect, Layer, Schema } from "effect";
import { SqlClient } from "@effect/sql";
import {
  CandidatePayloadRecord as CandidatePayloadRecordSchema,
  SaveCandidateEnrichmentInput as SaveCandidateEnrichmentInputSchema,
  type CandidatePayloadRecord,
  type SaveCandidateEnrichmentInput
} from "../../domain/candidatePayload";
import { CandidatePayloadRepo } from "../CandidatePayloadRepo";
import {
  decodeJsonColumnWithDbError,
  encodeJsonColumnWithDbError
} from "./jsonColumns";
import { decodeWithDbError } from "./schemaDecode";

const CandidatePayloadRowSchema = Schema.Struct({
  postUri: Schema.String,
  captureStage: Schema.String,
  embedType: Schema.NullOr(Schema.String),
  embedPayloadJson: Schema.NullOr(Schema.String),
  enrichmentPayloadJson: Schema.NullOr(Schema.String),
  capturedAt: Schema.Number,
  updatedAt: Schema.Number,
  enrichedAt: Schema.NullOr(Schema.Number)
});
const CandidatePayloadRowsSchema = Schema.Array(CandidatePayloadRowSchema);
type CandidatePayloadRow = Schema.Schema.Type<typeof CandidatePayloadRowSchema>;

const toCandidatePayloadRecord = (row: CandidatePayloadRow) =>
  Effect.all({
    embedPayload: decodeJsonColumnWithDbError(
      row.embedPayloadJson,
      `embed payload for ${row.postUri}`
    ),
    enrichmentPayload: decodeJsonColumnWithDbError(
      row.enrichmentPayloadJson,
      `enrichment payload for ${row.postUri}`
    )
  }).pipe(
    Effect.map(({ embedPayload, enrichmentPayload }) => ({
      postUri: row.postUri,
      captureStage: row.captureStage,
      embedType: row.embedType,
      embedPayload,
      enrichmentPayload,
      capturedAt: row.capturedAt,
      updatedAt: row.updatedAt,
      enrichedAt: row.enrichedAt
    })),
    Effect.flatMap((record) =>
      decodeWithDbError(
        CandidatePayloadRecordSchema,
        record,
        `Failed to normalize stored payload for ${row.postUri}`
      )
    )
  );

export const CandidatePayloadRepoD1 = {
  layer: Layer.effect(CandidatePayloadRepo, Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const upsertCapture = (record: CandidatePayloadRecord) =>
      decodeWithDbError(
        CandidatePayloadRecordSchema,
        record,
        `Invalid candidate payload input for ${record.postUri}`
      ).pipe(
        Effect.flatMap((validated) =>
          Effect.all({
            embedPayloadJson: encodeJsonColumnWithDbError(
              validated.embedPayload,
              `embed payload for ${validated.postUri}`
            ),
            enrichmentPayloadJson: encodeJsonColumnWithDbError(
              validated.enrichmentPayload,
              `enrichment payload for ${validated.postUri}`
            )
          }).pipe(
            Effect.flatMap(({ embedPayloadJson, enrichmentPayloadJson }) =>
              sql<{ postUri: string }>`
                SELECT post_uri as postUri
                FROM post_payloads
                WHERE post_uri = ${validated.postUri}
              `.pipe(
                Effect.flatMap((existing) => {
                  const isNew = existing.length === 0;
                  return sql`
                    INSERT INTO post_payloads (
                      post_uri,
                      capture_stage,
                      embed_type,
                      embed_payload_json,
                      enrichment_payload_json,
                      captured_at,
                      updated_at,
                      enriched_at
                    ) VALUES (
                      ${validated.postUri},
                      ${validated.captureStage},
                      ${validated.embedType},
                      ${embedPayloadJson},
                      ${enrichmentPayloadJson},
                      ${validated.capturedAt},
                      ${validated.updatedAt},
                      ${validated.enrichedAt}
                    )
                    ON CONFLICT(post_uri) DO UPDATE SET
                      capture_stage = CASE
                        WHEN post_payloads.capture_stage = 'picked' THEN 'picked'
                        ELSE excluded.capture_stage
                      END,
                      embed_type = excluded.embed_type,
                      embed_payload_json = excluded.embed_payload_json,
                      updated_at = excluded.updated_at
                  `.pipe(
                    Effect.asVoid,
                    Effect.map(() => isNew)
                  );
                })
              )
            )
          )
        )
      );

    const getByPostUri = (postUri: string) =>
      sql<any>`
        SELECT
          post_uri as postUri,
          capture_stage as captureStage,
          embed_type as embedType,
          embed_payload_json as embedPayloadJson,
          enrichment_payload_json as enrichmentPayloadJson,
          captured_at as capturedAt,
          updated_at as updatedAt,
          enriched_at as enrichedAt
        FROM post_payloads
        WHERE post_uri = ${postUri}
        LIMIT 1
      `.pipe(
        Effect.flatMap((rows) =>
          decodeWithDbError(
            CandidatePayloadRowsSchema,
            rows,
            `Failed to decode stored payload row for ${postUri}`
          )
        ),
        Effect.flatMap((rows) => {
          const row = rows[0];
          return row === undefined
            ? Effect.succeed(null)
            : toCandidatePayloadRecord(row);
        })
      );

    const markPicked = (postUri: string, updatedAt: number) =>
      sql`
        UPDATE post_payloads
        SET capture_stage = ${"picked"},
            updated_at = ${updatedAt}
        WHERE post_uri = ${postUri}
      `.pipe(
        Effect.flatMap(() =>
          sql<{ cnt: number }>`SELECT changes() as cnt`.pipe(
            Effect.map((rows) => (rows[0]?.cnt ?? 0) > 0)
          )
        )
      );

    const saveEnrichment = (
      input: SaveCandidateEnrichmentInput,
      updatedAt: number,
      enrichedAt: number
    ) =>
      decodeWithDbError(
        SaveCandidateEnrichmentInputSchema,
        input,
        `Invalid candidate enrichment input for ${input.postUri}`
      ).pipe(
        Effect.flatMap((validated) =>
          encodeJsonColumnWithDbError(
            validated.enrichmentPayload,
            `enrichment payload for ${validated.postUri}`
          ).pipe(
            Effect.flatMap((enrichmentPayloadJson) =>
              sql`
                UPDATE post_payloads
                SET enrichment_payload_json = ${enrichmentPayloadJson},
                    enriched_at = ${enrichedAt},
                    updated_at = ${updatedAt}
                WHERE post_uri = ${validated.postUri}
              `.pipe(
                Effect.flatMap(() =>
                  sql<{ cnt: number }>`SELECT changes() as cnt`.pipe(
                    Effect.map((rows) => (rows[0]?.cnt ?? 0) > 0)
                  )
                )
              )
            )
          )
        )
      );

    return CandidatePayloadRepo.of({
      upsertCapture,
      getByPostUri,
      markPicked,
      saveEnrichment
    });
  }))
};
