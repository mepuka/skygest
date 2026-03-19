import { Context, Effect, Layer, Schema } from "effect";
import {
  FetchHttpClient,
  HttpBody,
  HttpClient,
  HttpClientResponse
} from "@effect/platform";
import {
  BootstrapExpertsResult,
  ExpertListOutput,
  LoadSmokeFixtureResult,
  PublicationListOutput,
  RefreshProfilesResult,
  SeedPublicationsResult
} from "../domain/bi";
import { StagingStats } from "../domain/api";
import {
  IngestQueuedResponse,
  IngestRepairSummary,
  IngestRunRecord
} from "../domain/polling";
import {
  EnrichmentQueuedResponse,
  EnrichmentRepairSummary,
  EnrichmentRunRecord,
  EnrichmentRunStatus,
  EnrichmentRunsOutput
} from "../domain/enrichmentRun";
import { EnrichmentKind } from "../domain/enrichment";
import {
  callTool,
  decodeCallToolResultWith,
  type McpCallToolResult
} from "../mcp/Client";
import {
  KnowledgePostsMcpOutput,
  ExpertListMcpOutput
} from "../mcp/OutputSchemas";
import { HttpClientError } from "@effect/platform";
import { stringifyUnknown } from "../platform/Json";
import { StagingRequestError } from "./Errors";

const MigrateResponse = Schema.Struct({
  ok: Schema.Literal(true)
});

const extractStatus = (error: unknown): number | undefined => {
  if (error instanceof HttpClientError.ResponseError) {
    return error.response.status;
  }

  return undefined;
};

const wrapError = (operation: string) => (error: unknown) =>
  StagingRequestError.make({
    operation,
    message: stringifyUnknown(error),
    status: extractStatus(error)
  });

const jsonRequest = <A, I>(
  request: Effect.Effect<HttpClientResponse.HttpClientResponse, HttpClientError.HttpClientError>,
  schema: Schema.Schema<A, I>,
  operation: string
) =>
  request.pipe(
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)),
    Effect.mapError(wrapError(operation))
  );

const textRequest = (
  request: Effect.Effect<HttpClientResponse.HttpClientResponse, HttpClientError.HttpClientError>,
  operation: string
) =>
  request.pipe(
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap((response) => response.text),
    Effect.mapError(wrapError(operation))
  );

const decodeSearchPostsResponse = decodeCallToolResultWith(KnowledgePostsMcpOutput);
const decodeMcpExpertsResponse = decodeCallToolResultWith(ExpertListMcpOutput);

const callMcpTool = <A>(
  baseUrl: URL,
  secret: string,
  operation: string,
  input: {
    readonly name: string;
    readonly arguments?: Record<string, unknown>;
  },
  decode: (result: McpCallToolResult) => A
) =>
  callTool(
    {
      baseUrl,
      headers: {
        "x-skygest-operator-secret": secret
      },
      clientName: "skygest-staging-ops",
      clientVersion: "0.1.0"
    },
    input
  ).pipe(
    Effect.map(decode),
    Effect.mapError((error) =>
      StagingRequestError.make({
        operation,
        message: stringifyUnknown(error)
      })
    )
  );

