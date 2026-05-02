import * as HttpApi from "effect/unstable/httpapi/HttpApi";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";
import * as HttpApiEndpoint from "effect/unstable/httpapi/HttpApiEndpoint";
import * as HttpApiGroup from "effect/unstable/httpapi/HttpApiGroup";
import { SqlClient } from "effect/unstable/sql";
import { Effect, Layer } from "effect";
import { EntityProjectionDrainService } from "@skygest/ontology-store";
import type { AccessIdentity } from "../auth/AuthService";
import {
  AdminRequestSchemas,
  AdminResponseSchemas,
  ApiErrorSchemas,
  conflictError,
  notFoundError
} from "../domain/api";
import { CurationService } from "../services/CurationService";
import { ExpertRegistryService } from "../services/ExpertRegistryService";
import { EntityExpertBackfillService } from "../services/EntityExpertBackfillService";
import { EntityPostBackfillService } from "../services/EntityPostBackfillService";
import { EntityTopicBackfillService } from "../services/EntityTopicBackfillService";
import { EditorialService } from "../services/EditorialService";
import { EditorialPickBundleReadService } from "../services/EditorialPickBundleReadService";
import { StagingOpsService } from "../services/StagingOpsService";
import { PostImportService } from "../services/PostImportService";
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
        HttpApiEndpoint.get("list", "/admin/experts", {
          disableCodecs: true,
          query: AdminRequestSchemas.listExperts,
          success: AdminResponseSchemas.listExperts,
          error: ApiErrorSchemas
        })
      )
      .add(
        HttpApiEndpoint.post("add", "/admin/experts", {
          disableCodecs: true,
          payload: AdminRequestSchemas.addExpert,
          success: AdminResponseSchemas.addExpert,
          error: ApiErrorSchemas
        })
      )
      .add(
        HttpApiEndpoint.post("setActive", "/admin/experts/:did/activate", {
          disableCodecs: true,
          params: AdminRequestSchemas.expertPath,
          payload: AdminRequestSchemas.setExpertActive,
          success: AdminResponseSchemas.setExpertActive,
          error: ApiErrorSchemas
        })
      )
  )
  .add(
    HttpApiGroup.make("stagingOps")
      .add(
        HttpApiEndpoint.post("migrate", "/admin/ops/migrate", {
          disableCodecs: true,
          success: AdminResponseSchemas.migrate,
          error: ApiErrorSchemas
        })
      )
      .add(
        HttpApiEndpoint.post("bootstrapExperts", "/admin/ops/bootstrap-experts", {
          disableCodecs: true,
          success: AdminResponseSchemas.bootstrapExperts,
          error: ApiErrorSchemas
        })
      )
      .add(
        HttpApiEndpoint.post("loadSmokeFixture", "/admin/ops/load-smoke-fixture", {
          disableCodecs: true,
          success: AdminResponseSchemas.loadSmokeFixture,
          error: ApiErrorSchemas
        })
      )
      .add(
        HttpApiEndpoint.post("refreshProfiles", "/admin/ops/refresh-profiles", {
          disableCodecs: true,
          success: AdminResponseSchemas.refreshProfiles,
          error: ApiErrorSchemas
        })
      )
      .add(
        HttpApiEndpoint.post("seedPublications", "/admin/ops/seed-publications", {
          disableCodecs: true,
          success: AdminResponseSchemas.seedPublications,
          error: ApiErrorSchemas
        })
      )
      .add(
        HttpApiEndpoint.get("stats", "/admin/ops/stats", {
          disableCodecs: true,
          success: AdminResponseSchemas.stats,
          error: ApiErrorSchemas
        })
      )
      .add(
        HttpApiEndpoint.post("entityExpertsBackfill", "/admin/ops/entity-experts/backfill", {
          disableCodecs: true,
          payload: AdminRequestSchemas.entityExpertsBackfill,
          success: AdminResponseSchemas.entityExpertsBackfill,
          error: ApiErrorSchemas
        })
      )
      .add(
        HttpApiEndpoint.post("entityPostsBackfill", "/admin/ops/entity-posts/backfill", {
          disableCodecs: true,
          payload: AdminRequestSchemas.entityPostsBackfill,
          success: AdminResponseSchemas.entityPostsBackfill,
          error: ApiErrorSchemas
        })
      )
      .add(
        HttpApiEndpoint.post("entityTopicsBackfill", "/admin/ops/entity-topics/backfill", {
          disableCodecs: true,
          payload: AdminRequestSchemas.entityTopicsBackfill,
          success: AdminResponseSchemas.entityTopicsBackfill,
          error: ApiErrorSchemas
        })
      )
      .add(
        HttpApiEndpoint.post("entityReindexDrain", "/admin/ops/entity-reindex/drain", {
          disableCodecs: true,
          payload: AdminRequestSchemas.entityReindexDrain,
          success: AdminResponseSchemas.entityReindexDrain,
          error: ApiErrorSchemas
        })
      )
  )
  .add(
    HttpApiGroup.make("curation")
      .add(
        HttpApiEndpoint.post("curate", "/admin/curation/curate", {
          disableCodecs: true,
          payload: AdminRequestSchemas.curatePost,
          success: AdminResponseSchemas.curatePost,
          error: ApiErrorSchemas
        })
      )
  )
  .add(
    HttpApiGroup.make("editorial")
      .add(
        HttpApiEndpoint.post("submitPick", "/admin/editorial/pick", {
          disableCodecs: true,
          payload: AdminRequestSchemas.submitEditorialPick,
          success: AdminResponseSchemas.submitEditorialPick,
          error: ApiErrorSchemas
        })
      )
      .add(
        HttpApiEndpoint.post("retractPick", "/admin/editorial/retract", {
          disableCodecs: true,
          payload: AdminRequestSchemas.retractEditorialPick,
          success: AdminResponseSchemas.retractEditorialPick,
          error: ApiErrorSchemas
        })
      )
      .add(
        HttpApiEndpoint.get("listPicks", "/admin/editorial/picks", {
          disableCodecs: true,
          query: AdminRequestSchemas.listEditorialPicks,
          success: AdminResponseSchemas.listEditorialPicks,
          error: ApiErrorSchemas
        })
      )
      .add(
        HttpApiEndpoint.get("getPickBundle", "/admin/editorial/picks/:uri/bundle", {
          disableCodecs: true,
          params: AdminRequestSchemas.editorialPickBundlePath,
          success: AdminResponseSchemas.editorialPickBundle,
          error: ApiErrorSchemas
        })
      )
  )
  .add(
    HttpApiGroup.make("import")
      .add(
        HttpApiEndpoint.post("importPosts", "/admin/import/posts", {
          disableCodecs: true,
          payload: AdminRequestSchemas.importPosts,
          success: AdminResponseSchemas.importPosts,
          error: ApiErrorSchemas
        })
      )
  );

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

      if (isTaggedError(error, "EditorialPostNotFoundError")) {
        const postUri = getStringField(error, "postUri");
        return notFoundError(
          postUri === undefined ? "post not found" : `post not found: ${postUri}`
        );
      }

      if (isTaggedError(error, "EditorialPickNotFoundError")) {
        const postUri = getStringField(error, "postUri");
        return notFoundError(
          postUri === undefined
            ? "this URI is not a committed editorial pick; promote it via submit_editorial_pick first."
            : `this URI is not a committed editorial pick; promote it via submit_editorial_pick first: ${postUri}`
        );
      }

      if (isTaggedError(error, "EditorialPickNotReadyError")) {
        const postUri = getStringField(error, "postUri");
        const readiness = getStringField(error, "readiness");
        return conflictError(
          postUri === undefined || readiness === undefined
            ? "post enrichment is not complete; use get_post_enrichments to poll until readiness is complete."
            : `post enrichment is not complete for ${postUri} (readiness: ${readiness}); use get_post_enrichments to poll until readiness is complete.`
        );
      }

      if (isTaggedError(error, "CurationPostNotFoundError")) {
        const postUri = getStringField(error, "postUri");
        return notFoundError(
          postUri === undefined ? "post not found" : `post not found: ${postUri}`
        );
      }

      if (route === "/admin/curation/curate") {
        return toUpstreamFailure("failed to curate post")(error);
      }

      return toUpstreamFailure()(error);
    }
  });

