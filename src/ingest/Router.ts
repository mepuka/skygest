import * as HttpApi from "effect/unstable/httpapi/HttpApi";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";
import * as HttpApiEndpoint from "effect/unstable/httpapi/HttpApiEndpoint";
import * as HttpApiGroup from "effect/unstable/httpapi/HttpApiGroup";
import { Effect, Layer } from "effect";
import type { AccessIdentity } from "../auth/AuthService";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  IngestRequestSchemas,
  IngestResponseSchemas,
  InternalServerError,
  notFoundError,
  NotFoundError,
  ServiceUnavailableError,
  UnauthorizedError,
  UpstreamFailureError
} from "../domain/api";
import { makeIngestWorkerLayer } from "../edge/Layer";
import { handleWithApiLayer, makeCachedApiHandler } from "../http/ApiSupport";
import {
  getStringField,
  isTaggedError,
  toWorkflowLaunchUnavailable,
  withHttpErrorMapping
} from "../http/ErrorMapping";
import { OperatorIdentity, operatorIdentityContext } from "../http/Identity";
import type { WorkflowIngestEnvBindings } from "../platform/Env";
import { IngestRunItemsRepo } from "../services/IngestRunItemsRepo";
import { IngestRunsRepo } from "../services/IngestRunsRepo";
import { IngestRepairService } from "./IngestRepairService";
import { IngestWorkflowLauncher } from "./IngestWorkflowLauncher";

const toRequestedBy = (identity: AccessIdentity) =>
  identity.email ?? identity.subject ?? "unknown-operator";

const IngestApi = HttpApi.make("ingest")
  .add(
    HttpApiGroup.make("commands")
      .add(
        HttpApiEndpoint.post("poll", "/admin/ingest/poll")
          .setPayload(IngestRequestSchemas.poll)
          .addSuccess(IngestResponseSchemas.queued, { status: 202 })
      )
      .add(
        HttpApiEndpoint.post("backfill", "/admin/ingest/backfill")
          .setPayload(IngestRequestSchemas.backfill)
          .addSuccess(IngestResponseSchemas.queued, { status: 202 })
      )
      .add(
        HttpApiEndpoint.post("reconcile", "/admin/ingest/reconcile")
          .setPayload(IngestRequestSchemas.reconcile)
          .addSuccess(IngestResponseSchemas.queued, { status: 202 })
      )
      .add(
        HttpApiEndpoint.post("repair", "/admin/ingest/repair")
          .addSuccess(IngestResponseSchemas.repair)
      )
  )
  .add(
    HttpApiGroup.make("runs")
      .add(
        HttpApiEndpoint.get("get", "/admin/ingest/runs/:id")
          .setPath(IngestRequestSchemas.runPath)
          .addSuccess(IngestResponseSchemas.run)
      )
      .add(
        HttpApiEndpoint.get("items", "/admin/ingest/runs/:id/items")
          .setPath(IngestRequestSchemas.runPath)
          .addSuccess(IngestResponseSchemas.runItems)
      )
  )
  .addError(BadRequestError)
  .addError(UnauthorizedError)
  .addError(ForbiddenError)
  .addError(ConflictError)
  .addError(NotFoundError)
  .addError(UpstreamFailureError)
  .addError(ServiceUnavailableError)
  .addError(InternalServerError);

const withIngestErrors = <A, R>(
  route: string,
  effect: Effect.Effect<A, unknown, R>
) =>
  withHttpErrorMapping(effect, {
    route,
    classify: (error) => {
      if (isTaggedError(error, "IngestRunNotFoundError")) {
        const runId = getStringField(error, "runId");
        return notFoundError(
          runId === undefined ? "ingest run not found" : `ingest run not found: ${runId}`
        );
      }

      return toWorkflowLaunchUnavailable(error);
    }
  });

