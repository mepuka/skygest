import { ServiceMap, Effect, Layer, Option, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { SqlError } from "effect/unstable/sql/SqlError";
import type { DbError } from "../domain/errors";
import { decodeStoredEnrichmentError } from "../domain/errors";
import {
  GetPostEnrichmentsOutput,
  type ListEnrichmentGapsInput,
  type ListEnrichmentGapsOutput,
  type ListEnrichmentIssuesInput,
  type ListEnrichmentIssuesOutput,
  type PostEnrichmentRunSummary
} from "../domain/enrichment";
import { EmbedPayload } from "../domain/embed";
import type { PostUri } from "../domain/types";
import { platformFromUri } from "../domain/types";
import { CandidatePayloadService } from "./CandidatePayloadService";
import { EnrichmentRunsRepo } from "./EnrichmentRunsRepo";
import {
  validateStoredEnrichment,
  computeReadiness
} from "../enrichment/PostEnrichmentReadModel";
import {
  hasSourceSignals,
  hasVisualEmbedPayload
} from "../enrichment/EmbedSignals";
import { decodeJsonColumnWithDbError } from "./d1/jsonColumns";
import { decodeWithDbError } from "./d1/schemaDecode";

const DEFAULT_GAP_LIMIT = 100;
const MAX_GAP_LIMIT = 500;
const DEFAULT_GAP_SCAN_ROWS = 400;
const MAX_GAP_SCAN_ROWS = 2000;
const DEFAULT_ISSUES_LIMIT = 20;
const MAX_ISSUES_LIMIT = 100;

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
type GapCandidateDecoded = Schema.Schema.Type<typeof GapCandidateDecodedSchema>;

const EnrichmentIssueRowSchema = Schema.Struct({
  runId: Schema.String,
  postUri: GetPostEnrichmentsOutput.fields.postUri,
  enrichmentType: Schema.Literals(["vision", "source-attribution", "grounding"]),
  status: Schema.Literals(["failed", "needs-review"]),
  error: Schema.NullOr(Schema.String),
  lastProgressAt: Schema.NullOr(Schema.Number)
});
const EnrichmentIssueRowsSchema = Schema.Array(EnrichmentIssueRowSchema);

export class PostEnrichmentReadService extends ServiceMap.Service<
  PostEnrichmentReadService,
  {
    readonly getPost: (
      postUri: PostUri
    ) => Effect.Effect<GetPostEnrichmentsOutput, SqlError | DbError>;

    readonly listGaps: (
      input: ListEnrichmentGapsInput
    ) => Effect.Effect<ListEnrichmentGapsOutput, SqlError | DbError>;

    readonly listIssues: (
      input: ListEnrichmentIssuesInput
    ) => Effect.Effect<ListEnrichmentIssuesOutput, SqlError | DbError>;
  }
>()("@skygest/PostEnrichmentReadService") {
  static readonly layer = Layer.effect(
    PostEnrichmentReadService,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const payloadService = yield* CandidatePayloadService;
      const runsRepoOption = yield* Effect.serviceOption(EnrichmentRunsRepo);

      const clampGapLimit = (limit: number | undefined) =>
        Math.max(1, Math.min(limit ?? DEFAULT_GAP_LIMIT, MAX_GAP_LIMIT));

      const clampGapScanLimit = (limit: number) =>
        Math.min(
          MAX_GAP_SCAN_ROWS,
          Math.max(DEFAULT_GAP_SCAN_ROWS, limit * 4)
        );

      const clampIssuesLimit = (limit: number | undefined) =>
        Math.max(1, Math.min(limit ?? DEFAULT_ISSUES_LIMIT, MAX_ISSUES_LIMIT));

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

      const listGapCandidates = (
        input: ListEnrichmentGapsInput,
        scanLimit: number
      ) =>
        sql<any>`
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
            ) as latestSourceAttributionStatus
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
          ORDER BY COALESCE(pc.curated_at, pc.flagged_at) DESC, p.uri ASC
          LIMIT ${scanLimit}
        `.pipe(
          Effect.flatMap((rows) =>
            decodeWithDbError(
              GapCandidateRowsSchema,
              rows,
              "Failed to decode enrichment gap candidates"
            )
          ),
          Effect.flatMap((rows) =>
            Effect.forEach(rows, decodeGapCandidate)
          )
        );

      const getPost = Effect.fn("PostEnrichmentReadService.getPost")(
        function* (postUri: PostUri) {
          const payload = yield* payloadService.getPayload(postUri);

          const enrichments =
            payload === null
              ? []
              : payload.enrichments.flatMap((e) => {
                  const result = validateStoredEnrichment(e);
                  return result === null ? [] : [result];
                });

          const latestRuns: ReadonlyArray<PostEnrichmentRunSummary> =
            Option.isSome(runsRepoOption)
              ? yield* runsRepoOption.value
                  .listLatestByPostUri(postUri)
                  .pipe(
                    Effect.map((runs) =>
                      runs.map((r) => ({
                        enrichmentType: r.enrichmentType,
                        status: r.status,
                        phase: r.phase,
                        lastProgressAt: r.lastProgressAt,
                        finishedAt: r.finishedAt
                      }))
                    )
                  )
              : [];

          const readiness = computeReadiness(enrichments, latestRuns);

          return {
            postUri,
            readiness,
            enrichments,
            latestRuns
          };
        }
      );

      const listGaps = Effect.fn("PostEnrichmentReadService.listGaps")(
        function* (input: ListEnrichmentGapsInput) {
          const limit = clampGapLimit(input.limit);
          const scanLimit = clampGapScanLimit(limit);
          const rows = yield* listGapCandidates(input, scanLimit);

          const visionMatches: Array<GetPostEnrichmentsOutput["postUri"]> = [];
          const sourceMatches: Array<GetPostEnrichmentsOutput["postUri"]> = [];

          for (const row of rows) {
            const hasVisual = hasVisualEmbedPayload(row.embedPayload);
            const platform = platformFromUri(row.postUri);
            if (input.platform !== undefined && input.platform !== platform) {
              continue;
            }

            const canRunVision =
              input.enrichmentType !== "source-attribution" &&
              hasVisual &&
              row.hasVisionEnrichment === false &&
              row.latestVisionStatus === null;

            const canRunSource =
              input.enrichmentType !== "vision" &&
              row.hasSourceAttributionEnrichment === false &&
              row.latestSourceAttributionStatus === null &&
              (
                hasVisual
                  ? row.hasVisionEnrichment
                  : hasSourceSignals({
                      embedPayload: row.embedPayload,
                      hasStoredLinks: row.hasLinks,
                      hasExistingEnrichments:
                        row.hasVisionEnrichment || row.hasSourceAttributionEnrichment
                    })
              );

            if (canRunVision) {
              visionMatches.push(row.postUri);
            }

            if (canRunSource) {
              sourceMatches.push(row.postUri);
            }
          }

          return {
            vision: {
              count: visionMatches.length,
              postUris: visionMatches.slice(0, limit)
            },
            sourceAttribution: {
              count: sourceMatches.length,
              postUris: sourceMatches.slice(0, limit)
            }
          };
        }
      );

      const listIssues = Effect.fn("PostEnrichmentReadService.listIssues")(
        function* (input: ListEnrichmentIssuesInput) {
          const limit = clampIssuesLimit(input.limit);
          const rows = yield* (
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
                  LIMIT ${limit}
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
                  LIMIT ${limit}
                `
          ).pipe(
            Effect.flatMap((resultRows) =>
              decodeWithDbError(
                EnrichmentIssueRowsSchema,
                resultRows,
                "Failed to decode enrichment issues"
              )
            )
          );

          return {
            items: rows.map((row) => ({
              runId: row.runId,
              postUri: row.postUri,
              enrichmentType: row.enrichmentType,
              status: row.status,
              error: decodeStoredEnrichmentError(row.error),
              lastProgressAt: row.lastProgressAt
            }))
          };
        }
      );

      return { getPost, listGaps, listIssues };
    })
  );
}
