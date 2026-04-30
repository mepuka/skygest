import { Effect } from "effect";
import {
  type AccessIdentity,
  AuthService,
  InvalidOperatorSecretError,
  MissingOperatorScopeError,
  MissingOperatorSecretError
} from "../auth/AuthService";
import {
  DataLayerKind,
  forbiddenError,
  notFoundError,
  unauthorizedError
} from "../domain/api";
import { makeAuthLayer } from "../edge/Layer";
import { encodeJsonString, stringifyUnknown } from "../platform/Json";
import { type EnvBindings } from "../platform/Env";
import { Logging } from "../platform/Logging";
import { makeSharedRuntime } from "../platform/EffectRuntime";

const sharedAuthRuntime = makeSharedRuntime(makeAuthLayer);

const dataLayerKindPathPattern = DataLayerKind.literals.join("|");

type OperatorRequestPolicy = {
  readonly action: string | null;
  readonly scopes: ReadonlyArray<string>;
};

type BackgroundExecutionContext = Pick<ExecutionContext, "waitUntil">;

type DeniedOperatorRequestLogger = (
  request: Request,
  error: unknown
) => Promise<void>;

const isExpertActivatePath = (pathname: string) =>
  /^\/admin\/experts\/[^/]+\/activate$/u.test(pathname);

const isIngestRunItemsPath = (pathname: string) =>
  /^\/admin\/ingest\/runs\/[^/]+\/items$/u.test(pathname);

const isIngestRunPath = (pathname: string) =>
  /^\/admin\/ingest\/runs\/[^/]+$/u.test(pathname);

const isEnrichmentRunRetryPath = (pathname: string) =>
  /^\/admin\/enrichment\/runs\/[^/]+\/retry$/u.test(pathname);

const isEnrichmentRunPath = (pathname: string) =>
  /^\/admin\/enrichment\/runs\/[^/]+$/u.test(pathname);

const isDataLayerKindPath = (pathname: string) =>
  new RegExp(`^/admin/data-layer/(${dataLayerKindPathPattern})$`, "u").test(
    pathname
  );

const isDataLayerEntityPath = (pathname: string) =>
  new RegExp(
    `^/admin/data-layer/(${dataLayerKindPathPattern})/[^/]+$`,
    "u"
  ).test(pathname);

const isDataLayerAuditPath = (pathname: string) =>
  /^\/admin\/data-layer\/audit\/[^/]+$/u.test(pathname);

