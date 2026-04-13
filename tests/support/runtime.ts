import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { SqliteClient } from "@effect/sql-sqlite-node";
import { Effect, Layer, Redacted, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { d1DataLayerRegistryLayer } from "../../src/bootstrap/D1DataLayerRegistry";
import { energySeedDid, energySeedManifest } from "../../src/bootstrap/CheckedInExpertSeeds";
import { bootstrapExperts } from "../../src/bootstrap/ExpertSeeds";
import { BlueskyClient, layer as BlueskyClientLayer } from "../../src/bluesky/BlueskyClient";
import { runMigrations } from "../../src/db/migrate";
import { CandidatePayloadService } from "../../src/services/CandidatePayloadService";
import { DataRefQueryService } from "../../src/services/DataRefQueryService";
import { EditorialScore } from "../../src/domain/editorial";
import { PostUri, RawEventBatch } from "../../src/domain/types";
import { processBatch } from "../../src/filter/FilterWorker";
import { callTool, listTools, listPrompts, type McpToolCall } from "../../src/mcp/Client";
import { handleMcpRequestWithLayer, createPersistentMcpHandler } from "../../src/mcp/Router";
import { AppConfig, type AppConfigShape } from "../../src/platform/Config";
import { EditorialPickBundleReadService } from "../../src/services/EditorialPickBundleReadService";
import { EditorialService } from "../../src/services/EditorialService";
import { ExpertRegistryService } from "../../src/services/ExpertRegistryService";
import { OntologyCatalog } from "../../src/services/OntologyCatalog";
import { PostImportService } from "../../src/services/PostImportService";
import { PostHydrationService } from "../../src/services/PostHydrationService";
import { KnowledgeQueryService } from "../../src/services/KnowledgeQueryService";
import { CurationService } from "../../src/services/CurationService";
import { CandidatePayloadRepoD1 } from "../../src/services/d1/CandidatePayloadRepoD1";
import { DataLayerReposD1 } from "../../src/services/d1/DataLayerReposD1";
import { DataRefCandidateReadRepoD1 } from "../../src/services/d1/DataRefCandidateReadRepoD1";
import { PostEnrichmentReadService } from "../../src/services/PostEnrichmentReadService";
import { CurationRepoD1 } from "../../src/services/d1/CurationRepoD1";
import { EditorialRepoD1 } from "../../src/services/d1/EditorialRepoD1";
import { ExpertsRepoD1 } from "../../src/services/d1/ExpertsRepoD1";
import { KnowledgeRepoD1 } from "../../src/services/d1/KnowledgeRepoD1";
import { PipelineStatusRepoD1 } from "../../src/services/d1/PipelineStatusRepoD1";
import { PostEnrichmentReadRepoD1 } from "../../src/services/d1/PostEnrichmentReadRepoD1";
import { PublicationsRepoD1 } from "../../src/services/d1/PublicationsRepoD1";
import { PodcastRepoD1 } from "../../src/services/d1/PodcastRepoD1";
import { ProviderRegistry } from "../../src/services/ProviderRegistry";
import { PipelineStatusService } from "../../src/services/PipelineStatusService";
import { makeSmokeFixtureBatch } from "../../src/staging/SmokeFixture";
import type { AccessIdentity } from "../../src/auth/AuthService";

export const readOnlyIdentity: AccessIdentity = {
  subject: "test-reader",
  email: null,
  scopes: ["mcp:read"]
};

export const workflowIdentity: AccessIdentity = {
  subject: "test-operator",
  email: "op@test.com",
  scopes: ["mcp:read", "curation:write", "editorial:write", "experts:read", "experts:write", "ops:read", "ops:refresh", "editorial:read"]
};

export const workflowWriteIdentity: AccessIdentity = {
  subject: "test-workflow-writer",
  email: "workflow@test.com",
  scopes: ["mcp:read", "curation:write", "editorial:write"]
};

export const expertsWriteIdentity: AccessIdentity = {
  subject: "test-expert-writer",
  email: "experts@test.com",
  scopes: ["mcp:read", "experts:write"]
};

export const opsReadIdentity: AccessIdentity = {
  subject: "test-ops-reader",
  email: "ops@test.com",
  scopes: ["mcp:read", "ops:read"]
};

export const opsExpertsWriteIdentity: AccessIdentity = {
  subject: "test-ops-expert-writer",
  email: "ops-experts@test.com",
  scopes: ["mcp:read", "experts:write", "ops:read"]
};

export const opsCurationWriteIdentity: AccessIdentity = {
  subject: "test-ops-curator",
  email: "ops-curation@test.com",
  scopes: ["mcp:read", "curation:write", "ops:read"]
};

export const opsEditorialWriteIdentity: AccessIdentity = {
  subject: "test-ops-editor",
  email: "ops-editorial@test.com",
  scopes: ["mcp:read", "editorial:write", "ops:read"]
};

export const opsRefreshIdentity: AccessIdentity = {
  subject: "test-import-operator",
  email: "ops-import@test.com",
  scopes: ["mcp:read", "ops:refresh"]
};

export const testConfig = (
  overrides: Partial<AppConfigShape> = {}
): AppConfigShape => ({
  publicApi: "https://public.api.bsky.app",
  ingestShardCount: 1,
  defaultDomain: "energy",
  mcpLimitDefault: 20,
  mcpLimitMax: 100,
  operatorSecret: Redacted.make(""),
  enableStagingOps: false,
  enableDataRefResolution: false,
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
}): Layer.Layer<any, any, never> => {
  const sqliteLayer = makeSqliteLayer(options?.filename);
  const configLayer = Layer.succeed(AppConfig, testConfig(options?.config));
  const expertsLayer = ExpertsRepoD1.layer.pipe(Layer.provideMerge(sqliteLayer));
  const knowledgeLayer = KnowledgeRepoD1.layer.pipe(Layer.provideMerge(sqliteLayer));

  const publicationsLayer = PublicationsRepoD1.layer.pipe(Layer.provideMerge(sqliteLayer));
  const podcastLayer = PodcastRepoD1.layer.pipe(Layer.provideMerge(sqliteLayer));
  const candidatePayloadRepoLayer = CandidatePayloadRepoD1.layer.pipe(
    Layer.provideMerge(sqliteLayer)
  );
  const dataLayerReposLayer = DataLayerReposD1.layer.pipe(
    Layer.provideMerge(sqliteLayer)
  );
  const dataRefCandidateReadRepoLayer = DataRefCandidateReadRepoD1.layer.pipe(
    Layer.provideMerge(sqliteLayer)
  );
  const postEnrichmentReadRepoLayer = PostEnrichmentReadRepoD1.layer.pipe(
    Layer.provideMerge(sqliteLayer)
  );
  const pipelineStatusRepoLayer = PipelineStatusRepoD1.layer.pipe(
    Layer.provideMerge(sqliteLayer)
  );
  const curationRepoLayer = CurationRepoD1.layer.pipe(
    Layer.provideMerge(sqliteLayer)
  );
  const editorialRepoLayer = EditorialRepoD1.layer.pipe(Layer.provideMerge(sqliteLayer));
  const ontologyLayer = OntologyCatalog.layer;
  const providerRegistryLayer = ProviderRegistry.layer;
  const baseLayer = Layer.mergeAll(
    sqliteLayer,
    configLayer,
    ontologyLayer,
    providerRegistryLayer,
    expertsLayer,
    knowledgeLayer,
    publicationsLayer,
    podcastLayer,
    candidatePayloadRepoLayer,
    dataLayerReposLayer,
    dataRefCandidateReadRepoLayer,
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
        providerRegistryLayer,
        candidatePayloadServiceLayer,
        blueskyLayer,
        configLayer
      )
    )
  );
  const postImportServiceLayer = PostImportService.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        configLayer,
        ontologyLayer,
        expertsLayer,
        knowledgeLayer,
        candidatePayloadServiceLayer,
        curationServiceLayer
      )
    )
  );
  const registryLayer = ExpertRegistryService.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(configLayer, expertsLayer, blueskyLayer, ontologyLayer)
    )
  );

  const enrichmentReadServiceLayer = PostEnrichmentReadService.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(candidatePayloadServiceLayer, postEnrichmentReadRepoLayer)
    )
  );
  const editorialPickBundleReadServiceLayer = EditorialPickBundleReadService.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        editorialRepoLayer,
        candidatePayloadServiceLayer,
        enrichmentReadServiceLayer,
        expertsLayer
      )
    )
  );
  const pipelineStatusServiceLayer = PipelineStatusService.layer.pipe(
    Layer.provideMerge(pipelineStatusRepoLayer)
  );
  return Layer.mergeAll(
    baseLayer,
    postHydrationLayer,
    KnowledgeQueryService.layer.pipe(Layer.provideMerge(baseLayer)),
    editorialServiceLayer,
    editorialPickBundleReadServiceLayer,
    candidatePayloadServiceLayer,
    curationServiceLayer,
    blueskyLayer,
    enrichmentReadServiceLayer,
    pipelineStatusServiceLayer,
    postImportServiceLayer,
    registryLayer
  );
};

