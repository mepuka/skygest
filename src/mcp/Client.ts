import { McpSchema } from "@effect/ai";
import { Either, Effect, Schema } from "effect";
import {
  decodeJsonString,
  decodeJsonStringEitherWith,
  encodeJsonString,
  formatSchemaParseError,
  stringifyUnknown
} from "../platform/Json";

const MCP_PROTOCOL_VERSION = "2025-06-18";

const JsonRpcId = Schema.Union(Schema.Number, Schema.String, Schema.Null);

const JsonRpcError = Schema.Struct({
  code: Schema.Number,
  message: Schema.String,
  data: Schema.optional(Schema.Unknown)
});

const makeJsonRpcSuccess = <A, I>(schema: Schema.Schema<A, I, never>) =>
  Schema.Struct({
    jsonrpc: Schema.Literal("2.0"),
    id: Schema.optional(JsonRpcId),
    result: schema
  });

const makeJsonRpcFailure = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  id: Schema.optional(JsonRpcId),
  error: JsonRpcError
});

export class McpRequestError extends Schema.TaggedError<McpRequestError>()(
  "McpRequestError",
  {
    operation: Schema.String,
    message: Schema.String,
    status: Schema.optional(Schema.Number)
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

const decodeUnknownSuccess = <A, I>(
  operation: string,
  schema: Schema.Schema<A, I, never>,
  payload: unknown
) => {
  const responses = Array.isArray(payload) ? payload : [payload];
  const response = responses[0];

  if (response === undefined) {
    throw McpRequestError.make({
      operation,
      message: "empty JSON-RPC response"
    });
  }

  const failureResult = Schema.decodeUnknownEither(makeJsonRpcFailure)(response);

  if (Either.isRight(failureResult)) {
    throw McpRequestError.make({
      operation,
      message: failureResult.right.error.message
    });
  }

  const successResult = Schema.decodeUnknownEither(makeJsonRpcSuccess(schema))(
    response
  );

  if (Either.isRight(successResult)) {
    return successResult.right.result;
  }

  throw McpRequestError.make({
    operation,
    message: formatSchemaParseError(successResult.left)
  });
};

const requestJsonRpc = <A, I>(
  options: McpClientOptions,
  operation: string,
  method: string,
  schema: Schema.Schema<A, I, never>,
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
            id: 1,
            method,
            params
          })
        }
      );
      const text = await response.text();

      if (!response.ok) {
        throw McpRequestError.make({
          operation,
          status: response.status,
          message: text || response.statusText
        });
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
        : McpRequestError.make({
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

        throw McpRequestError.make({
          operation,
          status: response.status,
          message: text || response.statusText
        });
      }
    },
    catch: (error) =>
      error instanceof McpRequestError
        ? error
        : McpRequestError.make({
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
    }
  ).pipe(
    Effect.tap(() =>
      notifyJsonRpc(
        options,
        "mcp:initialized",
        "notifications/initialized"
      )
    )
  );

export const listTools = (
  options: McpClientOptions
): Effect.Effect<McpListToolsResult, McpRequestError> =>
  initializeClient(options).pipe(
    Effect.zipRight(
      requestJsonRpc(
        options,
        "mcp:list_tools",
        "tools/list",
        McpSchema.ListToolsResult
      )
    )
  );

export const callTool = (
  options: McpClientOptions,
  input: McpToolCall
): Effect.Effect<McpCallToolResult, McpRequestError> =>
  initializeClient(options).pipe(
    Effect.zipRight(
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

export const decodeCallToolResultWith = <A, I>(
  schema: Schema.Schema<A, I, never>
) => {
  const decodeStructured = Schema.decodeUnknownEither(schema);
  const decodeJson = decodeJsonStringEitherWith(schema);

  return (result: McpCallToolResult) => {
    const text = readFirstTextContent(result);

    if (result.isError === true) {
      throw new Error(text ?? "MCP tool call returned an error result");
    }

    if (result.structuredContent !== undefined) {
      const structuredResult = decodeStructured(result.structuredContent);

      if (Either.isRight(structuredResult)) {
        return structuredResult.right;
      }
    }

    if (text !== undefined) {
      const textResult = decodeJson(text);

      if (Either.isRight(textResult)) {
        return textResult.right;
      }

      throw new Error(formatSchemaParseError(textResult.left));
    }

    throw new Error(
      "MCP tool call did not include structuredContent or text content"
    );
  };
};