const operatorRequestPolicy = (request: Request): OperatorRequestPolicy => {
  const { pathname } = new URL(request.url);

  if (pathname === "/mcp") {
    return {
      action: "mcp_read",
      scopes: ["mcp:read"]
    };
  }

  if (request.method === "GET" && pathname === "/admin/experts") {
    return {
      action: "list_experts",
      scopes: ["experts:read"]
    };
  }

  if (request.method === "POST" && pathname === "/admin/experts") {
    return {
      action: "add_expert",
      scopes: ["experts:write"]
    };
  }

  if (request.method === "POST" && pathname === "/admin/curation/curate") {
    return {
      action: "curate_post",
      scopes: ["curation:write"]
    };
  }

  if (request.method === "POST" && isExpertActivatePath(pathname)) {
    return {
      action: "set_expert_active",
      scopes: ["experts:write"]
    };
  }

  if (request.method === "GET" && isIngestRunItemsPath(pathname)) {
    return {
      action: "list_ingest_run_items",
      scopes: ["ops:read"]
    };
  }

  if (request.method === "GET" && isIngestRunPath(pathname)) {
    return {
      action: "get_ingest_run",
      scopes: ["ops:read"]
    };
  }

  if (request.method === "GET" && pathname === "/admin/enrichment/runs") {
    return {
      action: "list_enrichment_runs",
      scopes: ["ops:read"]
    };
  }

  if (request.method === "GET" && isEnrichmentRunPath(pathname)) {
    return {
      action: "get_enrichment_run",
      scopes: ["ops:read"]
    };
  }

  if (request.method === "GET" && pathname === "/admin/ops/stats") {
    return {
      action: "ops_stats",
      scopes: ["ops:read"]
    };
  }

  if (request.method === "GET" && isDataLayerKindPath(pathname)) {
    return {
      action: "list_data_layer_entities",
      scopes: ["ops:read"]
    };
  }

  if (request.method === "GET" && isDataLayerEntityPath(pathname)) {
    return {
      action: "get_data_layer_entity",
      scopes: ["ops:read"]
    };
  }

  if (request.method === "GET" && isDataLayerAuditPath(pathname)) {
    return {
      action: "list_data_layer_audit",
      scopes: ["ops:read"]
    };
  }

  if (request.method === "POST" && isDataLayerKindPath(pathname)) {
    return {
      action: "create_data_layer_entity",
      scopes: ["ops:refresh"]
    };
  }

  if (request.method === "PUT" && isDataLayerEntityPath(pathname)) {
    return {
      action: "update_data_layer_entity",
      scopes: ["ops:refresh"]
    };
  }

  if (request.method === "DELETE" && isDataLayerEntityPath(pathname)) {
    return {
      action: "delete_data_layer_entity",
      scopes: ["ops:refresh"]
    };
  }

  if (request.method === "POST" && pathname === "/admin/ingest/poll") {
    return {
      action: "poll_ingest",
      scopes: ["ops:refresh"]
    };
  }

  if (request.method === "POST" && pathname === "/admin/ingest/backfill") {
    return {
      action: "backfill_ingest",
      scopes: ["ops:refresh"]
    };
  }

  if (request.method === "POST" && pathname === "/admin/ingest/reconcile") {
    return {
      action: "reconcile_ingest",
      scopes: ["ops:refresh"]
    };
  }

  if (request.method === "POST" && pathname === "/admin/ingest/repair") {
    return {
      action: "repair_ingest",
      scopes: ["ops:refresh"]
    };
  }

  if (request.method === "POST" && pathname === "/admin/enrichment/start") {
    return {
      action: "start_enrichment",
      scopes: ["ops:refresh"]
    };
  }

  if (request.method === "POST" && isEnrichmentRunRetryPath(pathname)) {
    return {
      action: "retry_enrichment",
      scopes: ["ops:refresh"]
    };
  }

  if (request.method === "POST" && pathname === "/admin/enrichment/repair") {
    return {
      action: "repair_enrichment",
      scopes: ["ops:refresh"]
    };
  }

  if (request.method === "POST" && pathname === "/admin/ops/migrate") {
    return {
      action: "ops_migrate",
      scopes: ["ops:refresh"]
    };
  }

  if (request.method === "POST" && pathname === "/admin/ops/bootstrap-experts") {
    return {
      action: "bootstrap_experts",
      scopes: ["ops:refresh"]
    };
  }

  if (request.method === "POST" && pathname === "/admin/ops/load-smoke-fixture") {
    return {
      action: "load_smoke_fixture",
      scopes: ["ops:refresh"]
    };
  }

  if (request.method === "POST" && pathname === "/admin/ops/refresh-profiles") {
    return {
      action: "refresh_profiles",
      scopes: ["ops:refresh"]
    };
  }

  if (request.method === "POST" && pathname === "/admin/ops/seed-publications") {
    return {
      action: "seed_publications",
      scopes: ["ops:refresh"]
    };
  }

  if (
    request.method === "POST" &&
    pathname === "/admin/ops/entity-reindex/drain"
  ) {
    return {
      action: "entity_reindex_drain",
      scopes: ["ops:refresh"]
    };
  }

  if (request.method === "POST" && pathname === "/admin/import/posts") {
    return { action: "import_posts", scopes: ["ops:refresh"] };
  }

  if (request.method === "POST" && pathname === "/admin/editorial/pick") {
    return { action: "submit_editorial_pick", scopes: ["editorial:write"] };
  }
  if (request.method === "POST" && pathname === "/admin/editorial/retract") {
    return { action: "retract_editorial_pick", scopes: ["editorial:write"] };
  }
  if (request.method === "GET" && pathname === "/admin/editorial/picks") {
    return { action: "list_editorial_picks", scopes: ["editorial:read"] };
  }

  return {
    action: null,
    scopes: []
  };
};

