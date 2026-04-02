/**
 * Custom toolkit registration that uses `_display` for `content[0].text`
 * when the structured result contains a `_display` string field, falling
 * back to `JSON.stringify` otherwise.
 *
 * This is a minimal fork of `McpServer.registerToolkit` / `McpServer.toolkit`
 * from `@effect/ai` — the only change is in the `onSuccess` text branch.
 */
import { McpSchema, McpServer, Tool as AiTool, Toolkit } from "effect/unstable/ai";
import { Schema } from "effect";
import * as Effect from "effect/Effect";
import type * as JsonSchema from "effect/JsonSchema";
import * as Layer from "effect/Layer";
import * as ServiceMap from "effect/ServiceMap";

// ---------------------------------------------------------------------------
// Display-text aware success text extraction
// ---------------------------------------------------------------------------
const displayText = (encodedResult: unknown): string => {
  if (
    typeof encodedResult === "object" &&
    encodedResult !== null &&
    "_display" in encodedResult &&
    typeof (encodedResult as Record<string, unknown>)._display === "string"
  ) {
    return (encodedResult as Record<string, unknown>)._display as string;
  }
  return JSON.stringify(encodedResult);
};

// ---------------------------------------------------------------------------
// Internal helper — build MCP-compatible JSON Schema from an AiTool schema
// ---------------------------------------------------------------------------
const makeJsonSchema = (schema: { readonly ast: import("effect/SchemaAST").AST }): JsonSchema.JsonSchema => {
  try {
    const doc = Schema.toJsonSchemaDocument(schema as Schema.Top);
    return (doc as any).schema ?? doc;
  } catch {
    return { type: "object", properties: {}, required: [], additionalProperties: false } as any;
  }
};

// ---------------------------------------------------------------------------
// registerToolkitWithDisplayText — mirrors McpServer.registerToolkit
// ---------------------------------------------------------------------------
const registerToolkitWithDisplayText = <
  Tools extends Record<string, AiTool.Any>
>(
  toolkit: Toolkit.Toolkit<Tools>
): Effect.Effect<
  void,
  never,
  | McpServer.McpServer
  | AiTool.HandlersFor<Tools>
  | Exclude<AiTool.HandlerServices<Tools>, McpSchema.McpServerClient>
> =>
  Effect.gen(function* () {
    const registry = yield* McpServer.McpServer;
    const built: Toolkit.WithHandler<Tools> = yield* toolkit as any;
    for (const tool of Object.values(built.tools) as any[]) {
      const annotations = ServiceMap.empty() as ServiceMap.ServiceMap<never>;
      const mcpTool = new McpSchema.Tool({
        name: tool.name,
        description: tool.description,
        inputSchema: makeJsonSchema(tool.parametersSchema)
      });
      yield* registry.addTool({
        tool: mcpTool,
        annotations,
        handle(payload: any) {
          return built.handle(tool.name as any, payload).pipe(
            Effect.match({
              // Failure path — identical to stock implementation
              onFailure: (error: any) =>
                new McpSchema.CallToolResult({
                  isError: true,
                  structuredContent:
                    typeof error === "object" ? error : undefined,
                  content: [
                    {
                      type: "text",
                      text: JSON.stringify(error)
                    }
                  ]
                }),
              // Success path — uses _display when present
              onSuccess: (result: any) => {
                const structured =
                  typeof result.encodedResult === "object"
                    ? result.encodedResult
                    : undefined;
                return new McpSchema.CallToolResult({
                  isError: false,
                  structuredContent: structured,
                  content: [
                    {
                      type: "text",
                      text: displayText(result.encodedResult)
                    }
                  ]
                });
              }
            })
          ) as any;
        }
      });
    }
  }) as any;

// ---------------------------------------------------------------------------
// toolkitWithDisplayText — drop-in replacement for McpServer.toolkit
// ---------------------------------------------------------------------------
export const toolkitWithDisplayText = <
  Tools extends Record<string, AiTool.Any>
>(
  toolkit: Toolkit.Toolkit<Tools>
): Layer.Layer<
  never,
  never,
  | AiTool.HandlersFor<Tools>
  | Exclude<AiTool.HandlerServices<Tools>, McpSchema.McpServerClient>
> =>
  Layer.effectDiscard(registerToolkitWithDisplayText(toolkit)) as any;
