/**
 * Custom toolkit registration that uses `_display` for `content[0].text`
 * when the structured result contains a `_display` string field, falling
 * back to `JSON.stringify` otherwise.
 *
 * This is a minimal fork of `McpServer.registerToolkit` / `McpServer.toolkit`
 * from `@effect/ai` — the only change is in the `onSuccess` text branch.
 */
import { McpSchema, McpServer, Tool as AiTool, Toolkit } from "effect/unstable/ai";
import { Cause, Option, Sink, Stream } from "effect";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ServiceMap from "effect/ServiceMap";

type ToolkitRuntime<Tools extends Record<string, AiTool.Any>> =
  | AiTool.HandlersFor<Tools>
  | Exclude<AiTool.HandlerServices<Tools>, McpSchema.McpServerClient>;

type BuiltToolkit<Tools extends Record<string, AiTool.Any>> = Toolkit.WithHandler<Tools>;

type BuiltTool<Tools extends Record<string, AiTool.Any>> =
  BuiltToolkit<Tools>["tools"][keyof BuiltToolkit<Tools>["tools"]];

type EncodedToolResult = {
  readonly encodedResult: unknown;
};

// Effect AI does not expose a typed bridge from Toolkit.Toolkit<Tools>
// to the built toolkit effect shape, so keep that conversion in one place.
const unsafeBuildToolkitEffect = <Tools extends Record<string, AiTool.Any>>(
  toolkit: Toolkit.Toolkit<Tools>
): Effect.Effect<BuiltToolkit<Tools>, never, ToolkitRuntime<Tools>> =>
  toolkit as unknown as Effect.Effect<BuiltToolkit<Tools>, never, ToolkitRuntime<Tools>>;

const builtTools = <Tools extends Record<string, AiTool.Any>>(
  toolkit: BuiltToolkit<Tools>
): ReadonlyArray<BuiltTool<Tools>> =>
  Object.values(toolkit.tools) as unknown as ReadonlyArray<BuiltTool<Tools>>;

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
const registerToolkitWithDisplayText = <
  Tools extends Record<string, AiTool.Any>
>(
  toolkit: Toolkit.Toolkit<Tools>
): Effect.Effect<
  void,
  never,
  McpServer.McpServer | ToolkitRuntime<Tools>
> =>
  Effect.gen(function* () {
    const registry = yield* McpServer.McpServer;
    const built = yield* unsafeBuildToolkitEffect(toolkit);
    const services = yield* Effect.services<ToolkitRuntime<Tools>>();
    for (const tool of builtTools(built)) {
      const annotations = tool.annotations ?? (ServiceMap.empty() as ServiceMap.ServiceMap<never>);
      const toolMeta = ServiceMap.getOrUndefined(annotations, AiTool.Meta);
      const mcpTool = new McpSchema.Tool({
        name: tool.name,
        description: AiTool.getDescription(tool),
        inputSchema: AiTool.getJsonSchema(tool),
        annotations: {
          ...(ServiceMap.getOption(tool.annotations, AiTool.Title).pipe(
            Option.map((title: string) => ({ title })),
            Option.getOrUndefined
          )),
          readOnlyHint: ServiceMap.get(tool.annotations, AiTool.Readonly),
          destructiveHint: ServiceMap.get(tool.annotations, AiTool.Destructive),
          idempotentHint: ServiceMap.get(tool.annotations, AiTool.Idempotent),
          openWorldHint: ServiceMap.get(tool.annotations, AiTool.OpenWorld)
        },
        _meta: toolMeta
      });
      yield* registry.addTool({
        tool: mcpTool,
        annotations,
        handle(payload: unknown) {
          return built.handle(tool.name as never, payload as never).pipe(
            Stream.unwrap,
            Stream.run(Sink.last()),
            Effect.flatMap(Effect.fromOption),
            Effect.provideServices(services),
            Effect.matchCause({
              // Failure path — identical to stock implementation
              onFailure: (cause) =>
                new McpSchema.CallToolResult({
                  isError: true,
                  structuredContent: undefined,
                  content: [{
                    type: "text",
                    text: Cause.pretty(cause)
                  }]
                }),
              // Success path — uses _display when present
              onSuccess: (result: EncodedToolResult) => {
                const structured =
                  typeof result.encodedResult === "object"
                    ? result.encodedResult
                    : undefined;
                return new McpSchema.CallToolResult({
                  isError: false,
                  structuredContent: structured,
                  content: [{
                    type: "text",
                    text: displayText(result.encodedResult)
                  }]
                });
              }
            }),
            Effect.tapCause(Effect.log)
          );
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
  McpServer.McpServer | ToolkitRuntime<Tools>
> =>
  Layer.effectDiscard(registerToolkitWithDisplayText(toolkit));
