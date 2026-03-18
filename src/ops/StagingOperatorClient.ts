import { Context, Effect, Layer, Schema } from "effect";
import {
  BootstrapExpertsResult,
  ExpertListOutput,
  LoadSmokeFixtureResult,
  PublicationListOutput,
  RefreshProfilesResult,
  SeedPublicationsResult
} from "../domain/bi";
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
import {
  callTool,
  decodeCallToolResultWith,
  type McpCallToolResult
} from "../mcp/Client";
import {
  KnowledgePostsMcpOutput,
  ExpertListMcpOutput
} from "../mcp/OutputSchemas";
import {
  decodeJsonStringWith,
  encodeJsonString,
  stringifyUnknown
} from "../platform/Json";
import { StagingRequestError } from "./Errors";

const MigrateResponse = Schema.Struct({
  ok: Schema.Literal(true)
});

const decodeMigrateResponse = decodeJsonStringWith(MigrateResponse);
const decodeBootstrapExpertsResponse = decodeJsonStringWith(BootstrapExpertsResult);
const decodeLoadSmokeFixtureResponse = decodeJsonStringWith(LoadSmokeFixtureResult);
const decodeRefreshProfilesResponse = decodeJsonStringWith(RefreshProfilesResult);
const decodeSeedPublicationsResponse = decodeJsonStringWith(SeedPublicationsResult);
const decodeIngestQueuedResponse = decodeJsonStringWith(IngestQueuedResponse);
const decodeIngestRepairSummary = decodeJsonStringWith(IngestRepairSummary);
const decodeIngestRunResponse = decodeJsonStringWith(IngestRunRecord);
const decodeEnrichmentQueuedResponse = decodeJsonStringWith(EnrichmentQueuedResponse);
const decodeEnrichmentRepairSummary = decodeJsonStringWith(EnrichmentRepairSummary);
const decodeEnrichmentRunResponse = decodeJsonStringWith(EnrichmentRunRecord);
const decodeEnrichmentRunsResponse = decodeJsonStringWith(EnrichmentRunsOutput);
const decodePublicationsResponse = decodeJsonStringWith(PublicationListOutput);
const decodeAdminExpertsJsonResponse = decodeJsonStringWith(ExpertListOutput);
const decodeSearchPostsResponse = decodeCallToolResultWith(KnowledgePostsMcpOutput);
const decodeMcpExpertsResponse = decodeCallToolResultWith(ExpertListMcpOutput);

const operatorHeaders = (secret: string) => ({
  "content-type": "application/json",
  "x-skygest-operator-secret": secret
});

const endpointUrl = (baseUrl: URL, pathname: string) =>
  new URL(pathname, baseUrl);

const endpointUrlWithQuery = (
  baseUrl: URL,
  pathname: string,
  query: Record<string, string | undefined>
) => {
  const url = endpointUrl(baseUrl, pathname);

  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) {
      url.searchParams.set(key, value);
    }
  }

  return url;
};

const optionalDidBody = (did?: string) =>
  encodeJsonString(did === undefined ? {} : { did });

const requestJson = <A>(
  operation: string,
  request: () => Promise<Response>,
  decode: (text: string) => A
) =>
  Effect.tryPromise({
    try: async () => {
      const response = await request();
      const text = await response.text();

      if (!response.ok) {
        throw StagingRequestError.make({
          operation,
          status: response.status,
          message: text || response.statusText
        });
      }

      return decode(text.length === 0 ? "{}" : text);
    },
    catch: (error) =>
      error instanceof StagingRequestError
        ? error
        : StagingRequestError.make({
          operation,
          message: stringifyUnknown(error)
        })
  });

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

const requestText = (
  operation: string,
  request: () => Promise<Response>
) =>
  Effect.tryPromise({
    try: async () => {
      const response = await request();
      const text = await response.text();

      if (!response.ok) {
        throw StagingRequestError.make({
          operation,
          status: response.status,
          message: text || response.statusText
        });
      }

      return text;
    },
    catch: (error) =>
      error instanceof StagingRequestError
        ? error
        : StagingRequestError.make({
          operation,
          message: stringifyUnknown(error)
        })
  });

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
    readonly searchPostsMcp: (
      baseUrl: URL,
      secret: string,
      query: string
    ) => Effect.Effect<ReadonlyArray<{ readonly uri: string; readonly topics: ReadonlyArray<string> }>, StagingRequestError>;
  }
