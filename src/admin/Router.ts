import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint";
import * as HttpApiGroup from "@effect/platform/HttpApiGroup";
import { Effect, Layer } from "effect";
import type { AccessIdentity } from "../auth/AuthService";
import {
  AdminRequestSchemas,
  AdminResponseSchemas,
  BadRequestError,
  ConflictError,
  ForbiddenError,
  InternalServerError,
  notFoundError,
  NotFoundError,
  ServiceUnavailableError,
  UnauthorizedError,
  UpstreamFailureError
} from "../domain/api";
import { ExpertRegistryService } from "../services/ExpertRegistryService";
import { StagingOpsService } from "../services/StagingOpsService";
import { AppConfig } from "../platform/Config";
import { OperatorIdentity, operatorIdentityContext } from "../http/Identity";
import { handleWithApiLayer, makeCachedApiHandler } from "../http/ApiSupport";
import { getStringField, isTaggedError, toUpstreamFailure, withHttpErrorMapping } from "../http/ErrorMapping";
import { makeAdminWorkerLayer } from "../edge/Layer";
import type { EnvBindings } from "../platform/Env";

const AdminApi = HttpApi.make("admin")
  .add(
    HttpApiGroup.make("experts")
      .add(
        HttpApiEndpoint.get("list", "/admin/experts")
          .setUrlParams(AdminRequestSchemas.listExperts)
          .addSuccess(AdminResponseSchemas.listExperts)
      )
      .add(
        HttpApiEndpoint.post("add", "/admin/experts")
          .setPayload(AdminRequestSchemas.addExpert)
          .addSuccess(AdminResponseSchemas.addExpert)
      )
      .add(
        HttpApiEndpoint.post("setActive", "/admin/experts/:did/activate")
          .setPath(AdminRequestSchemas.expertPath)
          .setPayload(AdminRequestSchemas.setExpertActive)
          .addSuccess(AdminResponseSchemas.setExpertActive)
      )
  )
  .add(
    HttpApiGroup.make("stagingOps")
      .add(
        HttpApiEndpoint.post("migrate", "/admin/ops/migrate")
          .addSuccess(AdminResponseSchemas.migrate)
      )
      .add(
        HttpApiEndpoint.post("bootstrapExperts", "/admin/ops/bootstrap-experts")
          .addSuccess(AdminResponseSchemas.bootstrapExperts)
      )
      .add(
        HttpApiEndpoint.post("loadSmokeFixture", "/admin/ops/load-smoke-fixture")
          .addSuccess(AdminResponseSchemas.loadSmokeFixture)
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

const withAdminErrors = <A, R>(
  route: string,
  effect: Effect.Effect<A, unknown, R>
) =>
  withHttpErrorMapping(effect, {
    route,
    classify: (error) => {
      if (isTaggedError(error, "ExpertNotFoundError")) {
        const did = getStringField(error, "did");
        return notFoundError(
          did === undefined ? "expert not found" : `expert not found: ${did}`
        );
      }

      return toUpstreamFailure()(error);
    }
  });

const ensureStagingOpsEnabled = Effect.gen(function* () {
  const config = yield* AppConfig;

  if (config.operatorAuthMode !== "shared-secret") {
    return yield* Effect.fail(notFoundError("not found"));
  }
});

const AdminHandlers = Layer.mergeAll(
  HttpApiBuilder.group(AdminApi, "experts", (handlers) =>
    handlers
      .handle("list", ({ urlParams }) =>
        withAdminErrors("/admin/experts", Effect.flatMap(ExpertRegistryService, (registry) =>
          registry.listExperts(urlParams)
        )).pipe(
          Effect.map((items) => ({ items }))
        )
      )
      .handle("add", ({ payload }) =>
        withAdminErrors("/admin/experts", Effect.gen(function* () {
          const actor = yield* OperatorIdentity;
          const registry = yield* ExpertRegistryService;
          return yield* registry.addExpert(actor, payload);
        }))
      )
      .handle("setActive", ({ path, payload }) =>
        withAdminErrors("/admin/experts/:did/activate", Effect.gen(function* () {
          const actor = yield* OperatorIdentity;
          const registry = yield* ExpertRegistryService;
          return yield* registry.setExpertActive(actor, path.did, payload);
        }))
      )
  ),
  HttpApiBuilder.group(AdminApi, "stagingOps", (handlers) =>
    handlers
      .handle("migrate", () =>
        withAdminErrors("/admin/ops/migrate", Effect.gen(function* () {
          yield* ensureStagingOpsEnabled;
          const actor = yield* OperatorIdentity;
          const ops = yield* StagingOpsService;
          return yield* ops.migrate(actor);
        }))
      )
      .handle("bootstrapExperts", () =>
        withAdminErrors("/admin/ops/bootstrap-experts", Effect.gen(function* () {
          yield* ensureStagingOpsEnabled;
          const actor = yield* OperatorIdentity;
          const ops = yield* StagingOpsService;
          return yield* ops.bootstrapExperts(actor);
        }))
      )
      .handle("loadSmokeFixture", () =>
        withAdminErrors("/admin/ops/load-smoke-fixture", Effect.gen(function* () {
          yield* ensureStagingOpsEnabled;
          const actor = yield* OperatorIdentity;
          const ops = yield* StagingOpsService;
          return yield* ops.loadSmokeFixture(actor);
        }))
      )
  )
);

const makeAdminApiLayer = (serviceLayer: Layer.Layer<any, any, never>) =>
  (() => {
    const handlersLayer = AdminHandlers.pipe(
      Layer.provideMerge(serviceLayer)
    );

    return HttpApiBuilder.api(AdminApi).pipe(
      Layer.provideMerge(handlersLayer)
    );
  })();

const handleCachedAdminRequest = makeCachedApiHandler(
  (env: EnvBindings) =>
    makeAdminApiLayer(makeAdminWorkerLayer(env))
);

export const handleAdminRequestWithLayer = (
  request: Request,
  identity: AccessIdentity,
  layer: Layer.Layer<any, any, never>
) =>
  handleWithApiLayer(
    request,
    makeAdminApiLayer(layer),
    operatorIdentityContext(identity)
  );

export const handleAdminRequest = (
  request: Request,
  env: EnvBindings,
  identity: AccessIdentity
) =>
  handleCachedAdminRequest(
    request,
    env,
    operatorIdentityContext(identity)
  );
