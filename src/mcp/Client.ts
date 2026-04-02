import { McpSchema } from "effect/unstable/ai";
import { Result, Effect, Schema } from "effect";
import {
  decodeJsonString,
  decodeJsonStringEitherWith,
  encodeJsonString,
  formatSchemaParseError,
  stringifyUnknown
} from "../platform/Json";

const MCP_PROTOCOL_VERSION = "2025-06-18";

const JsonRpcId = Schema.Union([Schema.Number, Schema.String, Schema.Null]);

const JsonRpcError = Schema.Struct({
  code: Schema.Number,
  message: Schema.String,
  data: Schema.optionalKey(Schema.Unknown)
});

const makeJsonRpcSuccess = <S extends Schema.Decoder<unknown>>(schema: S) =>
  Schema.Struct({
    jsonrpc: Schema.Literal("2.0"),
    id: Schema.optionalKey(JsonRpcId),
    result: schema
  });

const makeJsonRpcFailure = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  id: Schema.optionalKey(JsonRpcId),
  error: JsonRpcError
});

export class McpRequestError extends Schema.TaggedErrorClass<McpRequestError>()(
  "McpRequestError",
  {
    operation: Schema.String,
    message: Schema.String,
    status: Schema.optionalKey(Schema.Number)
  }
) {}

export interface McpClientOptions {
  readonly baseUrl: URL;
  readonly headers?: Record<string, string>;
  readonly fetch?: typeof globalThis.fetch;
  readonly clientName?: string;
  readonly clientVersion?: string;
}

export interface McpToolCall {
  readonly name: string;
  readonly arguments?: Record<string, unknown>;
}

export type McpInitializeResult = typeof McpSchema.InitializeResult.Type;
export type McpListToolsResult = typeof McpSchema.ListToolsResult.Type;
export type McpCallToolResult = typeof McpSchema.CallToolResult.Type;

const mcpEndpointUrl = (baseUrl: URL) =>
  new URL("/mcp", baseUrl);

const requestHeaders = (headers?: Record<string, string>) => ({
  "content-type": "application/json",
  ...(headers ?? {})
});

const decodeUnknownSuccess = <S extends Schema.Decoder<unknown>>(
  operation: string,
  schema: S,
  payload: unknown
): S["Type"] => {
  const responses = Array.isArray(payload) ? payload : [payload];
  const response = responses[0];

  if (response === undefined) {
    throw new McpRequestError({
      operation,
      message: "empty JSON-RPC response"
    });
  }

  const failureResult = Schema.decodeUnknownResult(makeJsonRpcFailure)(response);

  if (Result.isSuccess(failureResult)) {
    throw new McpRequestError({
      operation,
      message: failureResult.success.error.message
    });
  }

  const successResult = Schema.decodeUnknownResult(makeJsonRpcSuccess(schema))(
    response
  );

  if (Result.isSuccess(successResult)) {
    return (successResult.success as any).result;
  }

  throw new McpRequestError({
    operation,
    message: formatSchemaParseError(successResult.failure)
  });
};

const requestJsonRpc = <S extends Schema.Decoder<unknown>>(
  options: McpClientOptions,
  operation: string,
  method: string,
  schema: S,
  params?: unknown,
  captureSessionId = false
) =>
  Effect.tryPromise({
    try: async () => {
      const response = await (options.fetch ?? globalThis.fetch)(
        mcpEndpointUrl(options.baseUrl),
        {
          method: "POST",
          headers: requestHeaders(options.headers),
          body: encodeJsonString({
            jsonrpc: "2.0",
            id: 1,
            method,
            params
          })
        }
      );
      const text = await response.text();

      if (!response.ok) {
        throw new McpRequestError({
          operation,
          status: response.status,
          message: text || response.statusText
        });
      }

      if (captureSessionId) {
        const sessionId = response.headers.get("mcp-session-id");
        if (sessionId) {
          (options as { headers?: Record<string, string> }).headers = {
            ...(options.headers ?? {}),
            "mcp-session-id": sessionId
          };
        }
      }

      return decodeUnknownSuccess(
        operation,
        schema,
        text.length === 0 ? [] : decodeJsonString(text)
      );
    },
    catch: (error) =>
      error instanceof McpRequestError
        ? error
        : new McpRequestError({
            operation,
            message: stringifyUnknown(error)
          })
  });