export const withDataRefQueryService = (
  layer: Layer.Layer<any, any, never>
): Layer.Layer<any, any, never> => {
  const dataLayerRegistryLayer = d1DataLayerRegistryLayer().pipe(
    Layer.provideMerge(layer)
  );
  const dataRefQueryServiceLayer = DataRefQueryService.layer.pipe(
    Layer.provideMerge(Layer.mergeAll(layer, dataLayerRegistryLayer))
  );

  return Layer.mergeAll(layer, dataRefQueryServiceLayer);
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

export const makeSourceAttributionEnrichmentPayload = () => ({
  kind: "source-attribution" as const,
  provider: {
    providerId: "ercot",
    providerLabel: "ERCOT",
    sourceFamily: "Load"
  },
  contentSource: {
    url: "https://example.com/grid-report",
    title: "Grid report",
    domain: "example.com",
    publication: "Example"
  },
  resolution: "matched" as const,
  providerCandidates: [],
  socialProvenance: {
    did: sampleDid,
    handle: "seed.example.com"
  },
  processedAt: 20
});

export const makeVisionEnrichmentPayload = () => ({
  kind: "vision" as const,
  summary: {
    text: "Bar chart of ERCOT load by month.",
    mediaTypes: ["chart"] as const,
    chartTypes: ["bar-chart"] as const,
    titles: ["ERCOT load"],
    keyFindings: [
      {
        text: "Load rises through summer.",
        assetKeys: ["embed:0:https://cdn.bsky.app/full-1.jpg"]
      }
    ]
  },
  assets: [
    {
      assetKey: "embed:0:https://cdn.bsky.app/full-1.jpg",
      assetType: "image" as const,
      source: "embed" as const,
      index: 0,
      originalAltText: null,
      extractionRoute: "full" as const,
      analysis: {
        mediaType: "chart" as const,
        chartTypes: ["bar-chart"] as const,
        altText: "Bar chart of ERCOT load by month.",
        altTextProvenance: "synthetic" as const,
        xAxis: { label: "Month", unit: null },
        yAxis: { label: "Load", unit: "GW" },
        series: [{ legendLabel: "Load", unit: "GW" }],
        sourceLines: [{ sourceText: "Source: ERCOT", datasetName: null }],
        temporalCoverage: {
          startDate: "2024-01",
          endDate: "2024-12"
        },
        keyFindings: ["Load rises through summer."],
        visibleUrls: [],
        organizationMentions: [],
        logoText: [],
        title: "ERCOT load",
        modelId: "gemini-2.5-flash",
        processedAt: 10
      }
    }
  ],
  modelId: "gemini-2.5-flash",
  promptVersion: "v2.0.0",
  processedAt: 10
});

export const seedEditorialPickBundleFixture = (
  layer: Layer.Layer<any, any, never>,
  postUri: PostUri,
  options?: {
    readonly withEnrichment?: boolean;
    readonly withVisionEnrichment?: boolean;
    readonly withPayload?: boolean;
    readonly score?: number;
    readonly reason?: string;
  }
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const payloads = yield* CandidatePayloadService;
      const editorial = yield* EditorialService;

      yield* payloads.capturePayload({
        postUri,
        captureStage: "candidate",
        embedType: options?.withPayload === false ? null : "link",
        embedPayload: options?.withPayload === false
          ? null
          : {
            kind: "link",
            uri: "https://example.com/grid-report",
            title: "Grid report",
            description: "Useful context",
            thumb: null
          }
      });

      yield* payloads.markPicked(postUri);

      if (options?.withEnrichment !== false) {
        yield* payloads.saveEnrichment({
          postUri,
          enrichmentType: "source-attribution",
          enrichmentPayload: makeSourceAttributionEnrichmentPayload()
        });
      }

      if (options?.withVisionEnrichment === true) {
        yield* payloads.saveEnrichment({
          postUri,
          enrichmentType: "vision",
          enrichmentPayload: makeVisionEnrichmentPayload()
        });
      }

      return yield* editorial.submitPick(
        {
          postUri,
          score: Schema.decodeUnknownSync(EditorialScore)(options?.score ?? 85),
          reason: options?.reason ?? "Important solar analysis",
          category: "analysis"
        },
        "test-curator"
      );
    }).pipe(Effect.provide(layer))
  );

