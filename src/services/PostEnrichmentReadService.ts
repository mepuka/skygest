import { ServiceMap, Effect, Layer, Option } from "effect";
import { SqlError } from "effect/unstable/sql/SqlError";
import type { DbError } from "../domain/errors";
import type {
  GetPostEnrichmentsOutput,
  ListEnrichmentGapsInput,
  ListEnrichmentGapsOutput,
  ListEnrichmentIssuesInput,
  ListEnrichmentIssuesOutput,
  PostEnrichmentRunSummary
} from "../domain/enrichment";
import type { PostUri } from "../domain/types";
import { CandidatePayloadService } from "./CandidatePayloadService";
import { EnrichmentRunsRepo } from "./EnrichmentRunsRepo";
import { PostEnrichmentReadRepo } from "./PostEnrichmentReadRepo";
import {
  validateStoredEnrichment,
  computeReadiness
} from "../enrichment/PostEnrichmentReadModel";
import {
  hasSourceSignals,
  hasVisualEmbedPayload
} from "../enrichment/EmbedSignals";
import { stripUndefined } from "../platform/Json";

const DEFAULT_GAP_LIMIT = 100;
const MAX_GAP_LIMIT = 500;
const DEFAULT_GAP_SCAN_ROWS = 400;
const MAX_GAP_SCAN_ROWS = 2000;
const DEFAULT_ISSUES_LIMIT = 20;
const MAX_ISSUES_LIMIT = 100;

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
      const payloadService = yield* CandidatePayloadService;
      const readRepo = yield* PostEnrichmentReadRepo;
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
          const rows = yield* readRepo.listGapCandidates(stripUndefined({
            platform: input.platform,
            enrichmentType: input.enrichmentType,
            since: input.since,
            scanLimit
          }));

          const visionMatches: Array<GetPostEnrichmentsOutput["postUri"]> = [];
          const sourceMatches: Array<GetPostEnrichmentsOutput["postUri"]> = [];

          for (const row of rows) {
            const hasVisual = hasVisualEmbedPayload(row.embedPayload);

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
          return {
            items: yield* readRepo.listIssues(stripUndefined({
              status: input.status,
              limit: clampIssuesLimit(input.limit)
            }))
          };
        }
      );

      return { getPost, listGaps, listIssues };
    })
  );
}
