import { D1Client } from "@effect/sql-d1";
import { Cause, Effect, Either, Exit, Layer, Option, Schema } from "effect";
import type { AccessIdentity } from "../auth/AuthService";
import { BlueskyClient, layer as BlueskyClientLayer } from "../bluesky/BlueskyClient";
import { RepoRecordsClient } from "../bluesky/RepoRecordsClient";
import { ExpertNotFoundError } from "../domain/bi";
import { BlueskyApiError, PollerBusyError } from "../domain/errors";
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
import { CloudflareEnv, type EnvBindings } from "../platform/Env";
import { Logging } from "../platform/Logging";
import { ExpertPoller } from "./ExpertPoller";
import { PollCoordinator } from "./PollCoordinator";
import { OntologyCatalog } from "../services/OntologyCatalog";
import { ExpertSyncStateRepoD1 } from "../services/d1/ExpertSyncStateRepoD1";
import { ExpertsRepoD1 } from "../services/d1/ExpertsRepoD1";
import { IngestLeaseRepoD1 } from "../services/d1/IngestLeaseRepoD1";
import { KnowledgeRepoD1 } from "../services/d1/KnowledgeRepoD1";

class IngestRequestParseError extends Schema.TaggedError<IngestRequestParseError>()(
  "IngestRequestParseError",
  {
    message: Schema.String
  }
) {}

const makeIngestRequestParseError = (message: string) =>
  IngestRequestParseError.make({ message });

const parseDecoded = <A>(
  decoded: Either.Either<A, { readonly message: string }>
) => {
  if (Either.isLeft(decoded)) {
    throw makeIngestRequestParseError(decoded.left.message);
  }

  return decoded.right;
};

const decodePollHeadInput = (body: string) =>
  parseDecoded(
    decodeJsonStringEitherWith(PollHeadInput)(body).pipe(
      Either.mapLeft((error) => ({
        message: formatSchemaParseError(error)
      }))
    )
  );

const decodePollBackfillInput = (body: string) =>
  parseDecoded(
    decodeJsonStringEitherWith(PollBackfillInput)(body).pipe(
      Either.mapLeft((error) => ({
        message: formatSchemaParseError(error)
      }))
    )
  );

const decodePollReconcileInput = (body: string) =>
  parseDecoded(
    decodeJsonStringEitherWith(PollReconcileInput)(body).pipe(
      Either.mapLeft((error) => ({
        message: formatSchemaParseError(error)
      }))
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

export const makeIngestLayer = (env: EnvBindings) => {
  const baseLayer = Layer.mergeAll(
    CloudflareEnv.layer(env, { required: ["DB"] }),
    D1Client.layer({ db: env.DB }),
    Logging.layer
  );
  const configLayer = AppConfig.layer.pipe(Layer.provideMerge(baseLayer));
  const ontologyLayer = OntologyCatalog.layer;
  const expertsLayer = ExpertsRepoD1.layer.pipe(Layer.provideMerge(baseLayer));
  const knowledgeLayer = KnowledgeRepoD1.layer.pipe(Layer.provideMerge(baseLayer));
  const syncStateLayer = ExpertSyncStateRepoD1.layer.pipe(Layer.provideMerge(baseLayer));
  const leaseLayer = IngestLeaseRepoD1.layer.pipe(Layer.provideMerge(baseLayer));
  const blueskyLayer = BlueskyClientLayer.pipe(Layer.provideMerge(configLayer));
  const repoRecordsLayer = RepoRecordsClient.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(blueskyLayer, syncStateLayer)
    )
  );
  const expertPollerLayer = ExpertPoller.layer.pipe(
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
  const coordinatorLayer = PollCoordinator.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(baseLayer, expertsLayer, leaseLayer, expertPollerLayer)
    )
  );

  return Layer.mergeAll(
    baseLayer,
    configLayer,
    ontologyLayer,
    expertsLayer,
    knowledgeLayer,
    syncStateLayer,
    leaseLayer,
    blueskyLayer,
    repoRecordsLayer,
    expertPollerLayer,
    coordinatorLayer
  );
};

const respondToIngestError = (error: unknown): Response => {
  if (error instanceof ExpertNotFoundError || hasTag(error, "ExpertNotFoundError")) {
    return json({ error: "ExpertNotFoundError", did: "did" in error ? error.did : undefined }, 404);
  }

  if (error instanceof PollerBusyError || hasTag(error, "PollerBusyError")) {
    return json({
      error: "PollerBusyError",
      message: "message" in error ? error.message : "poller is already running"
    }, 409);
  }

  if (error instanceof BlueskyApiError || hasTag(error, "BlueskyApiError")) {
    return json({
      error: "BlueskyApiError",
      message: "message" in error ? error.message : "Bluesky API request failed"
    }, 502);
  }

  return json({
    error: "InternalServerError",
    message: error instanceof Error ? error.message : String(error)
  }, 500);
};

export const handleIngestRequestWithLayer = async (
  request: Request,
  _identity: AccessIdentity,
  layer: Layer.Layer<any, any, never>
): Promise<Response> => {
  const url = new URL(request.url);
  const runWithLayer = async <A>(effect: Effect.Effect<A, unknown, any>) => {
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        effect.pipe(Effect.provide(layer))
      )
    );

    return Exit.match(exit, {
      onSuccess: (value) => value,
      onFailure: (cause) => {
        const failure = Cause.failureOption(cause);
        if (Option.isSome(failure)) {
          throw failure.value;
        }

        throw new Error(Cause.pretty(cause));
      }
    });
  };

  try {
    if (request.method === "POST" && url.pathname === "/admin/ingest/poll") {
      const input = decodePollHeadInput(await readBodyText(request));
      const result = await runWithLayer(
        Effect.flatMap(PollCoordinator, (coordinator) =>
          coordinator.run(
            input.did === undefined
              ? { mode: "head" }
              : { mode: "head", did: input.did }
          )
        )
      );
      return json(result);
    }

    if (request.method === "POST" && url.pathname === "/admin/ingest/backfill") {
      const input = decodePollBackfillInput(await readBodyText(request));
      const pollRequest = {
        mode: "backfill" as const,
        ...(input.did === undefined ? {} : { did: input.did }),
        ...(input.maxPosts === undefined ? {} : { maxPosts: input.maxPosts }),
        ...(input.maxAgeDays === undefined ? {} : { maxAgeDays: input.maxAgeDays })
      };
      const result = await runWithLayer(
        Effect.flatMap(PollCoordinator, (coordinator) =>
          coordinator.run(pollRequest)
        )
      );
      return json(result);
    }

    if (request.method === "POST" && url.pathname === "/admin/ingest/reconcile") {
      const input = decodePollReconcileInput(await readBodyText(request));
      const pollRequest = {
        mode: "reconcile" as const,
        ...(input.did === undefined ? {} : { did: input.did }),
        ...(input.depth === undefined ? {} : { depth: input.depth })
      };
      const result = await runWithLayer(
        Effect.flatMap(PollCoordinator, (coordinator) =>
          coordinator.run(pollRequest)
        )
      );
      return json(result);
    }

    return notFound();
  } catch (error) {
    if (error instanceof IngestRequestParseError) {
      return json({ error: error.message }, 400);
    }

    return respondToIngestError(error);
  }
};

export const handleIngestRequest = (
  request: Request,
  env: EnvBindings,
  identity: AccessIdentity
) =>
  handleIngestRequestWithLayer(request, identity, makeIngestLayer(env));
