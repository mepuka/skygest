import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint";
import * as HttpApiGroup from "@effect/platform/HttpApiGroup";
import { SqlClient } from "@effect/sql";
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
import type { ImportPostInput, ImportExpertInput } from "../domain/api";
import type { KnowledgePost, ExpertRecord, LinkRecord } from "../domain/bi";
import { CurationService } from "../services/CurationService";
import { ExpertRegistryService } from "../services/ExpertRegistryService";
import { EditorialService } from "../services/EditorialService";
import { StagingOpsService } from "../services/StagingOpsService";
import { ExpertsRepo } from "../services/ExpertsRepo";
import { KnowledgeRepo } from "../services/KnowledgeRepo";
import { CandidatePayloadService } from "../services/CandidatePayloadService";
import { matchTopics } from "../filter/TopicMatcher";
import { computeShard } from "../bootstrap/ExpertSeeds";
import { AppConfig } from "../platform/Config";
import { OperatorIdentity, operatorIdentityContext } from "../http/Identity";
import { handleWithApiLayer, makeCachedApiHandler } from "../http/ApiSupport";
import { getStringField, isTaggedError, toUpstreamFailure, withHttpErrorMapping } from "../http/ErrorMapping";
import { makeAdminWorkerLayer } from "../edge/Layer";
import { parseAvatarUrl } from "../bluesky/BskyCdn";
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
      .add(
        HttpApiEndpoint.post("refreshProfiles", "/admin/ops/refresh-profiles")
          .addSuccess(AdminResponseSchemas.refreshProfiles)
      )
      .add(
        HttpApiEndpoint.post("seedPublications", "/admin/ops/seed-publications")
          .addSuccess(AdminResponseSchemas.seedPublications)
      )
      .add(
        HttpApiEndpoint.get("stats", "/admin/ops/stats")
          .addSuccess(AdminResponseSchemas.stats)
      )
  )
  .add(
    HttpApiGroup.make("curation")
      .add(
        HttpApiEndpoint.post("curate", "/admin/curation/curate")
          .setPayload(AdminRequestSchemas.curatePost)
          .addSuccess(AdminResponseSchemas.curatePost)
      )
  )
  .add(
    HttpApiGroup.make("editorial")
      .add(
        HttpApiEndpoint.post("submitPick", "/admin/editorial/pick")
          .setPayload(AdminRequestSchemas.submitEditorialPick)
          .addSuccess(AdminResponseSchemas.submitEditorialPick)
      )
      .add(
        HttpApiEndpoint.post("retractPick", "/admin/editorial/retract")
          .setPayload(AdminRequestSchemas.retractEditorialPick)
          .addSuccess(AdminResponseSchemas.retractEditorialPick)
      )
      .add(
        HttpApiEndpoint.get("listPicks", "/admin/editorial/picks")
          .setUrlParams(AdminRequestSchemas.listEditorialPicks)
          .addSuccess(AdminResponseSchemas.listEditorialPicks)
      )
  )
  .add(
    HttpApiGroup.make("import")
      .add(
        HttpApiEndpoint.post("importPosts", "/admin/import/posts")
          .setPayload(AdminRequestSchemas.importPosts)
          .addSuccess(AdminResponseSchemas.importPosts)
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

      if (isTaggedError(error, "EditorialPostNotFoundError")) {
        const postUri = getStringField(error, "postUri");
        return notFoundError(
          postUri === undefined ? "post not found" : `post not found: ${postUri}`
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

// ---------------------------------------------------------------------------
// Import helpers
// ---------------------------------------------------------------------------

const importExpertToRecord = (
  expert: ImportExpertInput,
  shardCount: number,
  addedAt: number
): ExpertRecord => ({
  did: expert.did,
  handle: expert.handle,
  displayName: expert.displayName ?? null,
  description: null,
  avatar: expert.avatar ? parseAvatarUrl(expert.avatar) : null,
  domain: expert.domain,
  source: expert.source,
  sourceRef: null,
  shard: computeShard(expert.did, shardCount),
  active: false,
  tier: expert.tier,
  addedAt,
  lastSyncedAt: null
});

const mergeImportedExpertRecord = (
  imported: ImportExpertInput,
  existing: ExpertRecord | undefined,
  shardCount: number,
  addedAt: number
): ExpertRecord =>
  existing === undefined
    ? importExpertToRecord(imported, shardCount, addedAt)
    : {
        ...existing,
        handle: imported.handle,
        displayName: imported.displayName ?? existing.displayName,
        avatar: imported.avatar ? parseAvatarUrl(imported.avatar) : existing.avatar
      };

const importLinkToLinkRecord = (
  link: ImportPostInput["links"][number],
  indexedAt: number
): LinkRecord => ({
  url: link.url,
  title: link.title ?? null,
  description: link.description ?? null,
  imageUrl: null,
  domain: link.domain ?? null,
  extractedAt: indexedAt
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
      .handle("listPicks", ({ urlParams }) =>
        withAdminErrors("/admin/editorial/picks", Effect.gen(function* () {
          const editorial = yield* EditorialService;
          const items = yield* editorial.listPicks(urlParams);
          return { items };
        }))
      )
  ),
  HttpApiBuilder.group(AdminApi, "import", (handlers) =>
    handlers.handle("importPosts", ({ payload }) =>
      withAdminErrors("/admin/import/posts", Effect.gen(function* () {
        const config = yield* AppConfig;
        const expertsRepo = yield* ExpertsRepo;
        const knowledgeRepo = yield* KnowledgeRepo;
        const curationService = yield* CurationService;
        const payloadService = yield* CandidatePayloadService;

        const now = Date.now();

        // 1. Insert new experts; preserve existing activation/tier/editorial metadata
        if (payload.experts.length > 0) {
          const existingExperts = yield* expertsRepo.getByDids(
            [...new Set(payload.experts.map((expert) => expert.did))]
          );
          const existingByDid = new Map(existingExperts.map((expert) => [expert.did, expert]));
          const expertRecords = payload.experts.map((expert) =>
            mergeImportedExpertRecord(
              expert,
              existingByDid.get(expert.did),
              config.ingestShardCount,
              now
            )
          );
          yield* expertsRepo.upsertMany(expertRecords);
        }

        // 2. For each post: run matchTopics — skip if no topics
        const importedPosts: KnowledgePost[] = [];
        let skipped = 0;

        for (const post of payload.posts) {
          const links = post.links.map((l) => importLinkToLinkRecord(l, now));
          const topics = yield* matchTopics({
            text: post.text,
            links,
            hashtags: post.hashtags ?? []
          });

          if (topics.length === 0) {
            skipped += 1;
            continue;
          }

          // 3. Build KnowledgePost
          const knowledgePost: KnowledgePost = {
            uri: post.uri,
            did: post.did,
            cid: null,
            text: post.text,
            createdAt: post.createdAt,
            indexedAt: now,
            hasLinks: links.length > 0,
            status: "active",
            ingestId: `import:${post.uri}:${String(now)}`,
            embedType: post.embedType ?? null,
            topics,
            links
          };

          importedPosts.push(knowledgePost);
        }

        // Upsert all imported posts
        if (importedPosts.length > 0) {
          yield* knowledgeRepo.upsertPosts(importedPosts);
        }

        // 4. Store embed payloads for posts that have them
        for (const post of payload.posts) {
          // Only store for posts that survived topic matching
          const wasImported = importedPosts.some((ip) => ip.uri === post.uri);
          if (!wasImported) continue;

          // Posts with null/undefined embedPayload get NO payload row
          const embedPayload = post.embedPayload ?? null;
          if (embedPayload === null) continue;

          yield* payloadService.capturePayload({
            postUri: post.uri,
            captureStage: "candidate",
            embedType: post.embedType ?? null,
            embedPayload
          }).pipe(
            Effect.tapError((e) =>
              Effect.logWarning("import payload save failed").pipe(
                Effect.annotateLogs({ postUri: post.uri, error: String(e) })
              )
            )
          );
        }

        // 5. Flag all imported posts via CurationService.flagBatch (error-tolerant)
        let flagged = 0;
        if (importedPosts.length > 0) {
          flagged = yield* curationService.flagBatch(importedPosts).pipe(
            Effect.tapError((e) =>
              Effect.logWarning("import curation flagging failed, continuing").pipe(
                Effect.annotateLogs({ error: String(e) })
              )
            ),
            Effect.catchAll(() => Effect.succeed(0))
          );
        }

        // 6. Return summary
        return {
          imported: importedPosts.length,
          flagged,
          skipped
        };
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