const IngestHandlers = Layer.mergeAll(
  HttpApiBuilder.group(IngestApi, "commands", (handlers) =>
    handlers
      .handle("poll", ({ payload }) =>
        withIngestErrors("/admin/ingest/poll", Effect.gen(function* () {
          const actor = yield* OperatorIdentity;
          const launcher = yield* IngestWorkflowLauncher;
          return yield* launcher.start({
            kind: "head-sweep",
            ...(payload.did === undefined ? {} : { dids: [payload.did] }),
            triggeredBy: "admin",
            requestedBy: toRequestedBy(actor)
          });
        }))
      )
      .handle("backfill", ({ payload }) =>
        withIngestErrors("/admin/ingest/backfill", Effect.gen(function* () {
          const actor = yield* OperatorIdentity;
          const launcher = yield* IngestWorkflowLauncher;
          return yield* launcher.start({
            kind: "backfill",
            ...(payload.did === undefined ? {} : { dids: [payload.did] }),
            ...(payload.maxPosts === undefined ? {} : { maxPosts: payload.maxPosts }),
            ...(payload.maxAgeDays === undefined ? {} : { maxAgeDays: payload.maxAgeDays }),
            triggeredBy: "admin",
            requestedBy: toRequestedBy(actor)
          });
        }))
      )
      .handle("reconcile", ({ payload }) =>
        withIngestErrors("/admin/ingest/reconcile", Effect.gen(function* () {
          const actor = yield* OperatorIdentity;
          const launcher = yield* IngestWorkflowLauncher;
          return yield* launcher.start({
            kind: "reconcile",
            ...(payload.did === undefined ? {} : { dids: [payload.did] }),
            ...(payload.depth === undefined ? {} : { depth: payload.depth }),
            triggeredBy: "admin",
            requestedBy: toRequestedBy(actor)
          });
        }))
      )
      .handle("repair", () =>
        withIngestErrors("/admin/ingest/repair", Effect.flatMap(IngestRepairService, (repair) =>
          repair.repairHistoricalRuns()
        ))
      )
  ),
  HttpApiBuilder.group(IngestApi, "runs", (handlers) =>
    handlers
      .handle("get", ({ path }) =>
        withIngestErrors("/admin/ingest/runs/:id", Effect.flatMap(IngestRunsRepo, (runs) =>
          runs.getById(path.id)
        ).pipe(
          Effect.flatMap((run) =>
            run === null
              ? Effect.fail(notFoundError(`ingest run not found: ${path.id}`))
              : Effect.succeed(run)
          )
        ))
      )
      .handle("items", ({ path }) =>
        withIngestErrors("/admin/ingest/runs/:id/items", Effect.gen(function* () {
          const runs = yield* IngestRunsRepo;
          const runItems = yield* IngestRunItemsRepo;
          const run = yield* runs.getById(path.id);

          if (run === null) {
            return yield* Effect.fail(
              notFoundError(`ingest run not found: ${path.id}`)
            );
          }

          const items = yield* runItems.listByRun(path.id);
          return { items };
        }))
      )
  )
);

const makeIngestApiLayer = (serviceLayer: Layer.Layer<any, any, never>) =>
  (() => {
    const handlersLayer = IngestHandlers.pipe(
      Layer.provideMerge(serviceLayer)
    );

    return HttpApiBuilder.api(IngestApi).pipe(
      Layer.provideMerge(handlersLayer)
    );
  })();

const handleCachedIngestRequest = makeCachedApiHandler(
  (env: WorkflowIngestEnvBindings) =>
    makeIngestApiLayer(makeIngestWorkerLayer(env))
);

export const makeWorkflowIngestLayer = makeIngestWorkerLayer;

export const handleIngestRequestWithLayer = (
  request: Request,
  identity: AccessIdentity,
  layer: Layer.Layer<any, any, never>
) =>
  handleWithApiLayer(
    request,
    makeIngestApiLayer(layer),
    operatorIdentityContext(identity)
  );

export const handleIngestRequest = (
  request: Request,
  env: WorkflowIngestEnvBindings,
  identity: AccessIdentity
) =>
  handleCachedIngestRequest(
    request,
    env,
    operatorIdentityContext(identity)
  );
