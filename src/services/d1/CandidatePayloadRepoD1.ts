import { Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { SqlError } from "effect/unstable/sql/SqlError";
import type { DbError } from "../../domain/errors";
import {
  CandidatePayloadEnrichmentRecord as CandidatePayloadEnrichmentRecordSchema,
  CandidatePayloadNotPickedError,
  CandidatePayloadRecord as CandidatePayloadRecordSchema,
  CandidatePayloadStage as CandidatePayloadStageSchema,
  SaveCandidateEnrichmentInput as SaveCandidateEnrichmentInputSchema,
  type CandidatePayloadRecord,
  type SaveCandidateEnrichmentInput
} from "../../domain/candidatePayload";
import { isPickedCandidatePayloadStage } from "../../domain/CandidatePayloadPredicates";
import { DataRefResolutionEnrichment } from "../../domain/enrichment";
import { buildDataRefCandidateCitations } from "../../enrichment/DataRefCandidateCitations";
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
  capturedAt: Schema.Number,
  updatedAt: Schema.Number,
  enrichedAt: Schema.NullOr(Schema.Number)
});
const CandidatePayloadRowsSchema = Schema.Array(CandidatePayloadRowSchema);
type CandidatePayloadRow = Schema.Schema.Type<typeof CandidatePayloadRowSchema>;

const CandidatePayloadStageRowSchema = Schema.Struct({
  captureStage: CandidatePayloadStageSchema
});
const CandidatePayloadStageRowsSchema = Schema.Array(CandidatePayloadStageRowSchema);

const CandidatePayloadEnrichmentRowSchema = Schema.Struct({
  enrichmentType: Schema.String,
  enrichmentPayloadJson: Schema.String,
  updatedAt: Schema.Number,
  enrichedAt: Schema.Number
});
const CandidatePayloadEnrichmentRowsSchema = Schema.Array(CandidatePayloadEnrichmentRowSchema);

