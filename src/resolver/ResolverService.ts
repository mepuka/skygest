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
  ResolverSourceAttributionMissingError,
  ResolverWorkflowLaunchError
} from "../domain/errors";
import {
  DataRefResolverRunParams,
  ResolveBulkResponse,
  ResolvePostRequest,
  type ResolveBulkRequest,
  type ResolveBulkResponse as ResolveBulkResponseValue,
  type ResolvePostRequest as ResolvePostRequestValue,
  type ResolvePostResponse as ResolvePostResponseValue
} from "../domain/resolution";
import { type ResolverBulkItemError as ResolverBulkItemErrorValue } from "../domain/resolutionShared";
import { Stage3Input } from "../domain/stage2Resolution";
import {
  type EnrichmentExecutionPlan,
  type EnrichmentPlannedExistingEnrichment
} from "../domain/enrichmentPlan";
import { Stage1Residual } from "../domain/stage1Resolution";
import { PostUri } from "../domain/types";
import { EnrichmentPlanner } from "../enrichment/EnrichmentPlanner";
import { CloudflareEnv } from "../platform/Env";
import {
  formatSchemaParseError,
  stringifyUnknown,
  stripUndefined
} from "../platform/Json";
import { Stage1Resolver } from "../resolution/Stage1Resolver";
import { Stage2Resolver } from "../resolution/Stage2Resolver";
import { buildStage1Input } from "./stage1Input";
import { Logging } from "../platform/Logging";

const RESOLVER_VERSION = "stage2-resolver@sky-306-307";

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
  }
>()("@skygest/ResolverService") {
  static readonly layer = Layer.effect(
    ResolverService,
    Effect.gen(function* () {
      const planner = yield* EnrichmentPlanner;
      const stage1Resolver = yield* Stage1Resolver;
      const stage2Resolver = yield* Stage2Resolver;
      const env = yield* CloudflareEnv;
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

      const queueStage3 = Effect.fn("ResolverService.queueStage3")(function* (
        postUri: Schema.Schema.Type<typeof PostUri>,
        stage3Inputs: ReadonlyArray<Stage3Input>
      ) {
        const workflow = env.RESOLVER_RUN_WORKFLOW;
        if (workflow == null) {
          return yield* new ResolverWorkflowLaunchError({
            message: "missing RESOLVER_RUN_WORKFLOW binding",
            operation: "ResolverService.queueStage3"
          });
        }
        const jobId = crypto.randomUUID();

        yield* Effect.tryPromise({
          try: () =>
            workflow.create({
              id: jobId,
              params: {
                postUri,
                stage3Inputs: [...stage3Inputs]
              } satisfies DataRefResolverRunParams
            }),
          catch: (cause) =>
            new ResolverWorkflowLaunchError({
              message: stringifyUnknown(cause),
              operation: "ResolverService.queueStage3"
            })
        });

        return jobId;
      });

      const resolvePost = Effect.fn("ResolverService.resolvePost")(function* (
        input: ResolvePostRequestValue
      ) {
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

        const startedAt = yield* Clock.currentTimeMillis;
        const stage1Input =
          request.stage1Input ?? (yield* loadStoredStage1Input(request.postUri));
        const stage1StartedAt = yield* Clock.currentTimeMillis;
        const stage1 = yield* stage1Resolver.resolve(stage1Input);
        const stage1FinishedAt = yield* Clock.currentTimeMillis;
        const stage2StartedAt = yield* Clock.currentTimeMillis;
        const stage2 = yield* stage2Resolver.resolve(stage1Input.postContext, stage1);
        const stage2FinishedAt = yield* Clock.currentTimeMillis;

        const stage3 = yield* (
          request.dispatchStage3 === true && stage2.escalations.length > 0
            ? queueStage3(
                request.postUri,
                stage2.escalations
              ).pipe(
                Effect.tapError((error) =>
                  Logging.logWarning("resolver stage3 dispatch failed", {
                    postUri: request.postUri,
                    errorTag: error._tag,
                    operation: "ResolverService.resolvePost"
                  })
                ),
                Effect.result,
                Effect.map((result) =>
                  Result.isSuccess(result)
                    ? ({
                        status: "queued" as const,
                        jobId: result.success
                      })
                    : undefined
                )
              )
            : Effect.void.pipe(Effect.as(undefined))
        );

        const finishedAt = yield* Clock.currentTimeMillis;

        return stripUndefined({
          postUri: request.postUri,
          stage1,
          stage2,
          stage3,
          resolverVersion: RESOLVER_VERSION,
          latencyMs: {
            stage1: stage1FinishedAt - stage1StartedAt,
            stage2: stage2FinishedAt - stage2StartedAt,
            total: finishedAt - startedAt
          }
        }) as ResolvePostResponseValue;
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
          errors[item.postUri] = {
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
          };
        }

        return {
          results,
          errors
        } as ResolveBulkResponseValue;
      });

      return {
        resolvePost,
        resolveBulk
      };
    })
  );
}

export const resolverVersion = RESOLVER_VERSION;
