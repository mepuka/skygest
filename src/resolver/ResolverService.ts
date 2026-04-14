import { Clock, Effect, Layer, Result, Schema, ServiceMap } from "effect";
import { SqlError } from "effect/unstable/sql/SqlError";
import { CandidatePayloadNotPickedError } from "../domain/candidatePayload";
import {
  defaultSchemaVersionForEnrichmentKind,
  type SourceAttributionEnrichment
} from "../domain/enrichment";
import {
  type DbError,
  EnrichmentPayloadMissingError,
  EnrichmentPostContextMissingError,
  EnrichmentSchemaDecodeError,
  ResolverSourceAttributionMissingError
} from "../domain/errors";
import {
  ResolveBulkResponse,
  ResolvePostRequest,
  ResolvePostResponse,
  type ResolveBulkRequest,
  type ResolveBulkResponse as ResolveBulkResponseValue,
  type ResolvePostRequest as ResolvePostRequestValue,
  type ResolvePostResponse as ResolvePostResponseValue
} from "../domain/resolution";
import {
  ResolverBulkItemError,
  type ResolverBulkItemError as ResolverBulkItemErrorValue
} from "../domain/resolutionShared";
import {
  type EnrichmentExecutionPlan,
  type EnrichmentPlannedExistingEnrichment
} from "../domain/enrichmentPlan";
import type { EntitySearchBundleCandidates } from "../domain/entitySearch";
import { PostUri } from "../domain/types";
import { EnrichmentPlanner } from "../enrichment/EnrichmentPlanner";
import {
  formatSchemaParseError,
  stringifyUnknown
} from "../platform/Json";
import { ResolutionKernel } from "../resolution/ResolutionKernel";
import { Stage1Resolver } from "../resolution/Stage1Resolver";
import { EntitySearchService } from "../services/EntitySearchService";
import { buildStage1Input } from "./stage1Input";

const RESOLVER_VERSION = "resolution-kernel@sky-314";

const selectLatestSourceAttribution = (
  enrichments: ReadonlyArray<EnrichmentPlannedExistingEnrichment>
): SourceAttributionEnrichment | null => {
  let selected: SourceAttributionEnrichment | null = null;
  let selectedEnrichedAt = Number.NEGATIVE_INFINITY;

  for (const enrichment of enrichments) {
    if (
      enrichment.output.kind === "source-attribution" &&
      enrichment.enrichedAt >= selectedEnrichedAt
    ) {
      selected = enrichment.output;
      selectedEnrichedAt = enrichment.enrichedAt;
    }
  }

  return selected;
};

export class ResolverService extends ServiceMap.Service<
  ResolverService,
  {
    readonly resolvePost: (
      input: ResolvePostRequestValue
    ) => Effect.Effect<
      ResolvePostResponseValue,
      | CandidatePayloadNotPickedError
      | DbError
      | EnrichmentPayloadMissingError
      | EnrichmentPostContextMissingError
      | EnrichmentSchemaDecodeError
      | ResolverSourceAttributionMissingError
      | SqlError
    >;
    readonly resolveBulk: (
      input: ResolveBulkRequest
    ) => Effect.Effect<
      ResolveBulkResponseValue,
      | CandidatePayloadNotPickedError
      | DbError
      | EnrichmentPayloadMissingError
      | EnrichmentPostContextMissingError
      | EnrichmentSchemaDecodeError
      | ResolverSourceAttributionMissingError
      | SqlError
    >;
    readonly searchCandidates: (
      input: ResolvePostRequestValue
    ) => Effect.Effect<
      EntitySearchBundleCandidates,
      | CandidatePayloadNotPickedError
      | DbError
      | EnrichmentPayloadMissingError
      | EnrichmentPostContextMissingError
      | EnrichmentSchemaDecodeError
      | ResolverSourceAttributionMissingError
      | SqlError
    >;
  }