const notifyJsonRpc = (
  options: McpClientOptions,
  operation: string,
  method: string,
  params?: unknown
) =>
  Effect.tryPromise({
    try: async () => {
      const response = await (options.fetch ?? globalThis.fetch)(
        mcpEndpointUrl(options.baseUrl),
        {
          method: "POST",
          headers: requestHeaders(options.headers),
          body: encodeJsonString({
            jsonrpc: "2.0",
            method,
            params
          })
        }
      );

      if (!response.ok) {
        const text = await response.text();

        throw new McpRequestError({
          operation,
          status: response.status,
          message: text || response.statusText
        });
      }
    },
    catch: (error) =>
      error instanceof McpRequestError
        ? error
        : new McpRequestError({
            operation,
            message: stringifyUnknown(error)
          })
  });

const initializeClient = (options: McpClientOptions) =>
  requestJsonRpc(
    options,
    "mcp:initialize",
    "initialize",
    McpSchema.InitializeResult,
    {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: options.clientName ?? "skygest-mcp-client",
        version: options.clientVersion ?? "0.1.0"
      }
    },
    true
  ).pipe(
    Effect.tap(() =>
      notifyJsonRpc(
        options,
        "mcp:initialized",
        "notifications/initialized"
      )
    )
  );

export type McpListPromptsResult = typeof McpSchema.ListPromptsResult.Type;

export const listTools = (
  options: McpClientOptions
): Effect.Effect<McpListToolsResult, McpRequestError> =>
  initializeClient(options).pipe(
    Effect.andThen(
      requestJsonRpc(
        options,
        "mcp:list_tools",
        "tools/list",
        McpSchema.ListToolsResult
      )
    )
  );

export const listPrompts = (
  options: McpClientOptions
): Effect.Effect<McpListPromptsResult, McpRequestError> =>
  initializeClient(options).pipe(
    Effect.andThen(
      requestJsonRpc(
        options,
        "mcp:list_prompts",
        "prompts/list",
        McpSchema.ListPromptsResult
      )
    )
  );

export const callTool = (
  options: McpClientOptions,
  input: McpToolCall
): Effect.Effect<McpCallToolResult, McpRequestError> =>
  initializeClient(options).pipe(
    Effect.andThen(
      requestJsonRpc(
        options,
        `mcp:${input.name}`,
        "tools/call",
        McpSchema.CallToolResult,
        {
          name: input.name,
          arguments: input.arguments ?? {}
        }
      )
    )
  );

const readFirstTextContent = (result: McpCallToolResult) =>
  result.content.find(
    (content): content is typeof McpSchema.TextContent.Type =>
      content.type === "text"
  )?.text;

export const decodeCallToolResultWith = <S extends Schema.Decoder<unknown>>(
  schema: S
) => {
  const decodeStructured = Schema.decodeUnknownResult(schema);
  const decodeJson = decodeJsonStringEitherWith(schema);

  return (result: McpCallToolResult) => {
    const text = readFirstTextContent(result);

    if (result.isError === true) {
      throw new Error(text ?? "MCP tool call returned an error result");
    }

    if (result.structuredContent !== undefined) {
      const structuredResult = decodeStructured(result.structuredContent);

      if (Result.isSuccess(structuredResult)) {
        return structuredResult.success;
      }
    }

    if (text !== undefined) {
      const textResult = decodeJson(text);

      if (Result.isSuccess(textResult)) {
        return textResult.success;
      }

      throw new Error(formatSchemaParseError(textResult.failure));
    }

    throw new Error(
      "MCP tool call did not include structuredContent or text content"
    );
  };
};
