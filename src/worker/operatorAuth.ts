import { Effect, Layer } from "effect";
import {
  AuthService,
  ForbiddenAccessJwtError,
  InvalidAccessJwtError,
  InvalidAuthConfigError,
  InvalidOperatorSecretError,
  MissingAccessJwtError,
  MissingOperatorSecretError
} from "../auth/AuthService";
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

export const authorizeOperator = (
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

export const toAuthErrorResponse = (error: unknown) => {
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

  if (url.pathname === "/admin/ingest/poll") {
    return "poll_ingest";
  }

  if (url.pathname === "/admin/ingest/backfill") {
    return "backfill_ingest";
  }

  if (url.pathname === "/admin/ingest/reconcile") {
    return "reconcile_ingest";
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

export const logDeniedAdminMutation = async (request: Request, error: unknown) => {
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
    Effect.logWarning("operator mutation denied").pipe(
      Effect.annotateLogs({
        action,
        outcome: "failure",
        reason
      }),
      Effect.provide(Logging.layer)
    )
  );
};

export const requiredAdminScopes = (request: Request): ReadonlyArray<string> => {
  const url = new URL(request.url);

  if (request.method === "POST" && url.pathname === "/admin/experts") {
    return ["experts:write"];
  }

  if (request.method === "POST" && /^\/admin\/experts\/[^/]+\/activate$/u.test(url.pathname)) {
    return ["experts:write"];
  }

  if (request.method === "POST" && url.pathname.startsWith("/admin/ingest/")) {
    return ["ops:refresh"];
  }

  if (request.method === "POST" && url.pathname.startsWith("/admin/ops/")) {
    return ["ops:refresh"];
  }

  return [];
};

export const isSharedSecretMode = (env: EnvBindings) =>
  env.OPERATOR_AUTH_MODE === "shared-secret";

export const isStagingOpsPath = (pathname: string) =>
  pathname.startsWith("/admin/ops/");