>() {
  static readonly live = Layer.succeed(StagingOperatorClient, {
    health: (baseUrl) =>
      requestText("health", () =>
        fetch(endpointUrl(baseUrl, "/health"))
      ),
    migrate: (baseUrl, secret) =>
      requestJson(
        "migrate",
        () =>
          fetch(endpointUrl(baseUrl, "/admin/ops/migrate"), {
            method: "POST",
            headers: operatorHeaders(secret),
            body: encodeJsonString({})
          }),
        decodeMigrateResponse
      ),
    bootstrapExperts: (baseUrl, secret) =>
      requestJson(
        "bootstrap-experts",
        () =>
          fetch(endpointUrl(baseUrl, "/admin/ops/bootstrap-experts"), {
            method: "POST",
            headers: operatorHeaders(secret),
            body: encodeJsonString({})
          }),
        decodeBootstrapExpertsResponse
      ),
    loadSmokeFixture: (baseUrl, secret) =>
      requestJson(
        "load-smoke-fixture",
        () =>
          fetch(endpointUrl(baseUrl, "/admin/ops/load-smoke-fixture"), {
            method: "POST",
            headers: operatorHeaders(secret),
            body: encodeJsonString({})
          }),
        decodeLoadSmokeFixtureResponse
      ),
    refreshProfiles: (baseUrl, secret) =>
      requestJson(
        "refresh-profiles",
        () =>
          fetch(endpointUrl(baseUrl, "/admin/ops/refresh-profiles"), {
            method: "POST",
            headers: operatorHeaders(secret),
            body: encodeJsonString({})
          }),
        decodeRefreshProfilesResponse
      ),
    pollIngest: (baseUrl, secret, did) =>
      requestJson(
        "poll-ingest",
        () =>
          fetch(endpointUrl(baseUrl, "/admin/ingest/poll"), {
            method: "POST",
            headers: operatorHeaders(secret),
            body: optionalDidBody(did)
          }),
        decodeIngestQueuedResponse
      ),
    getIngestRun: (baseUrl, secret, runId) =>
      requestJson(
        "get-ingest-run",
        () =>
          fetch(endpointUrl(baseUrl, `/admin/ingest/runs/${runId}`), {
            headers: {
              "x-skygest-operator-secret": secret
            }
          }),
        decodeIngestRunResponse
      ),
    repairIngest: (baseUrl, secret) =>
      requestJson(
        "repair-ingest",
        () =>
          fetch(endpointUrl(baseUrl, "/admin/ingest/repair"), {
            method: "POST",
            headers: operatorHeaders(secret),
            body: encodeJsonString({})
          }),
        decodeIngestRepairSummary
      ),
    listEnrichmentRuns: (baseUrl, secret, options) =>
      requestJson(
        "list-enrichment-runs",
        () =>
          fetch(
            endpointUrlWithQuery(baseUrl, "/admin/enrichment/runs", {
              status: options?.status,
              limit: options?.limit === undefined ? undefined : String(options.limit)
            }),
            {
              headers: {
                "x-skygest-operator-secret": secret
              }
            }
          ),
        (text) => decodeEnrichmentRunsResponse(text).items
      ),
    getEnrichmentRun: (baseUrl, secret, runId) =>
      requestJson(
        "get-enrichment-run",
        () =>
          fetch(endpointUrl(baseUrl, `/admin/enrichment/runs/${runId}`), {
            headers: {
              "x-skygest-operator-secret": secret
            }
          }),
        decodeEnrichmentRunResponse
      ),
    retryEnrichment: (baseUrl, secret, runId) =>
      requestJson(
        "retry-enrichment",
        () =>
          fetch(endpointUrl(baseUrl, `/admin/enrichment/runs/${runId}/retry`), {
            method: "POST",
            headers: operatorHeaders(secret),
            body: encodeJsonString({})
          }),
        decodeEnrichmentQueuedResponse
      ),
    repairEnrichment: (baseUrl, secret) =>
      requestJson(
        "repair-enrichment",
        () =>
          fetch(endpointUrl(baseUrl, "/admin/enrichment/repair"), {
            method: "POST",
            headers: operatorHeaders(secret),
            body: encodeJsonString({})
          }),
        decodeEnrichmentRepairSummary
      ),
    seedPublications: (baseUrl, secret) =>
      requestJson(
        "seed-publications",
        () =>
          fetch(endpointUrl(baseUrl, "/admin/ops/seed-publications"), {
            method: "POST",
            headers: operatorHeaders(secret),
            body: encodeJsonString({})
          }),
        decodeSeedPublicationsResponse
      ),
    listAdminExperts: (baseUrl, secret) =>
      requestJson(
        "admin-experts",
        () =>
          fetch(endpointUrl(baseUrl, "/admin/experts"), {
            headers: {
              "x-skygest-operator-secret": secret
            }
          }),
        (text) => decodeAdminExpertsJsonResponse(text).items
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
    listPublications: (baseUrl, secret) =>
      requestJson(
        "list-publications",
        () =>
          fetch(endpointUrl(baseUrl, "/api/publications?limit=100"), {
            headers: { "x-skygest-operator-secret": secret }
          }),
        (text) => decodePublicationsResponse(text).items
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
}
