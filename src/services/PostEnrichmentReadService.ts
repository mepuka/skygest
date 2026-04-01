import { Context, Effect, Layer, Option } from "effect";
import type { SqlError } from "@effect/sql/SqlError";
import type { DbError } from "../domain/errors";
import type {
  GetPostEnrichmentsOutput,
  PostEnrichmentRunSummary
} from "../domain/enrichment";
import { CandidatePayloadService } from "./CandidatePayloadService";
import { EnrichmentRunsRepo } from "./EnrichmentRunsRepo";
import {
  validateStoredEnrichment,
  computeReadiness
} from "../enrichment/PostEnrichmentReadModel";

export class PostEnrichmentReadService extends Context.Tag(
  "@skygest/PostEnrichmentReadService"
)<
  PostEnrichmentReadService,
  {
    readonly getPost: (
      postUri: string
    ) => Effect.Effect<GetPostEnrichmentsOutput, SqlError | DbError>;
  }
>() {
  static readonly layer = Layer.effect(
    PostEnrichmentReadService,
    Effect.gen(function* () {
      const payloadService = yield* CandidatePayloadService;
      const runsRepoOption = yield* Effect.serviceOption(EnrichmentRunsRepo);

      const getPost = Effect.fn("PostEnrichmentReadService.getPost")(
        function* (postUri: string) {
          const payload = yield* payloadService.getPayload(postUri as GetPostEnrichmentsOutput["postUri"]);

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
            postUri: postUri as GetPostEnrichmentsOutput["postUri"],
            readiness,
            enrichments,
            latestRuns
          };
        }
      );

      return PostEnrichmentReadService.of({ getPost });
    })
  );
}
