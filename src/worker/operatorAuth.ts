import { Effect } from "effect";
import {
  type AccessIdentity,
  AuthService,
  ForbiddenAccessJwtError,
  InvalidAccessJwtError,
  InvalidAuthConfigError,
  InvalidOperatorSecretError,
  MissingAccessJwtError,
  MissingOperatorSecretError
} from "../auth/AuthService";
import {
  forbiddenError,
  internalServerError,
  notFoundError,
  unauthorizedError
} from "../domain/api";
import { makeAuthLayer } from "../edge/Layer";
import { encodeJsonString } from "../platform/Json";
import { type EnvBindings } from "../platform/Env";
import { Logging } from "../platform/Logging";
import { makeSharedRuntime } from "../platform/EffectRuntime";

const sharedAuthRuntime = makeSharedRuntime(makeAuthLayer);

type OperatorRequestPolicy = {
  readonly action: string | null;
  readonly scopes: ReadonlyArray<string>;
};

const isExpertActivatePath = (pathname: string) =>
  /^\/admin\/experts\/[^/]+\/activate$/u.test(pathname);

const isIngestRunItemsPath = (pathname: string) =>
  /^\/admin\/ingest\/runs\/[^/]+\/items$/u.test(pathname);

const isIngestRunPath = (pathname: string) =>
  /^\/admin\/ingest\/runs\/[^/]+$/u.test(pathname);

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
      return yield* (
        requiredScopes.length === 0
          ? auth.requireOperator(request.headers)
          : auth.requireOperatorScopes(request.headers, requiredScopes)
      );
    }),
    { operation: "authorizeOperator" }
  );

export const toAuthErrorResponse = (error: unknown) => {
  if (
    error instanceof MissingAccessJwtError ||
    error instanceof InvalidAccessJwtError ||
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

  if (error instanceof ForbiddenAccessJwtError) {
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

  if (error instanceof InvalidAuthConfigError) {
    return new Response(
      encodeJsonString(internalServerError("invalid auth config")),
      {
        status: 500,
        headers: {
          "content-type": "application/json"
        }
      }
    );
  }

  return new Response(
    encodeJsonString(internalServerError("internal error")),
    {
      status: 500,
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

  const reason = error instanceof ForbiddenAccessJwtError
    ? error.reason
    : error instanceof InvalidAccessJwtError
      ? error.message
      : error instanceof InvalidOperatorSecretError
        ? "invalid operator secret"
        : error instanceof InvalidAuthConfigError
          ? `missing ${error.missing}`
          : error instanceof MissingOperatorSecretError
            ? "missing operator secret"
            : "missing or invalid access token";

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

export const isSharedSecretMode = (env: EnvBindings) =>
  env.OPERATOR_AUTH_MODE === "shared-secret";

export const isStagingOpsPath = (pathname: string) =>
  pathname.startsWith("/admin/ops/");
