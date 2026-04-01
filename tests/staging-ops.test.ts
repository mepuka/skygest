import { Effect, Layer, Redacted } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { handleAdminRequestWithLayer } from "../src/admin/Router";
import type { AccessIdentity } from "../src/auth/AuthService";
import { BlueskyClient } from "../src/bluesky/BlueskyClient";
import { parseAvatarUrl } from "../src/bluesky/BskyCdn";
import { BlueskyApiError } from "../src/domain/errors";
import { defaultSchemaVersionForEnrichmentKind } from "../src/domain/enrichment";
import { EnrichmentWorkflowLauncher } from "../src/enrichment/EnrichmentWorkflowLauncher";
import { decodeCallToolResultWith } from "../src/mcp/Client";
import { KnowledgePostsMcpOutput, ExpertListMcpOutput } from "../src/mcp/OutputSchemas";
import { AppConfig, type AppConfigShape } from "../src/platform/Config";
import { encodeJsonString } from "../src/platform/Json";
import { Logging } from "../src/platform/Logging";
import { CurationRepo } from "../src/services/CurationRepo";
import { ExpertRegistryService } from "../src/services/ExpertRegistryService";
import { CurationService } from "../src/services/CurationService";
import { CandidatePayloadService } from "../src/services/CandidatePayloadService";
import { OntologyCatalog } from "../src/services/OntologyCatalog";
import { StagingOpsService } from "../src/services/StagingOpsService";
import { CandidatePayloadRepoD1 } from "../src/services/d1/CandidatePayloadRepoD1";
import { CurationRepoD1 } from "../src/services/d1/CurationRepoD1";
import { ExpertsRepoD1 } from "../src/services/d1/ExpertsRepoD1";
import { KnowledgeRepoD1 } from "../src/services/d1/KnowledgeRepoD1";
import { PublicationsRepoD1 } from "../src/services/d1/PublicationsRepoD1";
import { smokeFixtureUris } from "../src/staging/SmokeFixture";
import {
  createMcpClient,
  makeBiLayer,
  makeSqliteLayer,
  sampleDid,
  seedKnowledgeBase,
  testConfig,
  withTempSqliteFile
} from "./support/runtime";

const decodeSearchResponse = decodeCallToolResultWith(KnowledgePostsMcpOutput);
const decodeExpertsResponse = decodeCallToolResultWith(ExpertListMcpOutput);

const operatorIdentity: AccessIdentity = {
  subject: "operator",
  email: "staging-operator@skygest.local",
  scopes: ["experts:write", "curation:write", "ops:refresh"]
};

const makeThreadNode = (
  uri: string,
  opts?: {
    readonly embed?: unknown;
  }
) => ({
  $type: "app.bsky.feed.defs#threadViewPost",
  post: {
    uri,
    cid: `cid-${uri}`,
    author: {
      did: sampleDid,
      handle: "seed.example.com",
      displayName: "Seed Expert"
    },
    record: {
      text: `Thread ${uri}`,
      createdAt: "2026-03-18T12:00:00.000Z",
      $type: "app.bsky.feed.post"
    },
    ...(opts?.embed === undefined ? {} : { embed: opts.embed }),
    replyCount: 0,
    repostCount: 1,
    likeCount: 2,
    quoteCount: 0,
    indexedAt: "2026-03-18T12:05:00.000Z"
  }
});

const expectJsonResponse = async <A>(
  response: Response,
  expectedStatus = 200
): Promise<A> => {
  const text = await response.text();

  if (response.status !== expectedStatus) {
    throw new Error(`expected ${String(expectedStatus)} but received ${String(response.status)}: ${text}`);
  }

  return JSON.parse(text) as A;
};

