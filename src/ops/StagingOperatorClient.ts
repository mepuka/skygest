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
import { stringifyUnknown } from "../platform/Json";
import { StagingRequestError } from "./Errors";

const MigrateResponse = Schema.Struct({
  ok: Schema.Literal(true)
});

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
          http.get(new URL("/health", baseUrl)).pipe(
            Effect.flatMap((response) => response.text),
            Effect.mapError((error) =>
              StagingRequestError.make({
                operation: "health",
                message: stringifyUnknown(error)
              })
            )
          ),
        migrate: (baseUrl, secret) =>
          http.post(new URL("/admin/ops/migrate", baseUrl), {
            headers: {
              "content-type": "application/json",
              "x-skygest-operator-secret": secret
            },
            body: HttpBody.unsafeJson({})
          }).pipe(
            Effect.flatMap(HttpClientResponse.schemaBodyJson(MigrateResponse)),
            Effect.mapError((error) =>
              StagingRequestError.make({
                operation: "migrate",
                message: stringifyUnknown(error)
              })
            )
          ),
        bootstrapExperts: (baseUrl, secret) =>
          http.post(new URL("/admin/ops/bootstrap-experts", baseUrl), {
            headers: {
              "content-type": "application/json",
              "x-skygest-operator-secret": secret
            },
            body: HttpBody.unsafeJson({})
          }).pipe(
            Effect.flatMap(HttpClientResponse.schemaBodyJson(BootstrapExpertsResult)),
            Effect.mapError((error) =>
              StagingRequestError.make({
                operation: "bootstrap-experts",
                message: stringifyUnknown(error)
              })
            )
          ),
        loadSmokeFixture: (baseUrl, secret) =>
          http.post(new URL("/admin/ops/load-smoke-fixture", baseUrl), {
            headers: {
              "content-type": "application/json",
              "x-skygest-operator-secret": secret
            },
            body: HttpBody.unsafeJson({})
          }).pipe(
            Effect.flatMap(HttpClientResponse.schemaBodyJson(LoadSmokeFixtureResult)),
            Effect.mapError((error) =>
              StagingRequestError.make({
                operation: "load-smoke-fixture",
                message: stringifyUnknown(error)
              })
            )
          ),
        refreshProfiles: (baseUrl, secret) =>
          http.post(new URL("/admin/ops/refresh-profiles", baseUrl), {
            headers: {
              "content-type": "application/json",
              "x-skygest-operator-secret": secret
            },
            body: HttpBody.unsafeJson({})
          }).pipe(
            Effect.flatMap(HttpClientResponse.schemaBodyJson(RefreshProfilesResult)),
            Effect.mapError((error) =>
              StagingRequestError.make({
                operation: "refresh-profiles",
                message: stringifyUnknown(error)
              })
            )
          ),
        pollIngest: (baseUrl, secret, did) =>
          http.post(new URL("/admin/ingest/poll", baseUrl), {
            headers: {
              "content-type": "application/json",
              "x-skygest-operator-secret": secret
            },
            body: HttpBody.unsafeJson(did === undefined ? {} : { did })
          }).pipe(
            Effect.flatMap(HttpClientResponse.schemaBodyJson(IngestQueuedResponse)),
            Effect.mapError((error) =>
              StagingRequestError.make({
                operation: "poll-ingest",
                message: stringifyUnknown(error)
              })
            )
          ),
        getIngestRun: (baseUrl, secret, runId) =>
          http.get(new URL(`/admin/ingest/runs/${runId}`, baseUrl), {
            headers: { "x-skygest-operator-secret": secret }
          }).pipe(
            Effect.flatMap(HttpClientResponse.schemaBodyJson(IngestRunRecord)),
            Effect.mapError((error) =>
              StagingRequestError.make({
                operation: "get-ingest-run",
                message: stringifyUnknown(error)
              })
            )
          ),
        repairIngest: (baseUrl, secret) =>
          http.post(new URL("/admin/ingest/repair", baseUrl), {
            headers: {
              "content-type": "application/json",
              "x-skygest-operator-secret": secret
            },
            body: HttpBody.unsafeJson({})
          }).pipe(
            Effect.flatMap(HttpClientResponse.schemaBodyJson(IngestRepairSummary)),
            Effect.mapError((error) =>
              StagingRequestError.make({
                operation: "repair-ingest",
                message: stringifyUnknown(error)
              })
            )
          ),
        startEnrichment: (baseUrl, secret, input) =>
          http.post(new URL("/admin/enrichment/start", baseUrl), {
            headers: {
              "content-type": "application/json",
              "x-skygest-operator-secret": secret
            },
            body: HttpBody.unsafeJson({
              postUri: input.postUri,
              enrichmentType: input.enrichmentType,
              ...(input.schemaVersion === undefined
                ? {}
                : { schemaVersion: input.schemaVersion })
            })
          }).pipe(
            Effect.flatMap(HttpClientResponse.schemaBodyJson(EnrichmentQueuedResponse)),
            Effect.mapError((error) =>
              StagingRequestError.make({
                operation: "start-enrichment",
                message: stringifyUnknown(error)
              })
            )
          ),
        listEnrichmentRuns: (baseUrl, secret, options) => {
          const url = new URL("/admin/enrichment/runs", baseUrl);
          if (options?.status !== undefined) {
            url.searchParams.set("status", options.status);
          }
          if (options?.limit !== undefined) {
            url.searchParams.set("limit", String(options.limit));
          }
          return http.get(url, {
            headers: { "x-skygest-operator-secret": secret }
          }).pipe(
            Effect.flatMap(HttpClientResponse.schemaBodyJson(EnrichmentRunsOutput)),
            Effect.map((output) => output.items),
            Effect.mapError((error) =>
              StagingRequestError.make({
                operation: "list-enrichment-runs",
                message: stringifyUnknown(error)
              })
            )
          );
        },
        getEnrichmentRun: (baseUrl, secret, runId) =>
          http.get(new URL(`/admin/enrichment/runs/${runId}`, baseUrl), {
            headers: { "x-skygest-operator-secret": secret }
          }).pipe(
            Effect.flatMap(HttpClientResponse.schemaBodyJson(EnrichmentRunRecord)),
            Effect.mapError((error) =>
              StagingRequestError.make({
                operation: "get-enrichment-run",
                message: stringifyUnknown(error)
              })
            )
          ),
        retryEnrichment: (baseUrl, secret, runId) =>
          http.post(new URL(`/admin/enrichment/runs/${runId}/retry`, baseUrl), {
            headers: {
              "content-type": "application/json",
              "x-skygest-operator-secret": secret
            },
            body: HttpBody.unsafeJson({})
          }).pipe(
            Effect.flatMap(HttpClientResponse.schemaBodyJson(EnrichmentQueuedResponse)),
            Effect.mapError((error) =>
              StagingRequestError.make({
                operation: "retry-enrichment",
                message: stringifyUnknown(error)
              })
            )
          ),
        repairEnrichment: (baseUrl, secret) =>
          http.post(new URL("/admin/enrichment/repair", baseUrl), {
            headers: {
              "content-type": "application/json",
              "x-skygest-operator-secret": secret
            },
            body: HttpBody.unsafeJson({})
          }).pipe(
            Effect.flatMap(HttpClientResponse.schemaBodyJson(EnrichmentRepairSummary)),
            Effect.mapError((error) =>
              StagingRequestError.make({
                operation: "repair-enrichment",
                message: stringifyUnknown(error)
              })
            )
          ),
        seedPublications: (baseUrl, secret) =>
          http.post(new URL("/admin/ops/seed-publications", baseUrl), {
            headers: {
              "content-type": "application/json",
              "x-skygest-operator-secret": secret
            },
            body: HttpBody.unsafeJson({})
          }).pipe(
            Effect.flatMap(HttpClientResponse.schemaBodyJson(SeedPublicationsResult)),
            Effect.mapError((error) =>
              StagingRequestError.make({
                operation: "seed-publications",
                message: stringifyUnknown(error)
              })
            )
          ),
        listAdminExperts: (baseUrl, secret) =>
          http.get(new URL("/admin/experts", baseUrl), {
            headers: { "x-skygest-operator-secret": secret }
          }).pipe(
            Effect.flatMap(HttpClientResponse.schemaBodyJson(ExpertListOutput)),
            Effect.map((output) => output.items),
            Effect.mapError((error) =>
              StagingRequestError.make({
                operation: "admin-experts",
                message: stringifyUnknown(error)
              })
            )
          ),
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
          http.get(new URL("/admin/ops/stats", baseUrl), {
            headers: { "x-skygest-operator-secret": secret }
          }).pipe(
            Effect.flatMap(HttpClientResponse.schemaBodyJson(StagingStats)),
            Effect.mapError((error) =>
              StagingRequestError.make({
                operation: "get-stats",
                message: stringifyUnknown(error)
              })
            )
          ),
        listPublications: (baseUrl, secret) =>
          http.get(new URL("/api/publications?limit=100", baseUrl), {
            headers: { "x-skygest-operator-secret": secret }
          }).pipe(
            Effect.flatMap(HttpClientResponse.schemaBodyJson(PublicationListOutput)),
            Effect.map((output) => output.items),
            Effect.mapError((error) =>
              StagingRequestError.make({
                operation: "list-publications",
                message: stringifyUnknown(error)
              })
            )
          ),
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
