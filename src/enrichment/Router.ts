import * as HttpApi from "effect/unstable/httpapi/HttpApi";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";
import * as HttpApiEndpoint from "effect/unstable/httpapi/HttpApiEndpoint";
import * as HttpApiGroup from "effect/unstable/httpapi/HttpApiGroup";
import { Effect, Layer } from "effect";
import type { AccessIdentity } from "../auth/AuthService";
import * as HttpApiSchema from "effect/unstable/httpapi/HttpApiSchema";
import {
  ApiErrorSchemas,
  EnrichmentRequestSchemas,
  EnrichmentResponseSchemas,
  notFoundError,
  conflictError,
  serviceUnavailableError
} from "../domain/api";
import {
  EnrichmentRetryNotAllowedError,
  EnrichmentRunNotFoundError
} from "../domain/errors";
import { defaultSchemaVersionForEnrichmentKind } from "../domain/enrichment";
import type { PostUri } from "../domain/types";
import { makeWorkflowEnrichmentLayer } from "../enrichment/Layer";
import { EnrichmentPlanner } from "./EnrichmentPlanner";
import { isSkippedEnrichmentPlan } from "./EnrichmentPredicates";
import { handleWithApiLayer, makeCachedApiHandler } from "../http/ApiSupport";
import {
  getStringField,
  isTaggedError,
  withHttpErrorMapping
} from "../http/ErrorMapping";
import { OperatorIdentity, operatorIdentityContext } from "../http/Identity";
import type { WorkflowEnrichmentEnvBindings } from "../platform/Env";
import { EnrichmentRunsRepo } from "../services/EnrichmentRunsRepo";
import { EnrichmentRepairService } from "./EnrichmentRepairService";
import { EnrichmentWorkflowLauncher } from "./EnrichmentWorkflowLauncher";

const DEFAULT_RUN_LIST_LIMIT = 20;
const MAX_RUN_LIST_LIMIT = 100;

const clampListLimit = (value: number | undefined) =>
  Math.max(1, Math.min(value ?? DEFAULT_RUN_LIST_LIMIT, MAX_RUN_LIST_LIMIT));

const toRequestedBy = (identity: AccessIdentity) =>
  identity.email ?? identity.subject ?? "unknown-operator";

const ensureEnrichmentStartAllowed = (input: {
  readonly postUri: PostUri;
  readonly enrichmentType: "vision" | "source-attribution" | "grounding";
  readonly schemaVersion: string;
}) =>
  input.enrichmentType !== "source-attribution"
    ? Effect.void
    : Effect.gen(function* () {
        const planner = yield* EnrichmentPlanner;
        const plan = yield* planner.plan(input);

        if (
          isSkippedEnrichmentPlan(plan) &&
          plan.stopReason === "awaiting-vision"
        ) {
          return yield* Effect.fail(
            conflictError(
              `vision enrichment must complete before source attribution can start for ${input.postUri}`,
              true
            )
          );
        }
      });

const EnrichmentApi = HttpApi.make("enrichment")
  .add(
    HttpApiGroup.make("commands")
      .add(
        HttpApiEndpoint.post("start", "/admin/enrichment/start", {
          disableCodecs: true,
          payload: EnrichmentRequestSchemas.start,
          success: EnrichmentResponseSchemas.queued.pipe(HttpApiSchema.status(202)),
          error: ApiErrorSchemas
        })
      )
      .add(
        HttpApiEndpoint.post("repair", "/admin/enrichment/repair", {
          disableCodecs: true,
          success: EnrichmentResponseSchemas.repair,
          error: ApiErrorSchemas
        })
      )
      .add(
        HttpApiEndpoint.post("retry", "/admin/enrichment/runs/:id/retry", {
          disableCodecs: true,
          params: EnrichmentRequestSchemas.runPath,
          success: EnrichmentResponseSchemas.queued.pipe(HttpApiSchema.status(202)),
          error: ApiErrorSchemas
        })
      )
  )
  .add(
    HttpApiGroup.make("runs")
      .add(
        HttpApiEndpoint.get("list", "/admin/enrichment/runs", {
          disableCodecs: true,
          query: EnrichmentRequestSchemas.runs,
          success: EnrichmentResponseSchemas.runs,
          error: ApiErrorSchemas
        })
      )
      .add(
        HttpApiEndpoint.get("get", "/admin/enrichment/runs/:id", {
          disableCodecs: true,
          params: EnrichmentRequestSchemas.runPath,
          success: EnrichmentResponseSchemas.run,
          error: ApiErrorSchemas
        })
      )
  );