export const CandidatePayloadRepoD1 = {
  layer: Layer.effect(CandidatePayloadRepo, Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const getEnrichmentsByPostUri = (postUri: string) =>
      sql<any>`
        SELECT
          enrichment_type as enrichmentType,
          enrichment_payload_json as enrichmentPayloadJson,
          updated_at as updatedAt,
          enriched_at as enrichedAt
        FROM post_enrichments
        WHERE post_uri = ${postUri}
        ORDER BY enrichment_type ASC
      `.pipe(
        Effect.flatMap((rows) =>
          decodeWithDbError(
            CandidatePayloadEnrichmentRowsSchema,
            rows,
            `Failed to decode stored enrichment rows for ${postUri}`
          )
        ),
        Effect.flatMap((rows) =>
          Effect.forEach(rows, (row) =>
            decodeJsonColumnWithDbError(
              row.enrichmentPayloadJson,
              `enrichment payload for ${row.enrichmentType}`
            ).pipe(
              Effect.map((enrichmentPayload) => ({
                enrichmentType: row.enrichmentType,
                enrichmentPayload,
                updatedAt: row.updatedAt,
                enrichedAt: row.enrichedAt
              })),
              Effect.flatMap((enrichment) =>
                decodeWithDbError(
                  CandidatePayloadEnrichmentRecordSchema,
                  enrichment,
                  `Failed to normalize stored enrichment for ${row.enrichmentType}`
                )
              )
            )
          )
        )
      );

    const replaceDataRefCandidateCitations = (
      input: SaveCandidateEnrichmentInput,
      updatedAt: number
    ): Effect.Effect<void, DbError | SqlError> =>
      input.enrichmentType !== "data-ref-resolution"
        ? Effect.void
        : decodeWithDbError(
            DataRefResolutionEnrichment,
            input.enrichmentPayload,
            `Invalid data-ref-resolution payload for ${input.postUri}`
          ).pipe(
            Effect.flatMap((enrichment) => {
              const citations = buildDataRefCandidateCitations(enrichment);
              const citationKeys = citations.map((citation) => sql`${citation.citationKey}`);

              const deleteStaleCitations =
                citations.length === 0
                  ? sql`
                      DELETE FROM data_ref_candidate_citations
                      WHERE source_post_uri = ${input.postUri}
                    `.pipe(Effect.asVoid)
                  : sql`
                      DELETE FROM data_ref_candidate_citations
                      WHERE source_post_uri = ${input.postUri}
                        AND citation_key NOT IN (${sql.join(", ", false)(citationKeys)})
                    `.pipe(Effect.asVoid);

              return deleteStaleCitations.pipe(
                Effect.asVoid,
                Effect.flatMap(() =>
                  Effect.forEach(
                    citations,
                    (citation) =>
                      sql`
                        INSERT INTO data_ref_candidate_citations (
                          source_post_uri,
                          entity_id,
                          citation_source,
                          citation_key,
                          resolution_state,
                          asserted_value_json,
                          asserted_unit,
                          observation_start,
                          observation_end,
                          observation_label,
                          normalized_observation_start,
                          normalized_observation_end,
                          observation_sort_key,
                          has_observation_time,
                          updated_at
                        ) VALUES (
                          ${input.postUri},
                          ${citation.entityId},
                          ${citation.citationSource},
                          ${citation.citationKey},
                          ${citation.resolutionState},
                          ${citation.assertedValueJson},
                          ${citation.assertedUnit},
                          ${citation.observationStart},
                          ${citation.observationEnd},
                          ${citation.observationLabel},
                          ${citation.normalizedObservationStart},
                          ${citation.normalizedObservationEnd},
                          ${citation.observationSortKey},
                          ${citation.hasObservationTime ? 1 : 0},
                          ${updatedAt}
                        )
                        ON CONFLICT(source_post_uri, citation_key) DO UPDATE SET
                          entity_id = excluded.entity_id,
                          citation_source = excluded.citation_source,
                          resolution_state = excluded.resolution_state,
                          asserted_value_json = excluded.asserted_value_json,
                          asserted_unit = excluded.asserted_unit,
                          observation_start = excluded.observation_start,
                          observation_end = excluded.observation_end,
                          observation_label = excluded.observation_label,
                          normalized_observation_start = excluded.normalized_observation_start,
                          normalized_observation_end = excluded.normalized_observation_end,
                          observation_sort_key = excluded.observation_sort_key,
                          has_observation_time = excluded.has_observation_time,
                          updated_at = excluded.updated_at
                      `.pipe(Effect.asVoid),
                    { discard: true }
                  )
                )
              );
            })
          );

    const toCandidatePayloadRecord = (row: CandidatePayloadRow) =>
      Effect.all({
        embedPayload: decodeJsonColumnWithDbError(
          row.embedPayloadJson,
          `embed payload for ${row.postUri}`
        ),
        enrichments: getEnrichmentsByPostUri(row.postUri)
      }).pipe(
        Effect.map(({ embedPayload, enrichments }) => ({
          postUri: row.postUri,
          captureStage: row.captureStage,
          embedType: row.embedType,
          embedPayload,
          enrichments,
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

    const upsertCapture = (record: CandidatePayloadRecord) =>
      decodeWithDbError(
        CandidatePayloadRecordSchema,
        record,
        `Invalid candidate payload input for ${record.postUri}`
      ).pipe(
        Effect.flatMap((validated) =>
          encodeJsonColumnWithDbError(
            validated.embedPayload,
            `embed payload for ${validated.postUri}`
          ).pipe(
            Effect.flatMap((embedPayloadJson) =>
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
                      captured_at,
                      updated_at,
                      enriched_at
                    ) VALUES (
                      ${validated.postUri},
                      ${validated.captureStage},
                      ${validated.embedType},
                      ${embedPayloadJson},
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
    ): Effect.Effect<boolean, DbError | SqlError | CandidatePayloadNotPickedError> =>
      decodeWithDbError(
        SaveCandidateEnrichmentInputSchema,
        input,
        `Invalid candidate enrichment input for ${input.postUri}`
      ).pipe(
        Effect.flatMap((validated) =>
          sql<any>`
            SELECT capture_stage as captureStage
            FROM post_payloads
            WHERE post_uri = ${validated.postUri}
            LIMIT 1
          `.pipe(
            Effect.flatMap((rows) =>
              decodeWithDbError(
                CandidatePayloadStageRowsSchema,
                rows,
                `Failed to decode stored payload stage for ${validated.postUri}`
              )
            ),
            Effect.flatMap((rows): Effect.Effect<boolean, DbError | SqlError | CandidatePayloadNotPickedError> => {
              const row = rows[0];
              if (row === undefined) {
                return Effect.succeed(false);
              }

              if (!isPickedCandidatePayloadStage(row.captureStage)) {
                return Effect.fail(
                  new CandidatePayloadNotPickedError({
                    postUri: validated.postUri,
                    captureStage: row.captureStage
                  })
                );
              }

              return encodeJsonColumnWithDbError(
                validated.enrichmentPayload,
                `enrichment payload for ${validated.postUri}`
              ).pipe(
                Effect.flatMap((enrichmentPayloadJson) =>
                  sql`
                    INSERT INTO post_enrichments (
                      post_uri,
                      enrichment_type,
                      enrichment_payload_json,
                      updated_at,
                      enriched_at
                    ) VALUES (
                      ${validated.postUri},
                      ${validated.enrichmentType},
                      ${enrichmentPayloadJson},
                      ${updatedAt},
                      ${enrichedAt}
                    )
                    ON CONFLICT(post_uri, enrichment_type) DO UPDATE SET
                      enrichment_payload_json = excluded.enrichment_payload_json,
                      updated_at = excluded.updated_at,
                      enriched_at = excluded.enriched_at
                  `.pipe(
                    Effect.asVoid,
                    Effect.flatMap(() =>
                      replaceDataRefCandidateCitations(validated, updatedAt)
                    ),
                    Effect.flatMap(() =>
                      sql`
                        UPDATE post_payloads
                        SET enriched_at = ${enrichedAt},
                            updated_at = ${updatedAt}
                        WHERE post_uri = ${validated.postUri}
                          AND capture_stage = ${"picked"}
                      `.pipe(
                        Effect.as(true)
                      )
                    )
                  )
                )
              );
            })
          )
        )
      );

    return {
      upsertCapture,
      getByPostUri,
      markPicked,
      saveEnrichment
    };
  }))
};