const makeStagingAdminLayer = (options: {
  readonly filename: string;
  readonly config?: Partial<AppConfigShape>;
  readonly blueskyClient?: Layer.Layer<BlueskyClient>;
  readonly enrichmentLauncher?: Layer.Layer<EnrichmentWorkflowLauncher>;
}) => {
  const sqliteLayer = makeSqliteLayer(options.filename);
  const configLayer = Layer.succeed(AppConfig, testConfig({
    enableStagingOps: true,
    operatorSecret: Redacted.make("stage-secret"),
    ...options.config
  }));
  const ontologyLayer = OntologyCatalog.layer;
  const expertsLayer = ExpertsRepoD1.layer.pipe(Layer.provideMerge(sqliteLayer));
  const knowledgeLayer = KnowledgeRepoD1.layer.pipe(Layer.provideMerge(sqliteLayer));
  const blueskyLayer = options.blueskyClient ?? Layer.succeed(BlueskyClient, {
    resolveDidOrHandle: (input: string) =>
      Effect.succeed({
        did: sampleDid,
        handle: input
      }),
    getProfile: (didOrHandle: string) =>
      Effect.succeed({
        did: didOrHandle.startsWith("did:") ? sampleDid : sampleDid,
        handle: didOrHandle.startsWith("did:") ? "seed.example.com" : didOrHandle,
        displayName: "Seed Expert",
        description: "Seeded profile",
        avatar: parseAvatarUrl("https://cdn.bsky.app/img/avatar/plain/did:plc:test/cid@jpeg")
      }),
    getFollows: () =>
      Effect.succeed({
        dids: [],
        cursor: null
      }),
    resolveRepoService: () => Effect.succeed("https://pds.example.com"),
    listRecordsAtService: () =>
      Effect.succeed({
        records: [],
        cursor: null
      }),
    getPostThread: () => Effect.succeed({ thread: {} }),
    getPosts: () => Effect.succeed([])
  });
  const publicationsLayer = PublicationsRepoD1.layer.pipe(Layer.provideMerge(sqliteLayer));
  const candidatePayloadRepoLayer = CandidatePayloadRepoD1.layer.pipe(
    Layer.provideMerge(sqliteLayer)
  );
  const candidatePayloadServiceLayer = CandidatePayloadService.layer.pipe(
    Layer.provideMerge(candidatePayloadRepoLayer)
  );
  const curationRepoLayer = CurationRepoD1.layer.pipe(Layer.provideMerge(sqliteLayer));
  const curationServiceLayer = CurationService.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        curationRepoLayer,
        expertsLayer,
        publicationsLayer,
        candidatePayloadServiceLayer,
        blueskyLayer,
        configLayer,
        ...(options.enrichmentLauncher === undefined ? [] : [options.enrichmentLauncher])
      )
    )
  );
  const baseLayer = Layer.mergeAll(
    sqliteLayer,
    configLayer,
    Logging.layer,
    ontologyLayer,
    expertsLayer,
    knowledgeLayer,
    publicationsLayer,
    blueskyLayer,
    candidatePayloadRepoLayer,
    candidatePayloadServiceLayer,
    curationRepoLayer,
    curationServiceLayer
  );

  const registryLayer = ExpertRegistryService.layer.pipe(Layer.provideMerge(baseLayer));
  const stagingDeps = Layer.mergeAll(baseLayer, registryLayer);

  return Layer.mergeAll(
    baseLayer,
    registryLayer,
    StagingOpsService.layer.pipe(Layer.provideMerge(stagingDeps))
  );
};