export class StagingOperatorClient extends Context.Tag("@skygest/StagingOperatorClient")<
  StagingOperatorClient,
  {
    readonly health: (baseUrl: URL) => Effect.Effect<string, StagingRequestError>;
    readonly migrate: (
      baseUrl: URL,
      secret: string
    ) => Effect.Effect<{ readonly ok: true }, StagingRequestError>;
    readonly bootstrapExperts: (
      baseUrl: URL,
      secret: string
    ) => Effect.Effect<{
      readonly domain: string;
      readonly count: number;
    }, StagingRequestError>;
    readonly loadSmokeFixture: (
      baseUrl: URL,
      secret: string
    ) => Effect.Effect<{
      readonly posts: number;
      readonly links: number;
      readonly topics: number;
    }, StagingRequestError>;
    readonly refreshProfiles: (
      baseUrl: URL,
      secret: string
    ) => Effect.Effect<{
      readonly updated: number;
      readonly failed: number;
    }, StagingRequestError>;
    readonly pollIngest: (
      baseUrl: URL,
      secret: string,
      did?: string
    ) => Effect.Effect<Schema.Schema.Type<typeof IngestQueuedResponse>, StagingRequestError>;
    readonly getIngestRun: (
      baseUrl: URL,
      secret: string,
      runId: string
    ) => Effect.Effect<Schema.Schema.Type<typeof IngestRunRecord>, StagingRequestError>;
    readonly repairIngest: (
      baseUrl: URL,
      secret: string
    ) => Effect.Effect<Schema.Schema.Type<typeof IngestRepairSummary>, StagingRequestError>;
    readonly startEnrichment: (
      baseUrl: URL,
      secret: string,
      input: {
        readonly postUri: string;
        readonly enrichmentType: Schema.Schema.Type<typeof EnrichmentKind>;
        readonly schemaVersion?: string;
      }
    ) => Effect.Effect<Schema.Schema.Type<typeof EnrichmentQueuedResponse>, StagingRequestError>;
    readonly listEnrichmentRuns: (
      baseUrl: URL,
      secret: string,
      options?: {
        readonly status?: Schema.Schema.Type<typeof EnrichmentRunStatus>;
        readonly limit?: number;
      }
    ) => Effect.Effect<ReadonlyArray<Schema.Schema.Type<typeof EnrichmentRunRecord>>, StagingRequestError>;
    readonly getEnrichmentRun: (
      baseUrl: URL,
      secret: string,
      runId: string
    ) => Effect.Effect<Schema.Schema.Type<typeof EnrichmentRunRecord>, StagingRequestError>;
    readonly retryEnrichment: (
      baseUrl: URL,
      secret: string,
      runId: string
    ) => Effect.Effect<Schema.Schema.Type<typeof EnrichmentQueuedResponse>, StagingRequestError>;
    readonly repairEnrichment: (
      baseUrl: URL,
      secret: string
    ) => Effect.Effect<Schema.Schema.Type<typeof EnrichmentRepairSummary>, StagingRequestError>;
    readonly listAdminExperts: (
      baseUrl: URL,
      secret: string
    ) => Effect.Effect<ReadonlyArray<{ readonly did: string; readonly domain: string }>, StagingRequestError>;
    readonly listExpertsMcp: (
      baseUrl: URL,
      secret: string
    ) => Effect.Effect<ReadonlyArray<{ readonly did: string; readonly domain: string }>, StagingRequestError>;
    readonly seedPublications: (
      baseUrl: URL,
      secret: string
    ) => Effect.Effect<{
      readonly seeded: number;
      readonly snapshotVersion: string;
    }, StagingRequestError>;
    readonly listPublications: (
      baseUrl: URL,
      secret: string
    ) => Effect.Effect<ReadonlyArray<{ readonly hostname: string; readonly tier: string; readonly postCount: number }>, StagingRequestError>;
    readonly getStats: (
      baseUrl: URL,
      secret: string
    ) => Effect.Effect<Schema.Schema.Type<typeof StagingStats>, StagingRequestError>;
    readonly searchPostsMcp: (
      baseUrl: URL,
      secret: string,
      query: string
    ) => Effect.Effect<ReadonlyArray<{ readonly uri: string; readonly topics: ReadonlyArray<string> }>, StagingRequestError>;
  }