>()("@skygest/ResolverService") {
  static readonly layer = Layer.effect(
    ResolverService,
    Effect.gen(function* () {
      const planner = yield* EnrichmentPlanner;
      const stage1Resolver = yield* Stage1Resolver;
      const resolutionKernel = yield* ResolutionKernel;
      const entitySearch = yield* EntitySearchService;
      const decodePostResponse = (input: unknown) =>
        Schema.decodeUnknownEffect(ResolvePostResponse)(input).pipe(
          Effect.mapError(
            (decodeError) =>
              new EnrichmentSchemaDecodeError({
                message: formatSchemaParseError(decodeError),
                operation: "ResolverService.resolvePost"
              })
          )
        );
      const decodeBulkResponse = (input: unknown) =>
        Schema.decodeUnknownEffect(ResolveBulkResponse)(input).pipe(
          Effect.mapError(
            (decodeError) =>
              new EnrichmentSchemaDecodeError({
                message: formatSchemaParseError(decodeError),
                operation: "ResolverService.resolveBulk"
              })
          )
        );
      const decodeBulkItemError = (input: unknown) =>
        Schema.decodeUnknownEffect(ResolverBulkItemError)(input).pipe(
          Effect.mapError(
            (decodeError) =>
              new EnrichmentSchemaDecodeError({
                message: formatSchemaParseError(decodeError),
                operation: "ResolverService.resolveBulk"
              })
          )
        );
      const decodePostRequest = (input: unknown) =>
        Schema.decodeUnknownEffect(ResolvePostRequest)(input).pipe(
          Effect.mapError(
            (decodeError) =>
              new EnrichmentSchemaDecodeError({
                message: formatSchemaParseError(decodeError),
                operation: "ResolverService.resolvePost"
              })
          )
        );

      const loadStoredStage1Input = Effect.fn(
        "ResolverService.loadStoredStage1Input"
      )(function* (postUri: Schema.Schema.Type<typeof PostUri>) {
        const plan = yield* planner.plan({
          postUri,
          enrichmentType: "source-attribution",
          schemaVersion: defaultSchemaVersionForEnrichmentKind("source-attribution")
        });
        const sourceAttribution = selectLatestSourceAttribution(
          plan.existingEnrichments
        );

        if (sourceAttribution === null) {
          return yield* new ResolverSourceAttributionMissingError({ postUri });
        }

        return buildStage1Input(plan, sourceAttribution);
      });

      const loadValidatedStage1Input = Effect.fn(
        "ResolverService.loadValidatedStage1Input"
      )(function* (input: ResolvePostRequestValue) {
        const request = yield* decodePostRequest(input);

        if (
          request.stage1Input !== undefined &&
          request.stage1Input.postContext.postUri !== request.postUri
        ) {
          return yield* new EnrichmentSchemaDecodeError({
            message: "postUri does not match stage1Input.postContext.postUri",
            operation: "ResolverService.resolvePost"
          });
        }

        const stage1Input =
          request.stage1Input ?? (yield* loadStoredStage1Input(request.postUri));

        return {
          request,
          stage1Input
        };
      });

      const resolvePost = Effect.fn("ResolverService.resolvePost")(function* (
        input: ResolvePostRequestValue
      ) {
        const { request, stage1Input } = yield* loadValidatedStage1Input(input);
        const startedAt = yield* Clock.currentTimeMillis;
        const stage1StartedAt = yield* Clock.currentTimeMillis;
        const stage1 = yield* stage1Resolver.resolve(stage1Input);
        const stage1FinishedAt = yield* Clock.currentTimeMillis;
        const kernelStartedAt = yield* Clock.currentTimeMillis;
        const kernel = yield* resolutionKernel.resolve(stage1Input);
        const kernelFinishedAt = yield* Clock.currentTimeMillis;

        const finishedAt = yield* Clock.currentTimeMillis;

        return yield* decodePostResponse({
          postUri: request.postUri,
          stage1,
          kernel,
          resolverVersion: RESOLVER_VERSION,
          latencyMs: {
            stage1: stage1FinishedAt - stage1StartedAt,
            kernel: kernelFinishedAt - kernelStartedAt,
            total: finishedAt - startedAt
          }
        });
      });

      const searchCandidates = Effect.fn(
        "ResolverService.searchCandidates"
      )(function* (input: ResolvePostRequestValue) {
        const { stage1Input } = yield* loadValidatedStage1Input(input);
        const stage1 = yield* stage1Resolver.resolve(stage1Input);

        return yield* entitySearch.searchBundleCandidates({
          stage1Input,
          stage1
        });
      });

      const resolveBulk = Effect.fn("ResolverService.resolveBulk")(function* (
        input: ResolveBulkRequest
      ) {
        const settled = yield* Effect.forEach(
          input.posts,
          (request) =>
            resolvePost(request).pipe(
              Effect.result,
              Effect.map((result) => ({
                postUri: request.postUri,
                result
              }))
            ),
          {
            concurrency: 8
          }
        );

        const results: Record<string, ResolvePostResponseValue> = {};
        const errors: Record<string, ResolverBulkItemErrorValue> = {};

        for (const item of settled) {
          if (Result.isSuccess(item.result)) {
            results[item.postUri] = item.result.success;
            continue;
          }

          const error = item.result.failure;
          errors[item.postUri] = yield* decodeBulkItemError({
            tag:
              typeof error === "object" &&
              error !== null &&
              "_tag" in error &&
              typeof error._tag === "string"
                ? error._tag
                : "ResolverBulkItemError",
            message:
              typeof error === "object" &&
              error !== null &&
              "message" in error &&
              typeof error.message === "string"
                ? error.message
                : stringifyUnknown(error)
          });
        }

        return yield* decodeBulkResponse({
          results,
          errors
        });
      });

      return {
        resolvePost,
        resolveBulk,
        searchCandidates
      };
    })
  );
}

export const resolverVersion = RESOLVER_VERSION;
