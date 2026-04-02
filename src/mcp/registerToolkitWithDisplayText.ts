/**
 * Custom toolkit registration that uses `_display` for `content[0].text`
 * when the structured result contains a `_display` string field, falling
 * back to `JSON.stringify` otherwise.
 *
 * This is a minimal fork of `McpServer.registerToolkit` / `McpServer.toolkit`
 * from `@effect/ai` — the only change is in the `onSuccess` text branch.
 */
import { McpSchema, McpServer, Tool as AiTool } from "effect/unstable/ai";
import type * as Toolkit from "effect/unstable/ai";
import * as Context from "effect/ServiceMap";
import * as Effect from "effect/Effect";
import * as JsonSchema from "effect/JSONSchema";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as AST from "effect/SchemaAST";

// ---------------------------------------------------------------------------
// Internal helper copied from @effect/ai — not exported by the package
// ---------------------------------------------------------------------------
const makeJsonSchema = (ast: AST.AST): JsonSchema.JsonSchema7 => {
  const props = AST.getPropertySignatures(ast);
  if (props.length === 0) {
    return {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false
    };
  }
  const $defs = {};
  const schema = JsonSchema.fromAST(ast, {
    definitions: $defs,
    topLevelReferenceStrategy: "skip"
  });
  if (Object.keys($defs).length === 0) return schema;
  (schema as any).$defs = $defs;
  return schema;
};

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
// registerToolkitWithDisplayText — mirrors McpServer.registerToolkit
// ---------------------------------------------------------------------------
const registerToolkitWithDisplayText: <
  Tools extends Record<string, AiTool.Any>
>(
  toolkit: Toolkit.Toolkit<Tools>
) => Effect.Effect<
  void,
  never,
  | McpServer.McpServer
  | AiTool.HandlersFor<Tools>
  | Exclude<AiTool.Requirements<Tools>, McpSchema.McpServerClient>
> = Effect.fnUntraced(function*<Tools extends Record<string, AiTool.Any>>(
  toolkit: Toolkit.Toolkit<Tools>
) {
  const registry = yield* McpServer.McpServer;
  const built = yield* toolkit as any as Effect.Effect<
    Toolkit.WithHandler<Tools>,
    never,
    Exclude<AiTool.HandlersFor<Tools>, McpSchema.McpServerClient>
  >;
  const context = yield* Effect.context<never>();
  for (const tool of Object.values(built.tools)) {
    const mcpTool = new McpSchema.Tool({
      name: tool.name,
      description: tool.description,
      inputSchema: makeJsonSchema(tool.parametersSchema.ast),
      annotations: new McpSchema.ToolAnnotations({
        ...Context.getOption(tool.annotations, AiTool.Title).pipe(
          Option.map((title) => ({ title })),
          Option.getOrUndefined
        ),
        readOnlyHint: Context.get(tool.annotations, AiTool.Readonly),
        destructiveHint: Context.get(tool.annotations, AiTool.Destructive),
        idempotentHint: Context.get(tool.annotations, AiTool.Idempotent),
        openWorldHint: Context.get(tool.annotations, AiTool.OpenWorld)
      })
    });
    yield* registry.addTool({
      tool: mcpTool,
      handle(payload) {
        return built.handle(tool.name as any, payload).pipe(
          Effect.provide(context as Context.ServiceMap<any>),
          Effect.match({
            // Failure path — identical to stock implementation
            onFailure: (error) =>
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
            onSuccess: (result) => {
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
});

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
  | Exclude<AiTool.Requirements<Tools>, McpSchema.McpServerClient>
> =>
  Layer.effectDiscard(registerToolkitWithDisplayText(toolkit)).pipe(
    Layer.provide(McpServer.McpServer.layer)
  );