>() {
  static readonly live = Layer.effect(
    StagingOperatorClient,
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient;

      return StagingOperatorClient.of({
        health: (baseUrl) =>
          textRequest(http.get(new URL("/health", baseUrl)), "health"),
        migrate: (baseUrl, secret) =>
          jsonRequest(
            http.post(new URL("/admin/ops/migrate", baseUrl), {
              headers: { "content-type": "application/json", "x-skygest-operator-secret": secret },
              body: HttpBody.unsafeJson({})
            }),
            MigrateResponse,
            "migrate"
          ),
        bootstrapExperts: (baseUrl, secret) =>
          jsonRequest(
            http.post(new URL("/admin/ops/bootstrap-experts", baseUrl), {
              headers: { "content-type": "application/json", "x-skygest-operator-secret": secret },
              body: HttpBody.unsafeJson({})
            }),
            BootstrapExpertsResult,
            "bootstrap-experts"
          ),
        loadSmokeFixture: (baseUrl, secret) =>
          jsonRequest(
            http.post(new URL("/admin/ops/load-smoke-fixture", baseUrl), {
              headers: { "content-type": "application/json", "x-skygest-operator-secret": secret },
              body: HttpBody.unsafeJson({})
            }),
            LoadSmokeFixtureResult,
            "load-smoke-fixture"
          ),
        refreshProfiles: (baseUrl, secret) =>
          jsonRequest(
            http.post(new URL("/admin/ops/refresh-profiles", baseUrl), {
              headers: { "content-type": "application/json", "x-skygest-operator-secret": secret },
              body: HttpBody.unsafeJson({})
            }),
            RefreshProfilesResult,
            "refresh-profiles"
          ),
        pollIngest: (baseUrl, secret, did) =>
          jsonRequest(
            http.post(new URL("/admin/ingest/poll", baseUrl), {
              headers: { "content-type": "application/json", "x-skygest-operator-secret": secret },
              body: HttpBody.unsafeJson(did === undefined ? {} : { did })
            }),
            IngestQueuedResponse,
            "poll-ingest"
          ),
        getIngestRun: (baseUrl, secret, runId) =>
          jsonRequest(
            http.get(new URL(`/admin/ingest/runs/${runId}`, baseUrl), {
              headers: { "x-skygest-operator-secret": secret }
            }),
            IngestRunRecord,
            "get-ingest-run"
          ),
        repairIngest: (baseUrl, secret) =>
          jsonRequest(
            http.post(new URL("/admin/ingest/repair", baseUrl), {
              headers: { "content-type": "application/json", "x-skygest-operator-secret": secret },
              body: HttpBody.unsafeJson({})
            }),
            IngestRepairSummary,
            "repair-ingest"
          ),
        startEnrichment: (baseUrl, secret, input) =>
          jsonRequest(
            http.post(new URL("/admin/enrichment/start", baseUrl), {
              headers: { "content-type": "application/json", "x-skygest-operator-secret": secret },
              body: HttpBody.unsafeJson({
                postUri: input.postUri,
                enrichmentType: input.enrichmentType,
                ...(input.schemaVersion === undefined
                  ? {}
                  : { schemaVersion: input.schemaVersion })
              })
            }),
            EnrichmentQueuedResponse,
            "start-enrichment"
          ),
        listEnrichmentRuns: (baseUrl, secret, options) => {
          const url = new URL("/admin/enrichment/runs", baseUrl);
          if (options?.status !== undefined) {
            url.searchParams.set("status", options.status);
          }
          if (options?.limit !== undefined) {
            url.searchParams.set("limit", String(options.limit));
          }
          return jsonRequest(
            http.get(url, { headers: { "x-skygest-operator-secret": secret } }),
            EnrichmentRunsOutput,
            "list-enrichment-runs"
          ).pipe(Effect.map((output) => output.items));
        },
        getEnrichmentRun: (baseUrl, secret, runId) =>
          jsonRequest(
            http.get(new URL(`/admin/enrichment/runs/${runId}`, baseUrl), {
              headers: { "x-skygest-operator-secret": secret }
            }),
            EnrichmentRunRecord,
            "get-enrichment-run"
          ),
        retryEnrichment: (baseUrl, secret, runId) =>
          jsonRequest(
            http.post(new URL(`/admin/enrichment/runs/${runId}/retry`, baseUrl), {
              headers: { "content-type": "application/json", "x-skygest-operator-secret": secret },
              body: HttpBody.unsafeJson({})
            }),
            EnrichmentQueuedResponse,
            "retry-enrichment"
          ),
        repairEnrichment: (baseUrl, secret) =>
          jsonRequest(
            http.post(new URL("/admin/enrichment/repair", baseUrl), {
              headers: { "content-type": "application/json", "x-skygest-operator-secret": secret },
              body: HttpBody.unsafeJson({})
            }),
            EnrichmentRepairSummary,
            "repair-enrichment"
          ),
        seedPublications: (baseUrl, secret) =>
          jsonRequest(
            http.post(new URL("/admin/ops/seed-publications", baseUrl), {
              headers: { "content-type": "application/json", "x-skygest-operator-secret": secret },
              body: HttpBody.unsafeJson({})
            }),
            SeedPublicationsResult,
            "seed-publications"
          ),
        listAdminExperts: (baseUrl, secret) =>
          jsonRequest(
            http.get(new URL("/admin/experts", baseUrl), {
              headers: { "x-skygest-operator-secret": secret }
            }),
            ExpertListOutput,
            "admin-experts"
          ).pipe(Effect.map((output) => output.items)),
        listExpertsMcp: (baseUrl, secret) =>
          callMcpTool(
            baseUrl,
            secret,
            "mcp:list_experts",
            {
              name: "list_experts",
              arguments: { domain: "energy" }
            },
            (text) => decodeMcpExpertsResponse(text).items
          ),
        getStats: (baseUrl, secret) =>
          jsonRequest(
            http.get(new URL("/admin/ops/stats", baseUrl), {
              headers: { "x-skygest-operator-secret": secret }
            }),
            StagingStats,
            "get-stats"
          ),
        listPublications: (baseUrl, secret) =>
          jsonRequest(
            http.get(new URL("/api/publications?limit=100", baseUrl), {
              headers: { "x-skygest-operator-secret": secret }
            }),
            PublicationListOutput,
            "list-publications"
          ).pipe(Effect.map((output) => output.items)),
        searchPostsMcp: (baseUrl, secret, query) =>
          callMcpTool(
            baseUrl,
            secret,
            "mcp:search_posts",
            {
              name: "search_posts",
              arguments: { query }
            },
            (text) => decodeSearchPostsResponse(text).items
          )
      });
    })
  ).pipe(Layer.provide(FetchHttpClient.layer));
}
