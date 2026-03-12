import { D1Client } from "@effect/sql-d1";
import { Effect, Either, Layer, Schema } from "effect";
import type { AccessIdentity } from "../auth/AuthService";
import { BlueskyClient, layer as BlueskyClientLayer } from "../bluesky/BlueskyClient";
import { RepoRecordsClient } from "../bluesky/RepoRecordsClient";
import { ExpertNotFoundError } from "../domain/bi";
import {
  BlueskyApiError,
  IngestBoundaryError,
  IngestRunNotFoundError,
  IngestSchemaDecodeError,
  IngestWorkflowLaunchError,
  toIngestErrorResponse
} from "../domain/errors";
import {
  PollBackfillInput,
  PollHeadInput,
  PollReconcileInput
} from "../domain/polling";
import { AppConfig } from "../platform/Config";
import {
  decodeJsonStringEitherWith,
  encodeJsonString,
  formatSchemaParseError
} from "../platform/Json";
import {
  CloudflareEnv,
  type WorkflowIngestEnvBindings,
  makeWorkflowIngestEnvLayer
} from "../platform/Env";
import {
  runScopedWithRuntime,
  withManagedRuntime
} from "../platform/EffectRuntime";
import { Logging } from "../platform/Logging";
import { ExpertPollExecutor } from "./ExpertPollExecutor";
import { IngestRepairService } from "./IngestRepairService";
import { IngestWorkflowLauncher } from "./IngestWorkflowLauncher";
import { IngestRunItemsRepo } from "../services/IngestRunItemsRepo";
import { IngestRunsRepo } from "../services/IngestRunsRepo";
import { OntologyCatalog } from "../services/OntologyCatalog";
import { ExpertSyncStateRepoD1 } from "../services/d1/ExpertSyncStateRepoD1";
import { ExpertsRepoD1 } from "../services/d1/ExpertsRepoD1";
import { IngestRunItemsRepoD1 } from "../services/d1/IngestRunItemsRepoD1";
import { IngestRunsRepoD1 } from "../services/d1/IngestRunsRepoD1";
import { KnowledgeRepoD1 } from "../services/d1/KnowledgeRepoD1";

const decodeJsonBody = <A, I>(
  schema: Schema.Schema<A, I, never>,
  body: string,
  operation: string
) =>
  decodeJsonStringEitherWith(schema)(body).pipe(
    Either.mapLeft((error) =>
      IngestSchemaDecodeError.make({
        message: formatSchemaParseError(error),
        operation
      })
    )
  );

const json = (body: unknown, status = 200) =>
  new Response(encodeJsonString(body), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });

const notFound = () =>
  new Response("not found", { status: 404 });

const readBodyText = (request: Request, emptyFallback = "{}") =>
  request.text().then((text) => text.trim().length === 0 ? emptyFallback : text);

const hasTag = (error: unknown, tag: string): error is { readonly _tag: string } =>
  typeof error === "object" &&
  error !== null &&
  "_tag" in error &&
  error._tag === tag;

const toRequestedBy = (identity: AccessIdentity) =>
  identity.email ?? identity.subject ?? "unknown-operator";

const matchRunPath = (pathname: string) =>
  pathname.match(/^\/admin\/ingest\/runs\/([^/]+)$/u)?.[1] ?? null;

const matchRunItemsPath = (pathname: string) =>
  pathname.match(/^\/admin\/ingest\/runs\/([^/]+)\/items$/u)?.[1] ?? null;

export const makeWorkflowIngestLayer = (env: WorkflowIngestEnvBindings) => {
  const baseLayer = Layer.mergeAll(
    CloudflareEnv.layer(env, {
      required: ["DB"]
    }),
    makeWorkflowIngestEnvLayer(env),
    D1Client.layer({ db: env.DB }),
    Logging.layer
  );
  const configLayer = AppConfig.layer.pipe(Layer.provideMerge(baseLayer));
  const ontologyLayer = OntologyCatalog.layer;
  const expertsLayer = ExpertsRepoD1.layer.pipe(Layer.provideMerge(baseLayer));
  const knowledgeLayer = KnowledgeRepoD1.layer.pipe(Layer.provideMerge(baseLayer));
  const syncStateLayer = ExpertSyncStateRepoD1.layer.pipe(Layer.provideMerge(baseLayer));
  const runsLayer = IngestRunsRepoD1.layer.pipe(Layer.provideMerge(baseLayer));
  const runItemsLayer = IngestRunItemsRepoD1.layer.pipe(Layer.provideMerge(baseLayer));
  const blueskyLayer = BlueskyClientLayer.pipe(Layer.provideMerge(configLayer));
  const repoRecordsLayer = RepoRecordsClient.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(blueskyLayer, syncStateLayer)
    )
  );
  const expertPollExecutorLayer = ExpertPollExecutor.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        baseLayer,
        repoRecordsLayer,
        syncStateLayer,
        expertsLayer,
        knowledgeLayer,
        ontologyLayer
      )
    )
  );
  const workflowLauncherLayer = IngestWorkflowLauncher.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(baseLayer, runsLayer)
    )
  );
  const ingestRepairLayer = IngestRepairService.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(runsLayer, runItemsLayer)
    )
  );

  return Layer.mergeAll(
    baseLayer,
    configLayer,
    ontologyLayer,
    expertsLayer,
    knowledgeLayer,
    syncStateLayer,
    runsLayer,
    runItemsLayer,
    blueskyLayer,
    repoRecordsLayer,
    expertPollExecutorLayer,
    workflowLauncherLayer,
    ingestRepairLayer
  );
};

