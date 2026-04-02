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
  | McpServer.McpServer
  | AiTool.HandlersFor<Tools>
  | Exclude<AiTool.HandlerServices<Tools>, McpSchema.McpServerClient>
> =>
  Effect.gen(function* () {
    const registry = yield* McpServer.McpServer;
    const built: Toolkit.WithHandler<Tools> = yield* toolkit as any;
    const services = yield* Effect.services<never>();
    for (const tool of Object.values(built.tools) as any[]) {
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
        handle(payload: any) {
          return built.handle(tool.name as any, payload).pipe(
            Stream.unwrap,
            Stream.run(Sink.last()),
            Effect.flatMap(Effect.fromOption),
            Effect.provideServices(services as ServiceMap.ServiceMap<any>),
            Effect.matchCause({
              // Failure path — identical to stock implementation
              onFailure: (cause: any) =>
                new McpSchema.CallToolResult({
                  isError: true,
                  structuredContent: undefined,
                  content: [{
                    type: "text",
                    text: Cause.pretty(cause)
                  }]
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
                  content: [{
                    type: "text",
                    text: displayText(result.encodedResult)
                  }]
                });
              }
            }),
            Effect.tapCause(Effect.log)
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
