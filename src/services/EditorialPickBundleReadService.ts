import { Clock, DateTime, Effect, Layer, Option, Schema, ServiceMap } from "effect";
import { SqlError } from "effect/unstable/sql/SqlError";
import { DbError } from "../domain/errors";
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
import {
  IsoTimestamp as IsoTimestampSchema,
  PostUri,
  type IsoTimestamp
} from "../domain/types";
import { stringifyUnknown } from "../platform/Json";

const decodeIsoTimestamp = Schema.decodeUnknownEffect(IsoTimestampSchema);

const toIsoTimestamp = (
  field: string,
  value: number
): Effect.Effect<IsoTimestamp, DbError> =>
  Effect.fromOption(DateTime.make(value)).pipe(
    Effect.map(DateTime.formatIso),
    Effect.flatMap(decodeIsoTimestamp),
    Effect.mapError((cause) =>
      new DbError({
        message: `Failed to normalize ${field} timestamp: ${stringifyUnknown(cause)}`
      })
    )
  );

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

const getResolvedExpert = (
  expert: { readonly displayName: string | null; readonly handle: string | null } | null
): string | undefined =>
  Option.fromNullishOr(expert).pipe(
    Option.flatMap((resolved) =>
      Option.fromNullishOr(resolved.displayName ?? resolved.handle)
    ),
    Option.getOrUndefined
  );

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

          const { payload, enrichment, expert } = yield* Effect.all(
            {
              payload: payloadService.getPayload(postUri),
              enrichment: enrichmentReadService.getPost(postUri),
              expert: expertsRepo.getByDid(post.author)
            },
            { concurrency: "unbounded" }
          );

          const hasEnrichableContent =
            payload !== null && payload.embedPayload !== null;

          if (hasEnrichableContent && enrichment.readiness !== "complete") {
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
          const capturedAt = yield* toIsoTimestamp(
            "editorial pick bundle captured_at",
            payload?.capturedAt ?? post.createdAt
          );
          const pickedAt = yield* toIsoTimestamp(
            "editorial pick bundle picked_at",
            pick.pickedAt
          );
          const expiresAt = pick.expiresAt === null
            ? undefined
            : yield* toIsoTimestamp(
              "editorial pick bundle expires_at",
              pick.expiresAt
            );
          const resolvedExpert = getResolvedExpert(expert);

          return {
            post_uri: postUri,
            post: {
              author: post.author,
              text: post.text,
              // Candidate payload capture time wins when present; otherwise fall
              // back to the original post creation timestamp.
              captured_at: capturedAt
            },
            editorial_pick: {
              score: pick.score,
              curator: pick.curator,
              picked_at: pickedAt,
              reason: pick.reason,
              ...(pick.category === null ? {} : { category: pick.category }),
              ...(expiresAt === undefined ? {} : { expires_at: expiresAt })
            },
            enrichments: {
              readiness: enrichment.readiness,
              ...(vision === undefined ? {} : { vision: vision.payload }),
              ...(sourceAttribution === undefined
                ? {}
                : { source_attribution: sourceAttribution.payload }),
              ...(grounding === undefined ? {} : { grounding: grounding.payload }),
              // Entity extraction is not wired into this read surface yet; keep
              // the field stable as an explicit empty list for downstream callers.
              entities: []
            },
            source_providers: getSourceProviders(sourceAttribution),
            ...(resolvedExpert === undefined ? {} : { resolved_expert: resolvedExpert })
          } satisfies EditorialPickBundle;
        }
      );

      return { getBundle };
    })
  );
}
