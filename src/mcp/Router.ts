import { McpSchema, McpServer } from "effect/unstable/ai";
import * as HttpLayerRouter from "effect/unstable/http/HttpRouter";
import { ServiceMap, Effect, Layer, Schema } from "effect";
import { BlueskyClient } from "../bluesky/BlueskyClient";
import { makeQueryLayer } from "../edge/Layer";
import type { EnvBindings } from "../platform/Env";
import {
  decodeJsonString,
  decodeJsonStringWith,
  encodeJsonString,
  encodeJsonStringWith
} from "../platform/Json";
import { CurationService } from "../services/CurationService";
import { EditorialService } from "../services/EditorialService";
import { EnrichmentTriggerClient } from "../services/EnrichmentTriggerClient";
import { KnowledgeQueryService } from "../services/KnowledgeQueryService";
import { PipelineStatusService } from "../services/PipelineStatusService";
import { PostImportService } from "../services/PostImportService";
import { PostEnrichmentReadService } from "../services/PostEnrichmentReadService";
import { GLOSSARY_CONTENT } from "./glossary";
import { ReadOnlyPromptsLayer, WorkflowPromptsLayer } from "./prompts";
import { toolkitWithDisplayText } from "./registerToolkitWithDisplayText.ts";
import { toolkitForProfile } from "./Toolkit";
import { profileForIdentity, type McpCapabilityProfile } from "./RequestAuth";
import type { AccessIdentity } from "../auth/AuthService";
import { OperatorIdentity, operatorIdentityContext } from "../http/Identity";

const GlossaryResource = McpServer.resource({
  uri: "skygest://glossary",
  name: "Domain Glossary",
  description:
    "Definitions of key terms, entities, and enums used across all tools",
  mimeType: "text/markdown",
  content: Effect.succeed(GLOSSARY_CONTENT)
});

type QueryLayer = Layer.Layer<
  KnowledgeQueryService |
  EditorialService |
  CurationService |
  BlueskyClient |
  PostEnrichmentReadService |
  PipelineStatusService |
  PostImportService,
  any,
  never
>;

const mcpServerLayer = McpServer.layerHttp({
  name: "skygest-bi-mcp",
  version: "0.1.0",
  path: "/mcp"
}).pipe(Layer.provideMerge(HttpLayerRouter.layer));

const makeMcpLayer = (
  queryLayer: QueryLayer,
  profile: McpCapabilityProfile
) => {
  const { toolkit, handlers } = toolkitForProfile(profile);
  const toolkitAndHandlers = toolkitWithDisplayText(toolkit).pipe(
    Layer.provideMerge(handlers.pipe(Layer.provideMerge(queryLayer)))
  );

  const promptsLayer = (profile.includes("workflow-write")
    ? WorkflowPromptsLayer
    : ReadOnlyPromptsLayer) as Layer.Layer<never, never, never>;

  return toolkitAndHandlers.pipe(
    Layer.provideMerge(GlossaryResource),
    Layer.provideMerge(promptsLayer),
    Layer.provideMerge(mcpServerLayer)
  );
};

export const handleMcpRequestWithLayer = async (
  request: Request,
  layer: QueryLayer,
  identity: AccessIdentity = { subject: null, email: null, scopes: ["mcp:read"] }
): Promise<Response> => {
  const profile = profileForIdentity(identity);
  const webHandler = HttpLayerRouter.toWebHandler(makeMcpLayer(layer, profile));

  try {
    return await webHandler.handler(request, operatorIdentityContext(identity));
  } finally {
    await webHandler.dispose();
  }
};

/**
 * Create a persistent MCP handler that keeps the web handler alive across
 * requests. This is required because the MCP server tracks sessions — the
 * session created during `initialize` must be available for subsequent
 * `tools/list`, `tools/call`, etc. requests.
 */
export const createPersistentMcpHandler = (
  layer: QueryLayer,
  identity: AccessIdentity = { subject: null, email: null, scopes: ["mcp:read"] }
) => {
  const profile = profileForIdentity(identity);
  const webHandler = HttpLayerRouter.toWebHandler(makeMcpLayer(layer, profile));
  const context = operatorIdentityContext(identity);

  return {
    handler: (request: Request) => webHandler.handler(request, context),
    dispose: () => webHandler.dispose()
  };
};

/** Web handler shape with an explicit context parameter for OperatorIdentity */
type McpWebHandler = {
  readonly handler: (request: globalThis.Request, context: ServiceMap.ServiceMap<OperatorIdentity>) => Promise<Response>;
  readonly dispose: () => Promise<void>;
};

export type McpInitializePayload = typeof McpSchema.Initialize.payloadSchema.Type;

export type PersistedMcpSession = {
  readonly initializePayload: McpInitializePayload;
};

export type McpSessionStore<Env extends object> = {
  readonly load: (env: Env, sessionId: string) => Promise<PersistedMcpSession | null>;
  readonly save: (
    env: Env,
    sessionId: string,
    session: PersistedMcpSession
  ) => Promise<void>;
};

