import { Effect, Layer } from "effect";
import {
  AuthService,
  type AccessIdentity,
  ForbiddenAccessJwtError,
  InvalidAccessJwtError,
  InvalidOperatorSecretError,
  InvalidAuthConfigError,
  MissingAccessJwtError,
  MissingOperatorSecretError
} from "../auth/AuthService";
import { handleAdminRequest } from "../admin/Router";
import { handleMcpRequest } from "../mcp/Router";
import { AppConfig } from "../platform/Config";
import { CloudflareEnv, type EnvBindings } from "../platform/Env";
import { Logging } from "../platform/Logging";

const authLayer = (env: EnvBindings) =>
  (() => {
    const baseLayer = Layer.mergeAll(
      CloudflareEnv.layer(env),
      Logging.layer
    );
    const configLayer = AppConfig.layer.pipe(Layer.provideMerge(baseLayer));

    return AuthService.layer.pipe(
      Layer.provideMerge(Layer.mergeAll(baseLayer, configLayer))
    );
  })();

const authorize = (
  request: Request,
  env: EnvBindings,
  requiredScopes: ReadonlyArray<string> = []
) =>
  Effect.gen(function* () {
    const auth = yield* AuthService;
    return yield* (
      requiredScopes.length === 0
        ? auth.requireOperator(request.headers)
        : auth.requireOperatorScopes(request.headers, requiredScopes)
    );
  }).pipe(Effect.provide(authLayer(env)));

const toAuthErrorResponse = (error: unknown) => {
  if (
    error instanceof MissingAccessJwtError ||
    error instanceof InvalidAccessJwtError ||
    error instanceof MissingOperatorSecretError ||
    error instanceof InvalidOperatorSecretError
  ) {
    return new Response("unauthorized", { status: 401 });
  }

  if (error instanceof ForbiddenAccessJwtError) {
    return new Response("forbidden", { status: 403 });
  }

  if (error instanceof InvalidAuthConfigError) {
    return new Response("invalid auth config", { status: 500 });
  }

  return new Response("internal error", { status: 500 });
};

const adminMutationAction = (request: Request): string | null => {
  const url = new URL(request.url);

  if (request.method !== "POST") {
    return null;
  }

  if (url.pathname === "/admin/experts") {
    return "add_expert";
  }

  if (/^\/admin\/experts\/[^/]+\/activate$/u.test(url.pathname)) {
    return "set_expert_active";
  }

  if (url.pathname === "/admin/shards/refresh") {
    return "refresh_shards";
  }

  if (url.pathname === "/admin/ops/migrate") {
    return "ops_migrate";
  }

  if (url.pathname === "/admin/ops/bootstrap-experts") {
    return "bootstrap_experts";
  }

  if (url.pathname === "/admin/ops/load-smoke-fixture") {
    return "load_smoke_fixture";
  }

  return null;
};

const logDeniedAdminMutation = async (request: Request, error: unknown) => {
  const action = adminMutationAction(request);
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
    Effect.logWarning("expert registry mutation").pipe(
      Effect.annotateLogs({
        action,
        outcome: "failure",
        reason
      }),
      Effect.provide(Logging.layer)
    )
  );
};

const requiredAdminScopes = (request: Request): ReadonlyArray<string> => {
  const url = new URL(request.url);

  if (request.method === "POST" && url.pathname === "/admin/experts") {
    return ["experts:write"];
  }

  if (request.method === "POST" && /^\/admin\/experts\/[^/]+\/activate$/u.test(url.pathname)) {
    return ["experts:write"];
  }

  if (request.method === "POST" && url.pathname === "/admin/shards/refresh") {
    return ["ops:refresh"];
  }

  if (request.method === "POST" && url.pathname.startsWith("/admin/ops/")) {
    return ["ops:refresh"];
  }

  return [];
};

const isSharedSecretMode = (env: EnvBindings) =>
  env.OPERATOR_AUTH_MODE === "shared-secret";

const isStagingOpsPath = (pathname: string) =>
  pathname.startsWith("/admin/ops/");

export const fetch = async (request: Request, env: EnvBindings) => {
  const url = new URL(request.url);

  if (url.pathname === "/health") {
    return new Response("ok");
  }

  if (url.pathname === "/mcp") {
    try {
      await Effect.runPromise(authorize(request, env));
    } catch (error) {
      return toAuthErrorResponse(error);
    }

    return handleMcpRequest(request, env);
  }

  if (url.pathname.startsWith("/admin")) {
    if (isStagingOpsPath(url.pathname) && !isSharedSecretMode(env)) {
      return new Response("not found", { status: 404 });
    }

    let identity: AccessIdentity;

    try {
      identity = await Effect.runPromise(
        authorize(request, env, requiredAdminScopes(request))
      );
    } catch (error) {
      await logDeniedAdminMutation(request, error);
      return toAuthErrorResponse(error);
    }

    return handleAdminRequest(request, env, identity);
  }

  return new Response("not found", { status: 404 });
};

export default { fetch };
