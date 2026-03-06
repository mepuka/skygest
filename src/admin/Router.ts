import { Effect, Either, Layer, Schema } from "effect";
import { D1Client } from "@effect/sql-d1";
import type { AccessIdentity } from "../auth/AuthService";
import {
  AddExpertInput,
  ExpertNotFoundError,
  type ListExpertsInput,
  InvalidShardRequestError,
  HandleResolutionError,
  ProfileLookupError,
  RefreshShardsInput,
  SetExpertActiveInput
} from "../domain/bi";
import { Did } from "../domain/types";
import { IngestorPingError } from "../domain/errors";
import { AppConfig } from "../platform/Config";
import {
  decodeJsonStringEitherWith,
  decodeUnknownEitherWith,
  encodeJsonString,
  formatSchemaParseError
} from "../platform/Json";
import { CloudflareEnv, type EnvBindings } from "../platform/Env";
import { Logging } from "../platform/Logging";
import { BlueskyClient, layer as BlueskyClientLayer } from "../bluesky/BlueskyClient";
import { ExpertRegistryService } from "../services/ExpertRegistryService";
import { IngestShardRefresher } from "../services/IngestShardRefresher";
import { ExpertsRepoD1 } from "../services/d1/ExpertsRepoD1";
import { KnowledgeRepoD1 } from "../services/d1/KnowledgeRepoD1";
import { OntologyCatalog } from "../services/OntologyCatalog";
import { StagingOpsService } from "../services/StagingOpsService";

class AdminRequestParseError extends Schema.TaggedError<AdminRequestParseError>()(
  "AdminRequestParseError",
  {
    message: Schema.String
  }
) {}

const makeAdminRequestParseError = (message: string) =>
  AdminRequestParseError.make({ message });

const parseDecoded = <A>(
  decoded: Either.Either<A, { readonly message: string }>
) => {
  if (Either.isLeft(decoded)) {
    throw makeAdminRequestParseError(decoded.left.message);
  }

  return decoded.right;
};

const decodeAddExpertInput = (body: string) =>
  parseDecoded(
    decodeJsonStringEitherWith(AddExpertInput)(body).pipe(
      Either.mapLeft((error) => ({
        message: formatSchemaParseError(error)
      }))
    )
  );

const decodeSetExpertActiveInput = (body: string) =>
  parseDecoded(
    decodeJsonStringEitherWith(SetExpertActiveInput)(body).pipe(
      Either.mapLeft((error) => ({
        message: formatSchemaParseError(error)
      }))
    )
  );

const decodeRefreshShardsInput = (body: string) =>
  parseDecoded(
    decodeJsonStringEitherWith(RefreshShardsInput)(body).pipe(
      Either.mapLeft((error) => ({
        message: formatSchemaParseError(error)
      }))
    )
  );

const decodeDid = (value: unknown) =>
  parseDecoded(
    decodeUnknownEitherWith(Did)(value).pipe(
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

const badRequest = (message: string) =>
  json({ error: message }, 400);

const notFound = () =>
  new Response("not found", { status: 404 });

const readBodyText = (request: Request, emptyFallback = "{}") =>
  request.text().then((text) => text.trim().length === 0 ? emptyFallback : text);

const isStagingOpsPath = (pathname: string) =>
  pathname.startsWith("/admin/ops/");

const parseListExpertsInput = (url: URL): ListExpertsInput => {
  const activeParam = url.searchParams.get("active");
  const limitParam = url.searchParams.get("limit");
  const active = activeParam === null
    ? undefined
    : activeParam === "true"
      ? true
      : activeParam === "false"
        ? false
        : (() => {
          throw makeAdminRequestParseError("active must be 'true' or 'false'");
        })();
  const limit = limitParam === null
    ? undefined
    : (() => {
      const parsed = Number(limitParam);
      if (!Number.isFinite(parsed)) {
        throw makeAdminRequestParseError("limit must be a number");
      }
      return parsed;
    })();

  return {
    domain: url.searchParams.get("domain") ?? undefined,
    active,
    limit
  };
};

const makeAdminLayer = (env: EnvBindings) => {
  const baseLayer = Layer.mergeAll(
    CloudflareEnv.layer(env, { required: ["DB", "JETSTREAM_INGESTOR"] }),
    D1Client.layer({ db: env.DB }),
    Logging.layer
  );
  const configLayer = AppConfig.layer.pipe(Layer.provideMerge(baseLayer));
  const ontologyLayer = OntologyCatalog.layer;
  const expertsLayer = ExpertsRepoD1.layer.pipe(Layer.provideMerge(baseLayer));
  const knowledgeLayer = KnowledgeRepoD1.layer.pipe(Layer.provideMerge(baseLayer));
  const blueskyLayer = BlueskyClientLayer.pipe(Layer.provideMerge(configLayer));
  const refreshLayer = IngestShardRefresher.layer.pipe(
    Layer.provideMerge(Layer.mergeAll(baseLayer, configLayer))
  );
  const registryLayer = ExpertRegistryService.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(configLayer, expertsLayer, blueskyLayer, refreshLayer)
    )
  );
  const stagingOpsLayer = StagingOpsService.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        configLayer,
        expertsLayer,
        knowledgeLayer,
        ontologyLayer,
        refreshLayer,
        baseLayer
      )
    )
  );

  return Layer.mergeAll(
    baseLayer,
    configLayer,
    ontologyLayer,
    expertsLayer,
    knowledgeLayer,
    blueskyLayer,
    refreshLayer,
    registryLayer,
    stagingOpsLayer
  );
};