export type MakeCachedMcpHandlerOptions<Env extends object> = {
  readonly defaultInitializePayload?: McpInitializePayload;
  readonly makeWebHandler?: (
    env: Env,
    profile: McpCapabilityProfile
  ) => McpWebHandler;
  readonly sessionStore?: McpSessionStore<Env>;
};

const DefaultWarmSessionPayload: McpInitializePayload = {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "skygest-warm-proxy", version: "0.1.0" }
};

const PersistedMcpSessionRowSchema = Schema.Struct({
  initializePayloadJson: Schema.String
});

const decodeInitializePayload = Schema.decodeUnknownSync(
  McpSchema.Initialize.payloadSchema
);
const decodePersistedMcpSessionRow = Schema.decodeUnknownSync(
  PersistedMcpSessionRowSchema
);
const encodeInitializePayloadJson = encodeJsonStringWith(
  McpSchema.Initialize.payloadSchema
);
const decodeInitializePayloadJson = decodeJsonStringWith(
  McpSchema.Initialize.payloadSchema
);

const readJsonRpcBody = async (
  request: Request
): Promise<Record<string, unknown> | null> => {
  try {
    const body = decodeJsonString(await request.text());
    return typeof body === "object" && body !== null
      ? body as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
};

/**
 * Build a new Request with the `mcp-session-id` header replaced.
 * Uses body passthrough to avoid consuming the original stream.
 */
const substituteSessionHeader = (request: Request, sessionId: string): Request => {
  const headers = new Headers(request.headers);
  headers.set("mcp-session-id", sessionId);
  const body = request.body;

  return new Request(request.url, {
    method: request.method,
    headers,
    ...(body === null ? {} : { body, duplex: "half" as const })
  });
};

/**
 * Create an MCP session by replaying an initialize + notifications/initialized
 * handshake. Returns the new session ID, or null if the handshake fails.
 */
const createSession = async (
  webHandler: McpWebHandler,
  url: string,
  context: ServiceMap.ServiceMap<OperatorIdentity>,
  initializePayload: McpInitializePayload
): Promise<string | null> => {
  const initReq = new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: encodeJsonString({
      jsonrpc: "2.0",
      method: "initialize",
      id: 0,
      params: initializePayload
    })
  });

  const initResp = await webHandler.handler(initReq, context);
  if (initResp.status !== 200) return null;

  const sessionId = initResp.headers.get("mcp-session-id");
  if (!sessionId) return null;

  // Complete the handshake with notifications/initialized
  const notifyReq = new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "mcp-session-id": sessionId
    },
    body: encodeJsonString({
      jsonrpc: "2.0",
      method: "notifications/initialized"
    })
  });
  await webHandler.handler(notifyReq, context);

  return sessionId;
};

/**
 * Build a 404 response indicating the session could not be recovered.
 */
const sessionExpiredResponse = (): Response =>
  new Response(
    encodeJsonString({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Session expired. Please re-initialize." },
      id: null
    }),
    { status: 404, headers: { "content-type": "application/json" } }
  );

const extractInitializePayload = async (
  request: Request
): Promise<McpInitializePayload | null> => {
  const body = await readJsonRpcBody(request);
  if (body?.method !== "initialize") {
    return null;
  }

  try {
    return decodeInitializePayload(body.params);
  } catch {
    return null;
  }
};

const loadPersistedSession = async <Env extends object>(
  sessionStore: McpSessionStore<Env> | undefined,
  env: Env,
  sessionId: string
): Promise<PersistedMcpSession | null> => {
  if (!sessionStore) {
    return null;
  }

  try {
    return await sessionStore.load(env, sessionId);
  } catch {
    return null;
  }
};

const savePersistedSession = async <Env extends object>(
  sessionStore: McpSessionStore<Env> | undefined,
  env: Env,
  sessionId: string,
  session: PersistedMcpSession
): Promise<void> => {
  if (!sessionStore) {
    return;
  }

  try {
    await sessionStore.save(env, sessionId, session);
  } catch {
    // Degrade to in-memory routing if persistence is unavailable.
  }
};

