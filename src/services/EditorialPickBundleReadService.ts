import { Clock, Effect, Layer, ServiceMap } from "effect";
import { SqlError } from "effect/unstable/sql/SqlError";
import type { DbError } from "../domain/errors";
import {
  EditorialPickNotFoundError,
  EditorialPickNotReadyError,
  EditorialPostNotFoundError,
  type EditorialPickBundle
} from "../domain/editorial";
import { EditorialRepo } from "./EditorialRepo";
import { CandidatePayloadService } from "./CandidatePayloadService";
import { PostEnrichmentReadService } from "./PostEnrichmentReadService";
import { ExpertsRepo } from "./ExpertsRepo";
import type {
  GroundingPostEnrichmentResult,
  SourceAttributionPostEnrichmentResult,
  VisionPostEnrichmentResult
} from "../domain/enrichment";
import type { ProviderId } from "../domain/source";
import type { PostUri } from "../domain/types";

const toIsoString = (value: number): string => new Date(value).toISOString();

const getSourceProviders = (
  sourceAttribution: SourceAttributionPostEnrichmentResult | undefined
): ReadonlyArray<ProviderId> => {
  if (sourceAttribution === undefined) {
    return [];
  }

  const seen = new Set<string>();
  const ordered: Array<ProviderId> = [];

  const add = (providerId: ProviderId) => {
    const key = providerId as string;
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    ordered.push(providerId);
  };

  if (sourceAttribution.payload.provider !== null) {
    add(sourceAttribution.payload.provider.providerId);
  }

  for (const candidate of sourceAttribution.payload.providerCandidates) {
    add(candidate.providerId);
  }

  return ordered;
};

export class EditorialPickBundleReadService extends ServiceMap.Service<
  EditorialPickBundleReadService,
  {
    readonly getBundle: (
      postUri: PostUri
    ) => Effect.Effect<
      EditorialPickBundle,
      | SqlError
      | DbError
      | EditorialPickNotFoundError
      | EditorialPickNotReadyError
      | EditorialPostNotFoundError
    >;
  }
>()("@skygest/EditorialPickBundleReadService") {
  static readonly layer = Layer.effect(
    EditorialPickBundleReadService,
    Effect.gen(function* () {
      const editorialRepo = yield* EditorialRepo;
      const payloadService = yield* CandidatePayloadService;
      const enrichmentReadService = yield* PostEnrichmentReadService;
      const expertsRepo = yield* ExpertsRepo;

      const getBundle = Effect.fn("EditorialPickBundleReadService.getBundle")(
        function* (postUri: PostUri) {
          const now = yield* Clock.currentTimeMillis;
          const pick = yield* editorialRepo.getActivePick(postUri, now);

          if (pick === null) {
            return yield* new EditorialPickNotFoundError({ postUri });
          }

          const post = yield* editorialRepo.getActivePost(postUri);
          if (post === null) {
            return yield* new EditorialPostNotFoundError({ postUri });
          }

          const payload = yield* payloadService.getPayload(postUri);
          const enrichment = yield* enrichmentReadService.getPost(postUri);

          if (
            payload?.embedPayload !== null &&
            enrichment.readiness !== "complete"
          ) {
            return yield* new EditorialPickNotReadyError({
              postUri,
              readiness: enrichment.readiness
            });
          }

          const vision = enrichment.enrichments.find(
            (item): item is VisionPostEnrichmentResult => item.kind === "vision"
          );
          const sourceAttribution = enrichment.enrichments.find(
            (item): item is SourceAttributionPostEnrichmentResult =>
              item.kind === "source-attribution"
          );
          const grounding = enrichment.enrichments.find(
            (item): item is GroundingPostEnrichmentResult =>
              item.kind === "grounding"
          );
          const expert = yield* expertsRepo.getByDid(post.author);

          return {
            post_uri: postUri,
            post: {
              author: post.author,
              text: post.text,
              captured_at: toIsoString(payload?.capturedAt ?? post.createdAt)
            },
            editorial_pick: {
              score: pick.score,
              curator: pick.curator,
              picked_at: toIsoString(pick.pickedAt),
              reason: pick.reason,
              ...(pick.category === null ? {} : { category: pick.category }),
              ...(pick.expiresAt === null
                ? {}
                : { expires_at: toIsoString(pick.expiresAt) })
            },
            enrichments: {
              readiness: enrichment.readiness,
              ...(vision === undefined ? {} : { vision: vision.payload }),
              ...(sourceAttribution === undefined
                ? {}
                : { source_attribution: sourceAttribution.payload }),
              ...(grounding === undefined ? {} : { grounding: grounding.payload }),
              entities: []
            },
            source_providers: getSourceProviders(sourceAttribution),
            ...(expert === null ? {} : { resolved_expert: expert.did })
          } satisfies EditorialPickBundle;
        }
      );

      return { getBundle };
    })
  );
}