const respondToAdminError = (error: unknown): Response => {
  if (error instanceof ExpertNotFoundError) {
    return json({ error: error._tag, did: error.did }, 404);
  }

  if (
    error instanceof HandleResolutionError ||
    error instanceof ProfileLookupError ||
    error instanceof IngestorPingError
  ) {
    return json({
      error: error._tag,
      message: "message" in error ? error.message : "ingest refresh failed"
    }, 502);
  }

  if (error instanceof InvalidShardRequestError) {
    return json({ error: error._tag, message: error.message }, 400);
  }

  return json({
    error: "InternalServerError",
    message: error instanceof Error ? error.message : String(error)
  }, 500);
};

export const handleAdminRequestWithLayer = async (
  request: Request,
  identity: AccessIdentity,
  layer: Layer.Layer<any, any, never>
): Promise<Response> => {
  const url = new URL(request.url);
  const runWithLayer = <A>(effect: Effect.Effect<A, unknown, any>) =>
    Effect.runPromise(
      Effect.scoped(
        effect.pipe(Effect.provide(layer))
      )
    );

  try {
    const stagingOpsEnabled = await runWithLayer(
      Effect.map(AppConfig, (config) => config.operatorAuthMode === "shared-secret")
    );

    if (isStagingOpsPath(url.pathname) && !stagingOpsEnabled) {
      return notFound();
    }

    if (request.method === "POST" && url.pathname === "/admin/experts") {
      const input = decodeAddExpertInput(await readBodyText(request));
      const result = await runWithLayer(
        Effect.flatMap(ExpertRegistryService, (registry) =>
          registry.addExpert(identity, input)
        )
      );
      return json(result);
    }

    if (request.method === "GET" && url.pathname === "/admin/experts") {
      const input = parseListExpertsInput(url);
      const items = await runWithLayer(
        Effect.flatMap(ExpertRegistryService, (registry) =>
          registry.listExperts(input)
        )
      );
      return json({ items });
    }

    if (request.method === "POST" && url.pathname === "/admin/shards/refresh") {
      const input = decodeRefreshShardsInput(await readBodyText(request));
      const result = await runWithLayer(
        Effect.flatMap(ExpertRegistryService, (registry) =>
          registry.refreshShards(identity, input)
        )
      );
      return json(result);
    }

    if (request.method === "POST" && url.pathname === "/admin/ops/migrate") {
      await readBodyText(request);
      const result = await runWithLayer(
        Effect.flatMap(StagingOpsService, (ops) => ops.migrate(identity))
      );
      return json(result);
    }

    if (request.method === "POST" && url.pathname === "/admin/ops/bootstrap-experts") {
      await readBodyText(request);
      const result = await runWithLayer(
        Effect.flatMap(StagingOpsService, (ops) => ops.bootstrapExperts(identity))
      );
      return json(result);
    }

    if (request.method === "POST" && url.pathname === "/admin/ops/load-smoke-fixture") {
      await readBodyText(request);
      const result = await runWithLayer(
        Effect.flatMap(StagingOpsService, (ops) => ops.loadSmokeFixture(identity))
      );
      return json(result);
    }

    const activateMatch = url.pathname.match(/^\/admin\/experts\/([^/]+)\/activate$/u);
    if (request.method === "POST" && activateMatch?.[1]) {
      const did = decodeDid(decodeURIComponent(activateMatch[1]));
      const input = decodeSetExpertActiveInput(await readBodyText(request));
      const result = await runWithLayer(
        Effect.flatMap(ExpertRegistryService, (registry) =>
          registry.setExpertActive(identity, did, input)
        )
      );
      return json(result);
    }
  } catch (error) {
    if (error instanceof AdminRequestParseError) {
      return badRequest(error.message);
    }

    return respondToAdminError(error);
  }

  return notFound();
};

export const handleAdminRequest = (
  request: Request,
  env: EnvBindings,
  identity: AccessIdentity
) =>
  handleAdminRequestWithLayer(request, identity, makeAdminLayer(env));