/** @internal Exported for integration testing of session handling */
export const makeCachedMcpHandler = <Env extends object>(
  buildLayer: (env: Env) => QueryLayer,
  envKey: (env: Env) => string = () => "default",
  options: MakeCachedMcpHandlerOptions<Env> = {}
) => {
  const buildWebHandler = options.makeWebHandler ?? ((env: Env, profile: McpCapabilityProfile) =>
    HttpLayerRouter.toWebHandler(
      makeMcpLayer(buildLayer(env), profile)
    ) as unknown as McpWebHandler);
  const defaultInitializePayload =
    options.defaultInitializePayload ?? DefaultWarmSessionPayload;
  const cache = new Map<string, {
    readonly envKey: string;
    readonly webHandler: McpWebHandler;
    readonly clientSessionIds: Map<string, string>;
    defaultWarmSessionId: string | null;
  }>();

  return async (request: Request, env: Env, identity: AccessIdentity): Promise<Response> => {
    const profile = profileForIdentity(identity);
    const cacheKey = profile;
    const currentEnvKey = envKey(env);

    let entry = cache.get(cacheKey);
    if (!entry || entry.envKey !== currentEnvKey) {
      if (entry) {
        await entry.webHandler.dispose();
      }

      entry = {
        envKey: currentEnvKey,
        webHandler: buildWebHandler(env, profile),
        clientSessionIds: new Map(),
        defaultWarmSessionId: null
      };
      cache.set(cacheKey, entry);
    }

    const context = operatorIdentityContext(identity);
    const initializePayload = await extractInitializePayload(request.clone());

    // Path 1: Client-initiated initialize — forward directly and persist the
    // exact initialize payload so the session can be rebuilt after isolate loss.
    if (initializePayload !== null) {
      const response = await entry.webHandler.handler(request, context);
      const sessionId = response.headers.get("mcp-session-id");
      if (sessionId) {
        entry.clientSessionIds.set(sessionId, sessionId);
        await savePersistedSession(options.sessionStore, env, sessionId, {
          initializePayload
        });
      }
      return response;
    }

    const externalSessionId = request.headers.get("mcp-session-id");

    // Path 2: Client session request — recover the exact client session when
    // necessary and keep it isolated from other clients in the same profile.
    if (externalSessionId) {
      let activeSessionId =
        entry.clientSessionIds.get(externalSessionId) ?? null;

      if (!activeSessionId) {
        const persisted = await loadPersistedSession(
          options.sessionStore,
          env,
          externalSessionId
        );
        if (!persisted) {
          return sessionExpiredResponse();
        }

        activeSessionId = await createSession(
          entry.webHandler,
          request.url,
          context,
          persisted.initializePayload
        );
        if (!activeSessionId) {
          return sessionExpiredResponse();
        }

        entry.clientSessionIds.set(externalSessionId, activeSessionId);
      }

      return entry.webHandler.handler(
        substituteSessionHeader(request, activeSessionId),
        context
      );
    }

    // Path 3: Sessionless request — use a shared default session for callers
    // that never initialized and therefore have no client-specific state.
    if (entry.defaultWarmSessionId === null) {
      entry.defaultWarmSessionId = await createSession(
        entry.webHandler,
        request.url,
        context,
        defaultInitializePayload
      );
      if (entry.defaultWarmSessionId === null) {
        return sessionExpiredResponse();
      }
    }

    return entry.webHandler.handler(
      substituteSessionHeader(request, entry.defaultWarmSessionId),
      context
    );
  };
};

/**
 * Build a query layer that includes the EnrichmentTriggerClient when the env
 * exposes an INGEST_SERVICE fetcher binding (agent worker only).
 */
const makeQueryLayerWithTrigger = (env: EnvBindings): QueryLayer => {
  const base = makeQueryLayer(env);
  const fetcher = (env as unknown as Record<string, unknown>)["INGEST_SERVICE"] as Fetcher | undefined;
  const secret = env.OPERATOR_SECRET;

  if (fetcher && secret) {
    return Layer.provideMerge(
      EnrichmentTriggerClient.layerFromFetcher(fetcher, secret),
      base
    ) as unknown as QueryLayer;
  }

  return base;
};

const loadPersistedMcpSession = async (
  env: EnvBindings,
  sessionId: string
): Promise<PersistedMcpSession | null> => {
  try {
    const row = await env.DB
      .prepare(
        `SELECT initialize_payload_json as initializePayloadJson
         FROM mcp_sessions
         WHERE session_id = ?
         LIMIT 1`
      )
      .bind(sessionId)
      .first<Record<string, unknown>>();

    if (!row) {
      return null;
    }

    const decodedRow = decodePersistedMcpSessionRow(row);
    return {
      initializePayload: decodeInitializePayloadJson(
        decodedRow.initializePayloadJson
      )
    };
  } catch {
    return null;
  }
};

const savePersistedMcpSession = async (
  env: EnvBindings,
  sessionId: string,
  session: PersistedMcpSession
): Promise<void> => {
  try {
    const now = Date.now();
    await env.DB
      .prepare(
        `INSERT INTO mcp_sessions (
           session_id,
           initialize_payload_json,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           initialize_payload_json = excluded.initialize_payload_json,
           updated_at = excluded.updated_at`
      )
      .bind(
        sessionId,
        encodeInitializePayloadJson(session.initializePayload),
        now,
        now
      )
      .run();
  } catch {
    // Degrade gracefully if the persistence table is unavailable during rollout.
  }
};

const d1McpSessionStore: McpSessionStore<EnvBindings> = {
  load: loadPersistedMcpSession,
  save: savePersistedMcpSession
};

const handleCachedMcpRequest = makeCachedMcpHandler(
  makeQueryLayerWithTrigger,
  (env) => env.OPERATOR_SECRET ?? "default",
  { sessionStore: d1McpSessionStore }
);

export const handleMcpRequest = (
  request: Request,
  env: EnvBindings,
  identity: AccessIdentity
) => handleCachedMcpRequest(request, env, identity);
