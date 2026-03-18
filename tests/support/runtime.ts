import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { SqliteClient } from "@effect/sql-sqlite-node";
import { Effect, Layer, Schema } from "effect";
import { energySeedDid, energySeedManifest } from "../../src/bootstrap/CheckedInExpertSeeds";
import { bootstrapExperts } from "../../src/bootstrap/ExpertSeeds";
import { BlueskyClient, layer as BlueskyClientLayer } from "../../src/bluesky/BlueskyClient";
import { runMigrations } from "../../src/db/migrate";
import { CandidatePayloadService } from "../../src/services/CandidatePayloadService";
import { RawEventBatch } from "../../src/domain/types";
import { processBatch } from "../../src/filter/FilterWorker";
import { callTool, listTools, type McpToolCall } from "../../src/mcp/Client";
import { handleMcpRequestWithLayer } from "../../src/mcp/Router";
import { AppConfig, type AppConfigShape } from "../../src/platform/Config";
import { EditorialService } from "../../src/services/EditorialService";
import { OntologyCatalog } from "../../src/services/OntologyCatalog";
import { PostHydrationService } from "../../src/services/PostHydrationService";
import { KnowledgeQueryService } from "../../src/services/KnowledgeQueryService";
import { CurationService } from "../../src/services/CurationService";
import { CandidatePayloadRepoD1 } from "../../src/services/d1/CandidatePayloadRepoD1";
import { CurationRepoD1 } from "../../src/services/d1/CurationRepoD1";
import { EditorialRepoD1 } from "../../src/services/d1/EditorialRepoD1";
import { ExpertsRepoD1 } from "../../src/services/d1/ExpertsRepoD1";
import { KnowledgeRepoD1 } from "../../src/services/d1/KnowledgeRepoD1";
import { PublicationsRepoD1 } from "../../src/services/d1/PublicationsRepoD1";
import { makeSmokeFixtureBatch } from "../../src/staging/SmokeFixture";

export const testConfig = (
  overrides: Partial<AppConfigShape> = {}
): AppConfigShape => ({
  publicApi: "https://public.api.bsky.app",
  ingestShardCount: 1,
  defaultDomain: "energy",
  mcpLimitDefault: 20,
  mcpLimitMax: 100,
  operatorAuthMode: "access",
  operatorSecret: "",
  accessTeamDomain: "https://access.example.com",
  accessAud: "skygest-mcp",
  editorialDefaultExpiryHours: 24,
  curationMinSignalScore: 30,
  ...overrides
});

export const seedManifest = energySeedManifest;
export const sampleDid = energySeedDid;

export const makeSqliteLayer = (filename = ":memory:") =>
  SqliteClient.layer({ filename });

export const makeBiLayer = (options?: {
  readonly filename?: string;
  readonly config?: Partial<AppConfigShape>;
  readonly blueskyClient?: Layer.Layer<BlueskyClient>;
}) => {
  const sqliteLayer = makeSqliteLayer(options?.filename);
  const configLayer = Layer.succeed(AppConfig, testConfig(options?.config));
  const expertsLayer = ExpertsRepoD1.layer.pipe(Layer.provideMerge(sqliteLayer));
  const knowledgeLayer = KnowledgeRepoD1.layer.pipe(Layer.provideMerge(sqliteLayer));

  const publicationsLayer = PublicationsRepoD1.layer.pipe(Layer.provideMerge(sqliteLayer));
  const candidatePayloadRepoLayer = CandidatePayloadRepoD1.layer.pipe(
    Layer.provideMerge(sqliteLayer)
  );
  const curationRepoLayer = CurationRepoD1.layer.pipe(
    Layer.provideMerge(sqliteLayer)
  );
  const editorialRepoLayer = EditorialRepoD1.layer.pipe(Layer.provideMerge(sqliteLayer));
  const ontologyLayer = OntologyCatalog.layer;
  const baseLayer = Layer.mergeAll(
    sqliteLayer,
    configLayer,
    ontologyLayer,
    expertsLayer,
    knowledgeLayer,
    publicationsLayer,
    candidatePayloadRepoLayer,
    curationRepoLayer,
    editorialRepoLayer
  );

  const editorialServiceLayer = EditorialService.layer.pipe(
    Layer.provideMerge(Layer.mergeAll(editorialRepoLayer, configLayer, ontologyLayer))
  );

  const blueskyLayer = options?.blueskyClient ?? BlueskyClientLayer.pipe(
    Layer.provideMerge(Layer.mergeAll(sqliteLayer, configLayer))
  );
  const postHydrationLayer = PostHydrationService.layer.pipe(
    Layer.provideMerge(blueskyLayer)
  );

  const candidatePayloadServiceLayer = CandidatePayloadService.layer.pipe(
    Layer.provideMerge(candidatePayloadRepoLayer)
  );

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

  return Layer.mergeAll(
    baseLayer,
    postHydrationLayer,
    KnowledgeQueryService.layer.pipe(Layer.provideMerge(baseLayer)),
    editorialServiceLayer,
    candidatePayloadServiceLayer,
    curationServiceLayer,
    blueskyLayer
  );
};

export const makeSampleBatch = (did = sampleDid) =>
  Schema.decodeUnknownSync(RawEventBatch)(makeSmokeFixtureBatch(did));

export const makeDeleteBatch = (
  did = sampleDid,
  uri = `at://${did}/app.bsky.feed.post/post-solar`
) =>
  Schema.decodeUnknownSync(RawEventBatch)({
    cursor: 1_710_000_002_000_000,
    events: [
      {
        kind: "commit",
        operation: "delete",
        collection: "app.bsky.feed.post",
        did,
        uri,
        cid: "cid-solar",
        timeUs: 1_710_000_002_000_000
      }
    ]
  });

export const seedKnowledgeBase = () =>
  Effect.gen(function* () {
    yield* runMigrations;
    yield* bootstrapExperts(seedManifest, 1, 1_710_000_000_000);
    yield* processBatch(makeSampleBatch());
  });

export const withTempSqliteFile = <A>(
  f: (filename: string) => Promise<A>
) => {
  const filename = join("/tmp", `skygest-bi-${randomUUID()}.sqlite`);

  return f(filename).finally(() => {
    rmSync(filename, { force: true });
  });
};

export const createMcpClient = async (layer: Layer.Layer<any, any, never>) => {
  const baseUrl = new URL("https://skygest.local");
  const localFetch = ((input, init) => {
    const request = input instanceof Request
      ? new Request(input, init)
      : new Request(input.toString(), init);
    return handleMcpRequestWithLayer(request, layer);
  }) as typeof globalThis.fetch;

  return {
    client: {
      listTools: () =>
        Effect.runPromise(
          listTools({
            baseUrl,
            fetch: localFetch,
            clientName: "skygest-bi-tests",
            clientVersion: "0.1.0"
          })
        ),
      callTool: (input: McpToolCall) =>
        Effect.runPromise(
          callTool(
            {
              baseUrl,
              fetch: localFetch,
              clientName: "skygest-bi-tests",
              clientVersion: "0.1.0"
            },
            input
          )
        )
    },
    close: async () => {}
  };
};
