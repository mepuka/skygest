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
import {
  type EnrichmentExecutionPlan,
  type EnrichmentPlannedExistingEnrichment
} from "../domain/enrichmentPlan";
import { Stage1Residual } from "../domain/stage1Resolution";
import { PostUri } from "../domain/types";
import { EnrichmentPlanner } from "../enrichment/EnrichmentPlanner";
import { CloudflareEnv } from "../platform/Env";
import { formatSchemaParseError, stringifyUnknown } from "../platform/Json";
import { Stage1Resolver } from "../resolution/Stage1Resolver";
import { buildStage1Input } from "./stage1Input";

const RESOLVER_VERSION = "stage1-resolver@sky-238";

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
      | ResolverWorkflowLaunchError
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
      | ResolverWorkflowLaunchError
      | SqlError
    >;
  }
>()("@skygest/ResolverService") {
  static readonly layer = Layer.effect(
    ResolverService,
    Effect.gen(function* () {
      const planner = yield* EnrichmentPlanner;
      const stage1Resolver = yield* Stage1Resolver;
      const env = yield* CloudflareEnv;
      const decodePostRequest = (input: unknown) => {
        const decoded = Schema.decodeUnknownResult(ResolvePostRequest)(input);
        return Result.isSuccess(decoded)
          ? Effect.succeed(decoded.success)
          : Effect.fail(
              new EnrichmentSchemaDecodeError({
                message: formatSchemaParseError(decoded.failure),
                operation: "ResolverService.resolvePost"
              })
            );
      };

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
        residuals: ReadonlyArray<Stage1Residual>
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
                residuals: [...residuals]
              }
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

        const stage3 =
          request.dispatchStage3 === true && stage1.residuals.length > 0
            ? {
                status: "queued" as const,
                jobId: yield* queueStage3(request.postUri, stage1.residuals)
              }
            : ({
                status: "not-needed" as const
              });

        const finishedAt = yield* Clock.currentTimeMillis;

        return {
          postUri: request.postUri,
          stage1,
          stage3,
          resolverVersion: RESOLVER_VERSION,
          latencyMs: {
            stage1: stage1FinishedAt - stage1StartedAt,
            total: finishedAt - startedAt
          }
        } satisfies ResolvePostResponseValue;
      });

      const resolveBulk = Effect.fn("ResolverService.resolveBulk")(function* (
        input: ResolveBulkRequest
      ) {
        const responses = yield* Effect.forEach(input.posts, resolvePost, {
          concurrency: "unbounded"
        });

        return {
          items: responses
        } satisfies ResolveBulkResponseValue;
      });

      return {
        resolvePost,
        resolveBulk
      };
    })
  );
}

export const resolverVersion = RESOLVER_VERSION;
