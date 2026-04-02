import { Clock, ServiceMap, Effect, Layer, Schema } from "effect";
import {
  SourceAttributionEnrichment,
  type SourceAttributionEnrichment as SourceAttributionEnrichmentShape
} from "../domain/enrichment";
import { EnrichmentSchemaDecodeError } from "../domain/errors";
import {
  SourceAttributionExecutionPlan,
  type SourceAttributionExecutionPlan as SourceAttributionExecutionPlanShape
} from "../domain/enrichmentPlan";
import { formatSchemaParseError } from "../platform/Json";
import { SourceAttributionMatcher } from "../source/SourceAttributionMatcher";

const decodePlan = (input: unknown) =>
  Schema.decodeUnknown(SourceAttributionExecutionPlan)(input).pipe(
    Effect.mapError((error) =>
      EnrichmentSchemaDecodeError.make({
        message: formatSchemaParseError(error),
        operation: "SourceAttributionExecutor.execute"
      })
    )
  );

const toMatcherInput = (plan: SourceAttributionExecutionPlanShape) => ({
  post: {
    did: plan.post.did,
    handle: plan.post.handle,
    text: plan.post.text
  },
  links: plan.links,
  linkCards: plan.linkCards,
  vision: plan.vision === null
    ? null
    : {
        assets: plan.vision.assets.map((asset) => ({
          assetKey: asset.assetKey,
          analysis: {
            title: asset.analysis.title,
            sourceLines: asset.analysis.sourceLines,
            visibleUrls: asset.analysis.visibleUrls,
            organizationMentions: asset.analysis.organizationMentions,
            logoText: asset.analysis.logoText
          }
        }))
      }
});

export class SourceAttributionExecutor extends ServiceMap.Service<SourceAttributionExecutor, {
  readonly execute: (
    input: SourceAttributionExecutionPlanShape
  ) => Effect.Effect<
    SourceAttributionEnrichmentShape,
    EnrichmentSchemaDecodeError
  >;
}>()("@skygest/SourceAttributionExecutor") {
  static readonly layer = Layer.effect(
    SourceAttributionExecutor,
    Effect.gen(function* () {
      const matcher = yield* SourceAttributionMatcher;

      const execute = Effect.fn("SourceAttributionExecutor.execute")(
        function* (input: SourceAttributionExecutionPlanShape) {
          const plan = yield* decodePlan(input);
          const match = yield* matcher.match(toMatcherInput(plan));
          const processedAt = yield* Clock.currentTimeMillis;

          return yield* Schema.decodeUnknown(SourceAttributionEnrichment)({
            kind: "source-attribution",
            provider: match.provider,
            resolution: match.resolution,
            providerCandidates: match.providerCandidates,
            contentSource: match.contentSource,
            socialProvenance: match.socialProvenance,
            processedAt
          }).pipe(
            Effect.mapError((error) =>
              EnrichmentSchemaDecodeError.make({
                message: formatSchemaParseError(error),
                operation: "SourceAttributionExecutor.execute"
              })
            )
          );
        }
      );

      return { execute };
    })
  );
}