export const markEditorialFixturePostDeleted = (
  layer: Layer.Layer<any, any, never>,
  postUri: PostUri
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        UPDATE posts
        SET status = ${"deleted"}
        WHERE uri = ${postUri}
      `.pipe(Effect.asVoid);
    }).pipe(Effect.provide(layer))
  );

export const withTempSqliteFile = <A>(
  f: (filename: string) => Promise<A>
) => {
  const filename = join("/tmp", `skygest-bi-${randomUUID()}.sqlite`);

  return f(filename).finally(() => {
    rmSync(filename, { force: true });
  });
};

export const createMcpClient = async (
  layer: Layer.Layer<any, any, never>,
  identity: AccessIdentity = readOnlyIdentity
) => {
  const baseUrl = new URL("https://skygest.local");
  const webHandler = createPersistentMcpHandler(
    withDataRefQueryService(layer),
    identity
  );
  const localFetch = ((input, init) => {
    const request = input instanceof Request
      ? new Request(input, init)
      : new Request(input.toString(), init);
    return webHandler.handler(request);
  }) as typeof globalThis.fetch;

  const clientOptions = {
    baseUrl,
    fetch: localFetch,
    clientName: "skygest-bi-tests",
    clientVersion: "0.1.0"
  };

  return {
    client: {
      listTools: () =>
        Effect.runPromise(listTools(clientOptions)),
      listPrompts: () =>
        Effect.runPromise(listPrompts(clientOptions)),
      callTool: (input: McpToolCall) =>
        Effect.runPromise(callTool(clientOptions, input))
    },
    close: () => webHandler.dispose()
  };
};
