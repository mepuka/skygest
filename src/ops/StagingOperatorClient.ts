import { Context, Effect, Layer, Schema } from "effect";
import {
  BootstrapExpertsResult,
  ExpertListOutput,
  KnowledgePostsOutput
} from "../domain/bi";
import { PollRunSummary } from "../domain/polling";
import {
  callTool,
  decodeCallToolResultWith,
  type McpCallToolResult
} from "../mcp/Client";
import { decodeJsonStringWith, encodeJsonString } from "../platform/Json";
import { StagingRequestError } from "./Errors";

const MigrateResponse = Schema.Struct({
  ok: Schema.Literal(true)
});

const LoadSmokeFixtureResponse = Schema.Struct({
  posts: Schema.Number,
  links: Schema.Number,
  topics: Schema.Number
});

const decodeMigrateResponse = decodeJsonStringWith(MigrateResponse);
const decodeBootstrapExpertsResponse = decodeJsonStringWith(BootstrapExpertsResult);
const decodeLoadSmokeFixtureResponse = decodeJsonStringWith(LoadSmokeFixtureResponse);
const decodePollRunSummaryResponse = decodeJsonStringWith(PollRunSummary);
const decodeAdminExpertsJsonResponse = decodeJsonStringWith(ExpertListOutput);
const decodeSearchPostsResponse = decodeCallToolResultWith(KnowledgePostsOutput);
const decodeMcpExpertsResponse = decodeCallToolResultWith(ExpertListOutput);

const operatorHeaders = (secret: string) => ({
  "content-type": "application/json",
  "x-skygest-operator-secret": secret
});

const endpointUrl = (baseUrl: URL, pathname: string) =>
  new URL(pathname, baseUrl);

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
          message: error instanceof Error ? error.message : String(error)
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
        message: error instanceof Error ? error.message : String(error)
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
          message: error instanceof Error ? error.message : String(error)
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
    readonly pollIngest: (
      baseUrl: URL,
      secret: string
    ) => Effect.Effect<Schema.Schema.Type<typeof PollRunSummary>, StagingRequestError>;
    readonly listAdminExperts: (
      baseUrl: URL,
      secret: string
    ) => Effect.Effect<ReadonlyArray<{ readonly did: string; readonly domain: string }>, StagingRequestError>;
    readonly listExpertsMcp: (
      baseUrl: URL,
      secret: string
    ) => Effect.Effect<ReadonlyArray<{ readonly did: string; readonly domain: string }>, StagingRequestError>;
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
    pollIngest: (baseUrl, secret) =>
      requestJson(
        "poll-ingest",
        () =>
          fetch(endpointUrl(baseUrl, "/admin/ingest/poll"), {
            method: "POST",
            headers: operatorHeaders(secret),
            body: encodeJsonString({})
          }),
        decodePollRunSummaryResponse
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