const withEnrichmentErrors = <A, R>(
  route: string,
  effect: Effect.Effect<A, unknown, R>
) =>
  withHttpErrorMapping(effect, {
    route,
    classify: (error) => {
      if (
        error instanceof EnrichmentRunNotFoundError ||
        isTaggedError(error, "EnrichmentRunNotFoundError")
      ) {
        const runId = getStringField(error, "runId");
        return notFoundError(
          runId === undefined
            ? "enrichment run not found"
            : `enrichment run not found: ${runId}`
        );
      }

      if (
        error instanceof EnrichmentRetryNotAllowedError ||
        isTaggedError(error, "EnrichmentRetryNotAllowedError")
      ) {
        const runId = getStringField(error, "runId");
        return conflictError(
          runId === undefined
            ? "enrichment retry not allowed"
            : `enrichment retry not allowed: ${runId}`
        );
      }

      if (
        isTaggedError(error, "EnrichmentWorkflowLaunchError") ||
        isTaggedError(error, "EnrichmentWorkflowControlError")
      ) {
        return serviceUnavailableError(
          "failed to control enrichment workflow",
          true
        );
      }

      return undefined;
    }
  });

export const startEnrichmentEffect = (
  payload: typeof EnrichmentRequestSchemas.start.Type,
  requestedBy: string
) =>
  withEnrichmentErrors(
    "/admin/enrichment/start",
    Effect.gen(function* () {
      const launcher = yield* EnrichmentWorkflowLauncher;
      const schemaVersion =
        payload.schemaVersion ??
        defaultSchemaVersionForEnrichmentKind(payload.enrichmentType);

      yield* ensureEnrichmentStartAllowed({
        postUri: payload.postUri,
        enrichmentType: payload.enrichmentType,
        schemaVersion
      });

      return yield* launcher.start({
        postUri: payload.postUri,
        enrichmentType: payload.enrichmentType,
        schemaVersion,
        triggeredBy: "admin",
        requestedBy
      });
    })
  );

const EnrichmentHandlers = Layer.mergeAll(
  HttpApiBuilder.group(EnrichmentApi, "commands", (handlers) =>
    handlers
      .handle("start", ({ payload }) =>
        Effect.gen(function* () {
          const actor = yield* OperatorIdentity;
          return yield* startEnrichmentEffect(
            payload,
            toRequestedBy(actor)
          );
        })
      )
      .handle("repair", () =>
        withEnrichmentErrors(
          "/admin/enrichment/repair",
          EnrichmentRepairService.use( (repair) =>
            repair.repairHistoricalRuns()
          )
        )
      )
      .handle("retry", ({ params: path }) =>
        withEnrichmentErrors(
          "/admin/enrichment/runs/:id/retry",
          EnrichmentRepairService.use( (repair) =>
            repair.retryRun(path.id)
          )
        )
      )
  ),
  HttpApiBuilder.group(EnrichmentApi, "runs", (handlers) =>
    handlers
      .handle("list", ({ query: urlParams }) =>
        withEnrichmentErrors(
          "/admin/enrichment/runs",
          EnrichmentRunsRepo.use( (runs) =>
            runs.listRecent({
              ...(urlParams.status === undefined ? {} : { status: urlParams.status }),
              limit: clampListLimit(urlParams.limit)
            })
          ).pipe(
            Effect.map((items) => ({ items }))
          )
        )
      )
      .handle("get", ({ params: path }) =>
        withEnrichmentErrors(
          "/admin/enrichment/runs/:id",
          EnrichmentRunsRepo.use( (runs) =>
            runs.getById(path.id)
          ).pipe(
            Effect.flatMap((run) =>
              run === null
                ? Effect.fail(
                    new EnrichmentRunNotFoundError({
                      runId: path.id
                    })
                  )
                : Effect.succeed(run)
            )
          )
        )
      )
  )
);

const makeEnrichmentApiLayer = (serviceLayer: Layer.Layer<any, any, never>) =>
  (() => {
    const handlersLayer = EnrichmentHandlers.pipe(
      Layer.provideMerge(serviceLayer)
    );

    return HttpApiBuilder.layer(EnrichmentApi).pipe(
      Layer.provideMerge(handlersLayer)
    );
  })();

const handleCachedEnrichmentRequest = makeCachedApiHandler(
  (env: WorkflowEnrichmentEnvBindings) =>
    makeEnrichmentApiLayer(makeWorkflowEnrichmentLayer(env))
);

export const handleEnrichmentRequestWithLayer = (
  request: Request,
  identity: AccessIdentity,
  layer: Layer.Layer<any, any, never>
) =>
  handleWithApiLayer(
    request,
    makeEnrichmentApiLayer(layer),
    operatorIdentityContext(identity)
  );

export const handleEnrichmentRequest = (
  request: Request,
  env: WorkflowEnrichmentEnvBindings,
  identity: AccessIdentity
) =>
  handleCachedEnrichmentRequest(
    request,
    env,
    operatorIdentityContext(identity)
  );