export const authorizeOperator = (
  request: Request,
  env: EnvBindings,
  requiredScopes: ReadonlyArray<string> = []
): Promise<AccessIdentity> =>
  sharedAuthRuntime.runScoped(
    env,
    Effect.gen(function* () {
      const auth = yield* AuthService;
      const identity = yield* auth.requireOperator(request.headers);

      if (requiredScopes.length > 0) {
        const missing = requiredScopes.filter(
          (scope) => !identity.scopes.includes(scope)
        );

        if (missing.length > 0) {
          return yield* new MissingOperatorScopeError({ missingScopes: missing });
        }
      }

      return identity;
    }),
    { operation: "authorizeOperator" }
  );

export const toAuthErrorResponse = (error: unknown) => {
  if (
    error instanceof MissingOperatorSecretError ||
    error instanceof InvalidOperatorSecretError
  ) {
    return new Response(
      encodeJsonString(unauthorizedError("unauthorized")),
      {
        status: 401,
        headers: {
          "content-type": "application/json"
        }
      }
    );
  }

  if (error instanceof MissingOperatorScopeError) {
    return new Response(
      encodeJsonString(forbiddenError("forbidden")),
      {
        status: 403,
        headers: {
          "content-type": "application/json"
        }
      }
    );
  }

  return new Response(
    encodeJsonString(unauthorizedError("unauthorized")),
    {
      status: 401,
      headers: {
        "content-type": "application/json"
      }
    }
  );
};

export const logDeniedOperatorRequest = async (
  request: Request,
  error: unknown
) => {
  const { action } = operatorRequestPolicy(request);
  if (action === null) {
    return;
  }

  const reason = error instanceof InvalidOperatorSecretError
    ? "invalid operator secret"
    : error instanceof MissingOperatorSecretError
      ? "missing operator secret"
      : error instanceof MissingOperatorScopeError
        ? `missing scopes: ${error.missingScopes.join(", ")}`
      : "missing or invalid bearer token";

  await Effect.runPromise(
    Effect.logWarning("operator request denied").pipe(
      Effect.annotateLogs({
        action,
        outcome: "failure",
        reason
      }),
      Effect.provide(Logging.layer)
    )
  );
};

export const scheduleDeniedOperatorRequestLog = (
  request: Request,
  error: unknown,
  ctx?: BackgroundExecutionContext,
  logger: DeniedOperatorRequestLogger = logDeniedOperatorRequest
) => {
  const { action } = operatorRequestPolicy(request);
  const task = logger(request, error).catch((logError) => {
    console.error(
      encodeJsonString({
        message: "operator denial log failed",
        action: action ?? "unknown",
        error: stringifyUnknown(logError)
      })
    );
  });

  if (ctx !== undefined) {
    ctx.waitUntil(task);
    return;
  }

  void task;
};

export const operatorRequestAction = (request: Request) =>
  operatorRequestPolicy(request).action;

export const requiredOperatorScopes = (
  request: Request
): ReadonlyArray<string> =>
  operatorRequestPolicy(request).scopes;

export const notFoundJsonResponse = () =>
  new Response(
    encodeJsonString(notFoundError("not found")),
    {
      status: 404,
      headers: {
        "content-type": "application/json"
      }
    }
  );

export const isStagingOpsPath = (pathname: string) =>
  pathname.startsWith("/admin/ops/");