const ensureStagingOpsEnabled = Effect.gen(function* () {
  const config = yield* AppConfig;

  if (config.enableStagingOps !== true) {
    return yield* Effect.fail(notFoundError("not found"));
  }
});

const withOptionalEntityDrain = <A extends { readonly queued: number }>(
  payload: {
    readonly drain?: boolean;
    readonly drainConcurrency?: number;
  },
  result: A
) =>
  Effect.gen(function* () {
    if (payload.drain !== true) {
      return { ...result, drain: null };
    }
    if (result.queued === 0) {
      return {
        ...result,
        drain: { pulled: 0, rendered: 0, failed: 0 }
      };
    }

    const drain = yield* EntityProjectionDrainService;
    const drainOptions =
      payload.drainConcurrency === undefined
        ? undefined
        : { concurrency: payload.drainConcurrency };
    const drainResult = yield* drain.drainNext(result.queued, drainOptions);
    return { ...result, drain: drainResult };
  });

// ---------------------------------------------------------------------------
// Import helpers
// ---------------------------------------------------------------------------

const AdminHandlers = Layer.mergeAll(
  HttpApiBuilder.group(AdminApi, "experts", (handlers) =>
    handlers
      .handle("list", ({ query: urlParams }) =>
        withAdminErrors("/admin/experts", ExpertRegistryService.use( (registry) =>
          registry.listExpertsPage(urlParams)
        ))
      )
      .handle("add", ({ payload }) =>
        withAdminErrors("/admin/experts", Effect.gen(function* () {
          const actor = yield* OperatorIdentity;
          const registry = yield* ExpertRegistryService;
          return yield* registry.addExpert(actor, payload);
        }))
      )
      .handle("setActive", ({ params: path, payload }) =>
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
      .handle("refreshProfiles", () =>
        withAdminErrors("/admin/ops/refresh-profiles", Effect.gen(function* () {
          yield* ensureStagingOpsEnabled;
          const actor = yield* OperatorIdentity;
          const ops = yield* StagingOpsService;
          return yield* ops.refreshProfiles(actor);
        }))
      )
      .handle("seedPublications", () =>
        withAdminErrors("/admin/ops/seed-publications", Effect.gen(function* () {
          yield* ensureStagingOpsEnabled;
          const actor = yield* OperatorIdentity;
          const ops = yield* StagingOpsService;
          return yield* ops.seedPublications(actor);
        }))
      )
      .handle("stats", () =>
        withAdminErrors("/admin/ops/stats", Effect.gen(function* () {
          yield* ensureStagingOpsEnabled;
          const sql = yield* SqlClient.SqlClient;
          const now = Date.now();
          const oneDayAgo = now - 86_400_000;

          const [experts, posts, curation, enrichment, lastIngest] = yield* Effect.all([
            sql<{ total: number; active: number }>`
              SELECT COUNT(*) as total, SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) as active FROM experts
            `.pipe(Effect.map((rows) => ({
              total: Number(rows[0]?.total ?? 0),
              active: Number(rows[0]?.active ?? 0)
            }))),
            sql<{ total: number; in_last_24h: number; with_links: number }>`
              SELECT COUNT(*) as total, SUM(CASE WHEN created_at > ${oneDayAgo} THEN 1 ELSE 0 END) as in_last_24h, SUM(CASE WHEN has_links = 1 THEN 1 ELSE 0 END) as with_links FROM posts WHERE status = 'active'
            `.pipe(Effect.map((rows) => ({
              total: Number(rows[0]?.total ?? 0),
              inLast24h: Number(rows[0]?.in_last_24h ?? 0),
              withLinks: Number(rows[0]?.with_links ?? 0)
            }))),
            sql<{ flagged: number; curated: number; rejected: number }>`
              SELECT SUM(CASE WHEN status = 'flagged' THEN 1 ELSE 0 END) as flagged, SUM(CASE WHEN status = 'curated' THEN 1 ELSE 0 END) as curated, SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected FROM post_curation
            `.pipe(Effect.map((rows) => ({
              flagged: Number(rows[0]?.flagged ?? 0),
              curated: Number(rows[0]?.curated ?? 0),
              rejected: Number(rows[0]?.rejected ?? 0)
            }))),
            sql<{ queued: number; running: number; complete: number; failed: number; needs_review: number }>`
              SELECT SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) as queued, SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as running, SUM(CASE WHEN status = 'complete' THEN 1 ELSE 0 END) as complete, SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed, SUM(CASE WHEN status = 'needs-review' THEN 1 ELSE 0 END) as needs_review FROM post_enrichment_runs
            `.pipe(Effect.map((rows) => ({
              queued: Number(rows[0]?.queued ?? 0),
              running: Number(rows[0]?.running ?? 0),
              complete: Number(rows[0]?.complete ?? 0),
              failed: Number(rows[0]?.failed ?? 0),
              needsReview: Number(rows[0]?.needs_review ?? 0)
            }))),
            sql<{ id: string; kind: string; status: string; started_at: number; finished_at: number | null; posts_seen: number; posts_stored: number }>`
              SELECT id, kind, status, started_at, finished_at, posts_seen, posts_stored FROM ingest_runs ORDER BY started_at DESC LIMIT 1
            `.pipe(Effect.map((rows) =>
              rows.length === 0 ? null : {
                runId: String(rows[0]!.id),
                kind: String(rows[0]!.kind),
                status: String(rows[0]!.status),
                startedAt: Number(rows[0]!.started_at),
                finishedAt: rows[0]!.finished_at === null ? null : Number(rows[0]!.finished_at),
                postsSeen: Number(rows[0]!.posts_seen),
                postsStored: Number(rows[0]!.posts_stored)
              }
            ))
          ], { concurrency: "unbounded" });

          return {
            timestamp: now,
            experts,
            posts,
            curation,
            enrichment,
            lastIngest
          };
        }))
      )
      .handle("entityExpertsBackfill", ({ payload }) =>
        withAdminErrors("/admin/ops/entity-experts/backfill", Effect.gen(function* () {
          yield* ensureStagingOpsEnabled;
          const backfill = yield* EntityExpertBackfillService;
          const backfillInput: {
            limit?: number;
            offset?: number;
            active?: boolean | null;
          } = {};
          if (payload.limit !== undefined) backfillInput.limit = payload.limit;
          if (payload.offset !== undefined) backfillInput.offset = payload.offset;
          if (payload.active !== undefined) backfillInput.active = payload.active;
          const result = yield* backfill.backfill(backfillInput);
          return yield* withOptionalEntityDrain(payload, result);
        }))
      )
      .handle("entityPostsBackfill", ({ payload }) =>
        withAdminErrors("/admin/ops/entity-posts/backfill", Effect.gen(function* () {
          yield* ensureStagingOpsEnabled;
          const backfill = yield* EntityPostBackfillService;
          const backfillInput: { limit?: number; offset?: number } = {};
          if (payload.limit !== undefined) backfillInput.limit = payload.limit;
          if (payload.offset !== undefined) backfillInput.offset = payload.offset;
          const result = yield* backfill.backfill(backfillInput);
          return yield* withOptionalEntityDrain(payload, result);
        }))
      )
      .handle("entityTopicsBackfill", ({ payload }) =>
        withAdminErrors("/admin/ops/entity-topics/backfill", Effect.gen(function* () {
          yield* ensureStagingOpsEnabled;
          const backfill = yield* EntityTopicBackfillService;
          const backfillInput: { limit?: number; offset?: number } = {};
          if (payload.limit !== undefined) backfillInput.limit = payload.limit;
          if (payload.offset !== undefined) backfillInput.offset = payload.offset;
          const result = yield* backfill.backfill(backfillInput);
          return yield* withOptionalEntityDrain(payload, result);
        }))
      )
      .handle("entityReindexDrain", ({ payload }) =>
        withAdminErrors("/admin/ops/entity-reindex/drain", Effect.gen(function* () {
          yield* ensureStagingOpsEnabled;
          const drain = yield* EntityProjectionDrainService;
          const drainOptions =
            payload.concurrency === undefined
              ? undefined
              : { concurrency: payload.concurrency };
          return yield* drain.drainNext(payload.limit ?? 25, drainOptions);
        }))
      )
  ),
  HttpApiBuilder.group(AdminApi, "curation", (handlers) =>
    handlers.handle("curate", ({ payload }) =>
      withAdminErrors("/admin/curation/curate", Effect.gen(function* () {
        const actor = yield* OperatorIdentity;
        const curation = yield* CurationService;
        return yield* curation.curatePost(
          payload,
          actor.email ?? actor.subject ?? "operator"
        );
      }))
    )
  ),
  HttpApiBuilder.group(AdminApi, "editorial", (handlers) =>
    handlers
      .handle("submitPick", ({ payload }) =>
        withAdminErrors("/admin/editorial/pick", Effect.gen(function* () {
          const actor = yield* OperatorIdentity;
          const editorial = yield* EditorialService;
          return yield* editorial.submitPick(
            payload,
            actor.email ?? actor.subject ?? "operator"
          );
        }))
      )
      .handle("retractPick", ({ payload }) =>
        withAdminErrors("/admin/editorial/retract", Effect.gen(function* () {
          const editorial = yield* EditorialService;
          return yield* editorial.retractPick(payload.postUri);
        }))
      )
      .handle("listPicks", ({ query: urlParams }) =>
        withAdminErrors("/admin/editorial/picks", Effect.gen(function* () {
          const editorial = yield* EditorialService;
          const items = yield* editorial.listPicks(urlParams);
          return { items };
        }))
      )
      .handle("getPickBundle", ({ params: path }) =>
        withAdminErrors("/admin/editorial/picks/:uri/bundle", Effect.gen(function* () {
          const bundles = yield* EditorialPickBundleReadService;
          return yield* bundles.getBundle(path.uri);
        }))
      )
  ),
  HttpApiBuilder.group(AdminApi, "import", (handlers) =>
    handlers.handle("importPosts", ({ payload }) =>
      withAdminErrors("/admin/import/posts", Effect.gen(function* () {
        const actor = yield* OperatorIdentity;
        const postImport = yield* PostImportService;
        return yield* postImport.importPosts(actor, payload);
      }))
    )
  )
);

const makeAdminApiLayer = (serviceLayer: Layer.Layer<any, any, never>) =>
  (() => {
    const handlersLayer = AdminHandlers.pipe(
      Layer.provideMerge(serviceLayer)
    );

    return HttpApiBuilder.layer(AdminApi).pipe(
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