describe("staging admin ops routes", () => {
  it.live("returns 404 for staging ops routes when enableStagingOps is disabled", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeStagingAdminLayer({
          filename,
          config: { enableStagingOps: false, operatorSecret: Redacted.make("") }
        });

        const response = await handleAdminRequestWithLayer(
          new Request("https://skygest.local/admin/ops/migrate", {
            method: "POST",
            body: encodeJsonString({})
          }),
          operatorIdentity,
          layer
        );
        const body = await expectJsonResponse<{
          readonly error: string;
          readonly message: string;
        }>(response, 404);

        expect(response.status).toBe(404);
        expect(body).toEqual({
          error: "NotFound",
          message: "not found"
        });
      })
    )
  );

  it.live("migrates, bootstraps experts, loads the smoke fixture, and serves it through MCP", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeStagingAdminLayer({
          filename,
          config: { ingestShardCount: 2 }
        });

        const migrateResponse = await handleAdminRequestWithLayer(
          new Request("https://skygest.local/admin/ops/migrate", {
            method: "POST",
            body: encodeJsonString({})
          }),
          operatorIdentity,
          layer
        );
        const bootstrapResponse = await handleAdminRequestWithLayer(
          new Request("https://skygest.local/admin/ops/bootstrap-experts", {
            method: "POST",
            body: encodeJsonString({})
          }),
          operatorIdentity,
          layer
        );
        const fixtureResponse = await handleAdminRequestWithLayer(
          new Request("https://skygest.local/admin/ops/load-smoke-fixture", {
            method: "POST",
            body: encodeJsonString({})
          }),
          operatorIdentity,
          layer
        );

        const migrateBody = await expectJsonResponse<{ readonly ok: true }>(migrateResponse);
        const bootstrapBody = await expectJsonResponse<{
          readonly domain: string;
          readonly count: number;
        }>(bootstrapResponse);
        const fixtureBody = await expectJsonResponse<{
          readonly posts: number;
          readonly links: number;
          readonly topics: number;
        }>(fixtureResponse);

        const { client, close } = await createMcpClient(
          makeBiLayer({
            filename,
            config: { ingestShardCount: 2 }
          })
        );

	        try {
	          const search = await client.callTool({
	            name: "search_posts",
	            arguments: { query: "solar" }
	          });
          const experts = await client.callTool({
	            name: "list_experts",
	            arguments: { domain: "energy" }
	          });
	          const searchItems = decodeSearchResponse(search);
	          const expertItems = decodeExpertsResponse(experts);

          expect(migrateBody.ok).toBe(true);
          expect(bootstrapBody.domain).toBe("energy");
          expect(bootstrapBody.count).toBeGreaterThan(0);
          expect(fixtureBody.posts).toBe(2);
          expect(fixtureBody.links).toBe(2);
          expect(fixtureBody.topics).toBeGreaterThan(0);
	          expect(searchItems.items.some((item) => item.uri === smokeFixtureUris()[0])).toBe(true);
	          expect(expertItems.items.length).toBeGreaterThan(0);
        } finally {
          await close();
        }
      })
    ),
    15_000
  );

  it.live("curates a post through the admin route, captures payloads, and attempts enrichment launch", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const postUri = smokeFixtureUris(sampleDid)[0]!;
        const launchCalls: Array<unknown> = [];
        const blueskyLayer = Layer.succeed(BlueskyClient, {
          resolveDidOrHandle: () => Effect.die("unexpected resolveDidOrHandle"),
          getProfile: () => Effect.die("unexpected getProfile"),
          getFollows: () => Effect.die("unexpected getFollows"),
          resolveRepoService: () => Effect.die("unexpected resolveRepoService"),
          listRecordsAtService: () => Effect.die("unexpected listRecordsAtService"),
          getPostThread: () =>
            Effect.succeed({
              thread: makeThreadNode(postUri, {
                embed: {
                  $type: "app.bsky.embed.images#view",
                  images: [
                    {
                      thumb: "https://cdn.bsky.app/img/feed_thumbnail/plain/did/image@jpeg",
                      fullsize: "https://cdn.bsky.app/img/feed_fullsize/plain/did/image@jpeg",
                      alt: "Chart image"
                    }
                  ]
                }
              })
            }),
          getPosts: () => Effect.succeed([])
        });
        const launcherLayer = Layer.succeed(EnrichmentWorkflowLauncher, {
          start: () => Effect.die("unexpected start"),
          startIfAbsent: (params) =>
            Effect.sync(() => {
              launchCalls.push(params);
              return true;
            })
        });
        const layer = makeStagingAdminLayer({
          filename,
          blueskyClient: blueskyLayer,
          enrichmentLauncher: launcherLayer
        });

        await Effect.runPromise(
          seedKnowledgeBase().pipe(
            Effect.provide(
              makeBiLayer({
                filename,
                config: { enableStagingOps: true, operatorSecret: Redacted.make("stage-secret") },
                blueskyClient: blueskyLayer
              })
            )
          )
        );

        const response = await handleAdminRequestWithLayer(
          new Request("https://skygest.local/admin/curation/curate", {
            method: "POST",
            headers: {
              "content-type": "application/json"
            },
            body: encodeJsonString({ postUri, action: "curate" })
          }),
          operatorIdentity,
          layer
        );
        const body = await expectJsonResponse<{
          readonly previousStatus: string | null;
          readonly newStatus: string;
        }>(response);

        const inspection = await Effect.runPromise(
          Effect.gen(function* () {
            const payloads = yield* CandidatePayloadService;
            const curation = yield* CurationRepo;
            return {
              payload: yield* payloads.getPayload(postUri as any),
              record: yield* curation.getByPostUri(postUri)
            };
          }).pipe(Effect.provide(layer))
        );

        expect(body.previousStatus).toBe("flagged");
        expect(body.newStatus).toBe("curated");
        expect(inspection.record?.status).toBe("curated");
        expect(inspection.payload?.captureStage).toBe("picked");
        expect(inspection.payload?.embedType).toBe("img");
        expect(launchCalls).toEqual([
          {
            postUri,
            enrichmentType: "vision",
            schemaVersion: defaultSchemaVersionForEnrichmentKind("vision"),
            triggeredBy: "pick",
            requestedBy: operatorIdentity.email
          }
        ]);
      })
    )
  );

  it.live("rejects a post through the admin route without capturing payloads or queuing enrichment", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const postUri = smokeFixtureUris(sampleDid)[0]!;
        const launchCalls: Array<unknown> = [];
        const layer = makeStagingAdminLayer({
          filename,
          enrichmentLauncher: Layer.succeed(EnrichmentWorkflowLauncher, {
            start: () => Effect.die("unexpected start"),
            startIfAbsent: (params) =>
              Effect.sync(() => {
                launchCalls.push(params);
                return true;
              })
          })
        });

        await Effect.runPromise(
          seedKnowledgeBase().pipe(
            Effect.provide(
              makeBiLayer({
                filename,
                config: { enableStagingOps: true, operatorSecret: Redacted.make("stage-secret") }
              })
            )
          )
        );

        const response = await handleAdminRequestWithLayer(
          new Request("https://skygest.local/admin/curation/curate", {
            method: "POST",
            headers: {
              "content-type": "application/json"
            },
            body: encodeJsonString({ postUri, action: "reject", note: "duplicate" })
          }),
          operatorIdentity,
          layer
        );
        const body = await expectJsonResponse<{
          readonly previousStatus: string | null;
          readonly newStatus: string;
        }>(response);

        const inspection = await Effect.runPromise(
          Effect.gen(function* () {
            const payloads = yield* CandidatePayloadService;
            const curation = yield* CurationRepo;
            return {
              payload: yield* payloads.getPayload(postUri as any),
              record: yield* curation.getByPostUri(postUri)
            };
          }).pipe(Effect.provide(layer))
        );

        expect(body.previousStatus).toBe("flagged");
        expect(body.newStatus).toBe("rejected");
        expect(inspection.record?.status).toBe("rejected");
        expect(inspection.record?.reviewNote).toBe("duplicate");
        expect(inspection.payload).toBeNull();
        expect(launchCalls).toEqual([]);
      })
    )
  );

  it.live("returns 404 when curating a post that does not exist locally", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeStagingAdminLayer({ filename });

        await Effect.runPromise(
          seedKnowledgeBase().pipe(
            Effect.provide(
              makeBiLayer({
                filename,
                config: { enableStagingOps: true, operatorSecret: Redacted.make("stage-secret") }
              })
            )
          )
        );

        const response = await handleAdminRequestWithLayer(
          new Request("https://skygest.local/admin/curation/curate", {
            method: "POST",
            headers: {
              "content-type": "application/json"
            },
            body: encodeJsonString({
              postUri: `at://${sampleDid}/app.bsky.feed.post/missing`,
              action: "curate"
            })
          }),
          operatorIdentity,
          layer
        );
        const body = await expectJsonResponse<{
          readonly error: string;
          readonly message: string;
        }>(response, 404);

        expect(body).toEqual({
          error: "NotFound",
          message: `post not found: at://${sampleDid}/app.bsky.feed.post/missing`
        });
      })
    )
  );

  it.live("returns 502 when Bluesky curation fetch fails", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const postUri = smokeFixtureUris(sampleDid)[0]!;
        const blueskyLayer = Layer.succeed(BlueskyClient, {
          resolveDidOrHandle: () => Effect.die("unexpected resolveDidOrHandle"),
          getProfile: () => Effect.die("unexpected getProfile"),
          getFollows: () => Effect.die("unexpected getFollows"),
          resolveRepoService: () => Effect.die("unexpected resolveRepoService"),
          listRecordsAtService: () => Effect.die("unexpected listRecordsAtService"),
          getPostThread: () =>
            Effect.fail(BlueskyApiError.make({
              message: "boom"
            })),
          getPosts: () => Effect.succeed([])
        });
        const layer = makeStagingAdminLayer({
          filename,
          blueskyClient: blueskyLayer
        });

        await Effect.runPromise(
          seedKnowledgeBase().pipe(
            Effect.provide(
              makeBiLayer({
                filename,
                config: { enableStagingOps: true, operatorSecret: Redacted.make("stage-secret") },
                blueskyClient: blueskyLayer
              })
            )
          )
        );

        const response = await handleAdminRequestWithLayer(
          new Request("https://skygest.local/admin/curation/curate", {
            method: "POST",
            headers: {
              "content-type": "application/json"
            },
            body: encodeJsonString({ postUri, action: "curate" })
          }),
          operatorIdentity,
          layer
        );
        const body = await expectJsonResponse<{
          readonly error: string;
          readonly message: string;
          readonly retryable?: boolean;
        }>(response, 502);

        expect(body).toEqual({
          error: "UpstreamFailure",
          message: "failed to curate post",
          retryable: true
        });
      })
    )
  );
});