const statusForIngestError = (error: unknown) => {
  if (error instanceof ExpertNotFoundError || hasTag(error, "ExpertNotFoundError")) {
    return 404;
  }

  if (error instanceof IngestRunNotFoundError || hasTag(error, "IngestRunNotFoundError")) {
    return 404;
  }

  if (error instanceof IngestSchemaDecodeError || hasTag(error, "IngestSchemaDecodeError")) {
    return 400;
  }

  if (error instanceof BlueskyApiError || hasTag(error, "BlueskyApiError")) {
    return 502;
  }

  if (error instanceof IngestWorkflowLaunchError || hasTag(error, "IngestWorkflowLaunchError")) {
    return 503;
  }

  if (error instanceof IngestBoundaryError || hasTag(error, "IngestBoundaryError")) {
    return 500;
  }

  return 500;
};

const respondToIngestError = (error: unknown): Response => {
  return json(toIngestErrorResponse(error), statusForIngestError(error));
};

export const handleIngestRequestWithLayer = async (
  request: Request,
  identity: AccessIdentity,
  layer: Layer.Layer<any, any, never>
): Promise<Response> => {
  const url = new URL(request.url);

  try {
    return await withManagedRuntime(layer, async (runtime) => {
      const runWithLayer = <A>(effect: Effect.Effect<A, unknown, any>) =>
        runScopedWithRuntime(runtime, effect, {
          operation: `IngestRouter:${request.method}:${url.pathname}`
        });

      if (request.method === "POST" && url.pathname === "/admin/ingest/poll") {
        const decoded = decodeJsonBody(
          PollHeadInput,
          await readBodyText(request),
          "IngestRouter.poll"
        );
        if (Either.isLeft(decoded)) {
          return respondToIngestError(decoded.left);
        }
        const input = decoded.right;
        const result = await runWithLayer(
          Effect.flatMap(IngestWorkflowLauncher, (launcher) =>
            launcher.start({
              kind: "head-sweep",
              ...(input.did === undefined ? {} : { dids: [input.did] }),
              triggeredBy: "admin",
              requestedBy: toRequestedBy(identity)
            })
          )
        );
        return json(result, 202);
      }

      if (request.method === "POST" && url.pathname === "/admin/ingest/backfill") {
        const decoded = decodeJsonBody(
          PollBackfillInput,
          await readBodyText(request),
          "IngestRouter.backfill"
        );
        if (Either.isLeft(decoded)) {
          return respondToIngestError(decoded.left);
        }
        const input = decoded.right;
        const result = await runWithLayer(
          Effect.flatMap(IngestWorkflowLauncher, (launcher) =>
            launcher.start({
              kind: "backfill",
              ...(input.did === undefined ? {} : { dids: [input.did] }),
              ...(input.maxPosts === undefined ? {} : { maxPosts: input.maxPosts }),
              ...(input.maxAgeDays === undefined ? {} : { maxAgeDays: input.maxAgeDays }),
              triggeredBy: "admin",
              requestedBy: toRequestedBy(identity)
            })
          )
        );
        return json(result, 202);
      }

      if (request.method === "POST" && url.pathname === "/admin/ingest/reconcile") {
        const decoded = decodeJsonBody(
          PollReconcileInput,
          await readBodyText(request),
          "IngestRouter.reconcile"
        );
        if (Either.isLeft(decoded)) {
          return respondToIngestError(decoded.left);
        }
        const input = decoded.right;
        const result = await runWithLayer(
          Effect.flatMap(IngestWorkflowLauncher, (launcher) =>
            launcher.start({
              kind: "reconcile",
              ...(input.did === undefined ? {} : { dids: [input.did] }),
              ...(input.depth === undefined ? {} : { depth: input.depth }),
              triggeredBy: "admin",
              requestedBy: toRequestedBy(identity)
            })
          )
        );
        return json(result, 202);
      }

      if (request.method === "POST" && url.pathname === "/admin/ingest/repair") {
        const summary = await runWithLayer(
          Effect.flatMap(IngestRepairService, (repair) =>
            repair.repairHistoricalRuns()
          )
        );
        return json(summary);
      }

      const runId = matchRunPath(url.pathname);
      if (request.method === "GET" && runId !== null) {
        const run = await runWithLayer(
          Effect.flatMap(IngestRunsRepo, (runs) => runs.getById(runId))
        );
        if (run === null) {
          throw IngestRunNotFoundError.make({ runId });
        }
        return json(run);
      }

      const runItemsId = matchRunItemsPath(url.pathname);
      if (request.method === "GET" && runItemsId !== null) {
        const run = await runWithLayer(
          Effect.flatMap(IngestRunsRepo, (runs) => runs.getById(runItemsId))
        );
        if (run === null) {
          throw IngestRunNotFoundError.make({ runId: runItemsId });
        }
        const items = await runWithLayer(
          Effect.flatMap(IngestRunItemsRepo, (repo) => repo.listByRun(runItemsId))
        );
        return json(items);
      }

      return notFound();
    });
  } catch (error) {
    return respondToIngestError(error);
  }
};

export const handleIngestRequest = (
  request: Request,
  env: WorkflowIngestEnvBindings,
  identity: AccessIdentity
) =>
  handleIngestRequestWithLayer(request, identity, makeWorkflowIngestLayer(env));
