import { Effect, Layer } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { handleAdminRequestWithLayer } from "../src/admin/Router";
import type { AccessIdentity } from "../src/auth/AuthService";
import { BlueskyClient } from "../src/bluesky/BlueskyClient";
import { parseAvatarUrl } from "../src/bluesky/BskyCdn";
import { decodeCallToolResultWith } from "../src/mcp/Client";
import { KnowledgePostsMcpOutput, ExpertListMcpOutput } from "../src/mcp/OutputSchemas";
import { AppConfig, type AppConfigShape } from "../src/platform/Config";
import { encodeJsonString } from "../src/platform/Json";
import { Logging } from "../src/platform/Logging";
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
  testConfig,
  withTempSqliteFile
} from "./support/runtime";

const decodeSearchResponse = decodeCallToolResultWith(KnowledgePostsMcpOutput);
const decodeExpertsResponse = decodeCallToolResultWith(ExpertListMcpOutput);

const operatorIdentity: AccessIdentity = {
  subject: "staging-shared-secret-operator",
  email: "staging-operator@skygest.local",
  issuer: "shared-secret",
  audience: [],
  scopes: ["experts:write", "ops:refresh"],
  payload: {
    sub: "staging-shared-secret-operator",
    email: "staging-operator@skygest.local",
    iss: "shared-secret",
    aud: []
  }
};

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
}) => {
  const sqliteLayer = makeSqliteLayer(options.filename);
  const configLayer = Layer.succeed(AppConfig, testConfig({
    operatorAuthMode: "shared-secret",
    operatorSecret: "stage-secret",
    ...options.config
  }));
  const ontologyLayer = OntologyCatalog.layer;
  const expertsLayer = ExpertsRepoD1.layer.pipe(Layer.provideMerge(sqliteLayer));
  const knowledgeLayer = KnowledgeRepoD1.layer.pipe(Layer.provideMerge(sqliteLayer));
  const blueskyLayer = Layer.succeed(BlueskyClient, {
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
        configLayer
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
  it.live("returns 404 for staging ops routes when shared-secret mode is disabled", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeStagingAdminLayer({
          filename,
          config: { operatorAuthMode: "access", operatorSecret: "" }
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
    )
  );
});
