import { Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql";
import type { DbError } from "../../domain/errors";
import { decodeStoredEnrichmentError } from "../../domain/errors";
import { EmbedPayload } from "../../domain/embed";
import {
  EnrichmentIssueItem as EnrichmentIssueItemSchema,
  GetPostEnrichmentsOutput,
  type EnrichmentIssueItem
} from "../../domain/enrichment";
import {
  PostEnrichmentReadRepo,
  type ListGapCandidatesRepoInput,
  type ListEnrichmentIssuesRepoInput
} from "../PostEnrichmentReadRepo";
import { decodeJsonColumnWithDbError } from "./jsonColumns";
import { decodeWithDbError } from "./schemaDecode";

const RunStatusSchema = Schema.Literals([
  "queued",
  "running",
  "complete",
  "failed",
  "needs-review"
]);

const GapCandidateRowSchema = Schema.Struct({
  postUri: GetPostEnrichmentsOutput.fields.postUri,
  hasLinks: Schema.Number,
  embedPayloadJson: Schema.NullOr(Schema.String),
  hasVisionEnrichment: Schema.Number,
  hasSourceAttributionEnrichment: Schema.Number,
  latestVisionStatus: Schema.NullOr(RunStatusSchema),
  latestSourceAttributionStatus: Schema.NullOr(RunStatusSchema)
});
const GapCandidateRowsSchema = Schema.Array(GapCandidateRowSchema);
type GapCandidateRow = Schema.Schema.Type<typeof GapCandidateRowSchema>;

const GapCandidateDecodedSchema = Schema.Struct({
  postUri: GetPostEnrichmentsOutput.fields.postUri,
  hasLinks: Schema.Boolean,
  embedPayload: Schema.NullOr(EmbedPayload),
  hasVisionEnrichment: Schema.Boolean,
  hasSourceAttributionEnrichment: Schema.Boolean,
  latestVisionStatus: Schema.NullOr(RunStatusSchema),
  latestSourceAttributionStatus: Schema.NullOr(RunStatusSchema)
});

const EnrichmentIssueRowSchema = Schema.Struct({
  runId: Schema.String,
  postUri: GetPostEnrichmentsOutput.fields.postUri,
  enrichmentType: Schema.Literals(["vision", "source-attribution", "grounding"]),
  status: Schema.Literals(["failed", "needs-review"]),
  error: Schema.NullOr(Schema.String),
  lastProgressAt: Schema.NullOr(Schema.Number)
});
const EnrichmentIssueRowsSchema = Schema.Array(EnrichmentIssueRowSchema);

const decodeGapCandidate = (row: GapCandidateRow) =>
  decodeJsonColumnWithDbError(
    row.embedPayloadJson,
    `embed payload for ${row.postUri}`
  ).pipe(
    Effect.flatMap((embedPayload) =>
      decodeWithDbError(
        GapCandidateDecodedSchema,
        {
          postUri: row.postUri,
          hasLinks: row.hasLinks > 0,
          embedPayload,
          hasVisionEnrichment: row.hasVisionEnrichment > 0,
          hasSourceAttributionEnrichment: row.hasSourceAttributionEnrichment > 0,
          latestVisionStatus: row.latestVisionStatus,
          latestSourceAttributionStatus: row.latestSourceAttributionStatus
        },
        `Failed to normalize enrichment gap candidate ${row.postUri}`
      )
    )
  );

const decodeEnrichmentIssues = (
  rows: ReadonlyArray<unknown>
): Effect.Effect<ReadonlyArray<EnrichmentIssueItem>, DbError> =>
  decodeWithDbError(
    EnrichmentIssueRowsSchema,
    rows,
    "Failed to decode enrichment issues"
  ).pipe(
    Effect.map((decodedRows) =>
      decodedRows.map((row) => ({
        runId: row.runId,
        postUri: row.postUri,
        enrichmentType: row.enrichmentType,
        status: row.status,
        error: decodeStoredEnrichmentError(row.error),
        lastProgressAt: row.lastProgressAt
      }))
    ),
    Effect.flatMap((items) =>
      decodeWithDbError(
        Schema.Array(EnrichmentIssueItemSchema),
        items,
        "Failed to normalize enrichment issues"
      )
    )
  );

export const PostEnrichmentReadRepoD1 = {
  layer: Layer.effect(PostEnrichmentReadRepo, Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const listGapCandidates = (input: ListGapCandidatesRepoInput) =>
      sql<any>`
        WITH candidates AS (
          SELECT
            p.uri as postUri,
            p.has_links as hasLinks,
            pp.embed_payload_json as embedPayloadJson,
            EXISTS(
              SELECT 1
              FROM post_enrichments pe
              WHERE pe.post_uri = p.uri
                AND pe.enrichment_type = 'vision'
            ) as hasVisionEnrichment,
            EXISTS(
              SELECT 1
              FROM post_enrichments pe
              WHERE pe.post_uri = p.uri
                AND pe.enrichment_type = 'source-attribution'
            ) as hasSourceAttributionEnrichment,
            (
              SELECT per.status
              FROM post_enrichment_runs per
              WHERE per.post_uri = p.uri
                AND per.enrichment_type = 'vision'
              ORDER BY per.started_at DESC, per.id DESC
              LIMIT 1
            ) as latestVisionStatus,
            (
              SELECT per.status
              FROM post_enrichment_runs per
              WHERE per.post_uri = p.uri
                AND per.enrichment_type = 'source-attribution'
              ORDER BY per.started_at DESC, per.id DESC
              LIMIT 1
            ) as latestSourceAttributionStatus,
            COALESCE(pc.curated_at, pc.flagged_at) as decisionAt
          FROM posts p
          JOIN post_curation pc ON pc.post_uri = p.uri
          JOIN post_payloads pp ON pp.post_uri = p.uri
          WHERE pc.status = 'curated'
            AND pp.capture_stage = 'picked'
            AND p.status = 'active'
            AND (
              ${input.platform ?? null} IS NULL
              OR (${input.platform ?? null} = 'bluesky' AND p.uri LIKE 'at://%')
              OR (${input.platform ?? null} = 'twitter' AND p.uri LIKE 'x://%')
            )
            AND (
              ${input.since ?? null} IS NULL
              OR COALESCE(pc.curated_at, pc.flagged_at) >= ${input.since ?? null}
            )
        )
        SELECT
          postUri,
          hasLinks,
          embedPayloadJson,
          hasVisionEnrichment,
          hasSourceAttributionEnrichment,
          latestVisionStatus,
          latestSourceAttributionStatus
        FROM candidates
        WHERE (
          ${input.enrichmentType ?? null} = 'vision'
          AND hasVisionEnrichment = 0
          AND latestVisionStatus IS NULL
        ) OR (
          ${input.enrichmentType ?? null} = 'source-attribution'
          AND hasSourceAttributionEnrichment = 0
          AND latestSourceAttributionStatus IS NULL
        ) OR (
          ${input.enrichmentType ?? null} IS NULL
          AND (
            (hasVisionEnrichment = 0 AND latestVisionStatus IS NULL)
            OR (hasSourceAttributionEnrichment = 0 AND latestSourceAttributionStatus IS NULL)
          )
        )
        ORDER BY decisionAt DESC, postUri ASC
        LIMIT ${input.scanLimit}
      `.pipe(
        Effect.flatMap((rows) =>
          decodeWithDbError(
            GapCandidateRowsSchema,
            rows,
            "Failed to decode enrichment gap candidates"
          )
        ),
        Effect.flatMap((rows) => Effect.forEach(rows, decodeGapCandidate))
      );

    const listIssues = (input: ListEnrichmentIssuesRepoInput) =>
      (
        input.status === undefined
          ? sql<any>`
              SELECT
                id as runId,
                post_uri as postUri,
                enrichment_type as enrichmentType,
                status as status,
                error as error,
                last_progress_at as lastProgressAt
              FROM post_enrichment_runs
              WHERE status IN ('failed', 'needs-review')
              ORDER BY started_at DESC, id DESC
              LIMIT ${input.limit}
            `
          : sql<any>`
              SELECT
                id as runId,
                post_uri as postUri,
                enrichment_type as enrichmentType,
                status as status,
                error as error,
                last_progress_at as lastProgressAt
              FROM post_enrichment_runs
              WHERE status = ${input.status}
              ORDER BY started_at DESC, id DESC
              LIMIT ${input.limit}
            `
      ).pipe(Effect.flatMap((rows) => decodeEnrichmentIssues(rows)));

    return PostEnrichmentReadRepo.of({
      listGapCandidates,
      listIssues
    });
  }))
};
