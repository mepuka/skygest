# Enrichment Trigger MCP Tool Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `start_enrichment` MCP write tool that explicitly triggers enrichment via the ingest worker's service binding, and update the curate-session prompt to teach the correct async workflow: curate → trigger enrichment → poll readiness → accept.

**Architecture:** The agent worker lacks the `ENRICHMENT_RUN_WORKFLOW` binding (by design — enrichment workflows run on the ingest worker). Create an `EnrichmentTriggerClient` service that proxies enrichment start requests through the existing `INGEST_SERVICE` Fetcher binding. Add `start_enrichment` as a write tool on curation-write and workflow-write profiles. Update the curate-session prompt and glossary to reflect the explicit two-step flow. Remove the false "enrichment runs automatically" promise from `curate_post`.

**Tech Stack:** Effect.ts (Context.Tag, Layer.effect, Schema), Cloudflare Workers service bindings (Fetcher), @effect/ai Tool/Toolkit

---

## Task 1: EnrichmentTriggerClient Service

**Files:**
- Create: `src/services/EnrichmentTriggerClient.ts`
- Test: `tests/enrichment-trigger-client.test.ts`

### Step 1: Write the failing test

Create `tests/enrichment-trigger-client.test.ts`:

```ts
import { Effect, Layer } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { EnrichmentTriggerClient } from "../src/services/EnrichmentTriggerClient";

describe("EnrichmentTriggerClient", () => {
  it.effect("start returns queued response on success", () => {
    const mockFetcher = {
      fetch: async (_input: RequestInfo, _init?: RequestInit) => {
        return new Response(JSON.stringify({
          runId: "test-run-id",
          workflowInstanceId: "test-run-id",
          status: "queued"
        }), {
          status: 202,
          headers: { "content-type": "application/json" }
        });
      }
    } as unknown as Fetcher;

    const layer = EnrichmentTriggerClient.layerFromFetcher(mockFetcher, "test-secret");

    return Effect.gen(function* () {
      const client = yield* EnrichmentTriggerClient;
      const result = yield* client.start({
        postUri: "at://did:plc:abc/app.bsky.feed.post/xyz",
        enrichmentType: "source-attribution"
      });
      expect(result.status).toBe("queued");
      expect(result.runId).toBe("test-run-id");
    }).pipe(Effect.provide(layer));
  });

  it.effect("start returns error response on 4xx", () => {
    const mockFetcher = {
      fetch: async () => {
        return new Response(JSON.stringify({
          message: "enrichment run already exists"
        }), {
          status: 409,
          headers: { "content-type": "application/json" }
        });
      }
    } as unknown as Fetcher;

    const layer = EnrichmentTriggerClient.layerFromFetcher(mockFetcher, "test-secret");

    return Effect.gen(function* () {
      const client = yield* EnrichmentTriggerClient;
      const result = yield* client.start({
        postUri: "at://did:plc:abc/app.bsky.feed.post/xyz",
        enrichmentType: "vision"
      }).pipe(Effect.either);
      expect(result._tag).toBe("Left");
    }).pipe(Effect.provide(layer));
  });
});
```

### Step 2: Run test to verify it fails

Run: `bun run test tests/enrichment-trigger-client.test.ts`
Expected: FAIL — module not found

### Step 3: Implement the service

Create `src/services/EnrichmentTriggerClient.ts`:

```ts
import { Context, Effect, Layer, Schema } from "effect";
import { AtUri } from "../domain/types";
import { EnrichmentKind, defaultSchemaVersionForEnrichmentKind } from "../domain/enrichment";

export class EnrichmentTriggerError extends Schema.TaggedError<EnrichmentTriggerError>()(
  "EnrichmentTriggerError",
  {
    message: Schema.String,
    status: Schema.Number,
    postUri: AtUri
  }
) {}

const StartEnrichmentInput = Schema.Struct({
  postUri: AtUri,
  enrichmentType: EnrichmentKind,
  schemaVersion: Schema.optional(Schema.String)
});
export type StartEnrichmentInput = Schema.Schema.Type<typeof StartEnrichmentInput>;

const StartEnrichmentResult = Schema.Struct({
  runId: Schema.String,
  workflowInstanceId: Schema.String,
  status: Schema.Literal("queued")
});
export type StartEnrichmentResult = Schema.Schema.Type<typeof StartEnrichmentResult>;

export class EnrichmentTriggerClient extends Context.Tag(
  "@skygest/EnrichmentTriggerClient"
)<
  EnrichmentTriggerClient,
  {
    readonly start: (
      input: StartEnrichmentInput
    ) => Effect.Effect<StartEnrichmentResult, EnrichmentTriggerError>;
  }
>() {
  static readonly layerFromFetcher = (fetcher: Fetcher, operatorSecret: string) =>
    Layer.succeed(
      EnrichmentTriggerClient,
      EnrichmentTriggerClient.of({
        start: (input) =>
          Effect.tryPromise({
            try: async () => {
              const schemaVersion =
                input.schemaVersion ??
                defaultSchemaVersionForEnrichmentKind(input.enrichmentType);

              const response = await fetcher.fetch(
                new Request("https://ingest.internal/admin/enrichment/start", {
                  method: "POST",
                  headers: {
                    "content-type": "application/json",
                    "authorization": `Bearer ${operatorSecret}`
                  },
                  body: JSON.stringify({
                    postUri: input.postUri,
                    enrichmentType: input.enrichmentType,
                    schemaVersion
                  })
                })
              );

              const body = await response.json() as Record<string, unknown>;

              if (!response.ok) {
                throw {
                  message: (body.message as string) ?? `enrichment start failed with ${response.status}`,
                  status: response.status
                };
              }

              return body;
            },
            catch: (cause) => {
              const err = cause as Record<string, unknown>;
              return new EnrichmentTriggerError({
                message: typeof err.message === "string" ? err.message : String(cause),
                status: typeof err.status === "number" ? err.status : 500,
                postUri: input.postUri
              });
            }
          }).pipe(
            Effect.flatMap((body) =>
              Schema.decodeUnknown(StartEnrichmentResult)(body).pipe(
                Effect.mapError((parseError) =>
                  new EnrichmentTriggerError({
                    message: `Invalid enrichment response: ${String(parseError)}`,
                    status: 502,
                    postUri: input.postUri
                  })
                )
              )
            )
          )
      })
    );
}
```

Key design points:
- Uses `Fetcher` (Cloudflare service binding) — the hostname in the URL is ignored by service bindings, only the path matters
- Forwards the operator secret for auth on the ingest worker
- Returns typed `StartEnrichmentResult` or `EnrichmentTriggerError`
- `layerFromFetcher` factory — takes a Fetcher and secret, returns a Layer. This allows test mocking.
- The service does NOT use `Schema.parseJson` on the request body because we're constructing it ourselves (not parsing user input)

### Step 4: Run test to verify it passes

Run: `bun run test tests/enrichment-trigger-client.test.ts`
Expected: PASS

### Step 5: Commit

```bash
git add src/services/EnrichmentTriggerClient.ts tests/enrichment-trigger-client.test.ts
git commit -m "feat(enrichment): add EnrichmentTriggerClient for service-binding proxy (SKY-XX)"
```

---

## Task 2: Wire EnrichmentTriggerClient into Edge Layer

**Files:**
- Modify: `src/edge/Layer.ts`

### Step 1: Wire the client layer

In `src/edge/Layer.ts`, the agent worker provides `INGEST_SERVICE` (a Fetcher). When the binding is available, create the `EnrichmentTriggerClient` layer.

However, `buildSharedWorkerParts` receives `EnvBindings`, not `AgentWorkerEnvBindings`. The `INGEST_SERVICE` fetcher isn't available at this layer. Instead, we need to wire it at a higher level.

**Approach:** Don't wire it in `buildSharedWorkerParts`. Instead, wire it in `src/worker/feed.ts` where `AgentWorkerEnvBindings` is available. Pass the client through the MCP handler context.

Actually, the cleaner approach: add an optional `EnrichmentTriggerClient` to the MCP handler path. In `feed.ts`, when handling `/mcp`, build the client layer from `env.INGEST_SERVICE` and `env.OPERATOR_SECRET`, then provide it as additional context to `handleMcpRequest`.

Read `src/mcp/Router.ts` to understand how layers are composed for MCP handlers. The `handleMcpRequest` function builds a handler from the query layer. We need `EnrichmentTriggerClient` available in that layer.

**Simplest approach:** In `feed.ts`, build the trigger client layer and merge it into the MCP handler context. The MCP Router already takes `env` and builds layers from it.

In `src/mcp/Router.ts`, read how `makeMcpLayer` composes layers. Add `EnrichmentTriggerClient` as an optional service in the handler. Use `Effect.serviceOption` in the tool handler (same pattern as `EnrichmentRunsRepo`).

Implementation:

1. In `src/mcp/Router.ts`, read how the handler layer is built. Look for where `makeQueryLayer(env)` or `makeAdminWorkerLayer(env)` is called.

2. In `src/mcp/Router.ts`, modify the MCP handler to accept an optional `EnrichmentTriggerClient` layer. When building the handler for the agent worker, provide the trigger client.

3. In `src/worker/feed.ts`, when the `/mcp` route is hit:
   - Build `EnrichmentTriggerClient.layerFromFetcher(env.INGEST_SERVICE, env.OPERATOR_SECRET)` 
   - Pass it as additional context

Read the files to understand the exact wiring. The key constraint: the trigger client is only needed by write-profile MCP handlers, but providing it to all profiles is simpler and harmless (read-only profiles won't have the tool).

### Step 2: Run tests

Run: `bun run test`
Expected: All tests pass

### Step 3: Commit

```bash
git add src/mcp/Router.ts src/worker/feed.ts
git commit -m "feat(edge): wire EnrichmentTriggerClient into MCP handler context (SKY-XX)"
```

---

## Task 3: MCP Tool Definition + Handler

**Files:**
- Modify: `src/mcp/Toolkit.ts` — add tool definition + handler
- Modify: `src/mcp/OutputSchemas.ts` — add output schema
- Modify: `src/mcp/Fmt.ts` — add formatter
- Modify: `src/mcp/RequestAuth.ts` — add scope mapping

### Step 1: Add domain input schema

The `StartEnrichmentInput` is already in `src/services/EnrichmentTriggerClient.ts`. For the MCP tool, we need an MCP-friendly input. The enrichment type should be optional — if omitted, auto-detect from the post's embed type (link → source-attribution, img → vision).

Create an MCP-specific input in `src/mcp/Toolkit.ts`:

```ts
const StartEnrichmentMcpInput = Schema.Struct({
  postUri: AtUri.annotations({ description: "AT Protocol URI of the curated post to enrich" }),
  enrichmentType: Schema.optional(EnrichmentKind.annotations({
    description: "Enrichment type: 'vision' for charts/screenshots, 'source-attribution' for links. If omitted, auto-detected from embed type."
  }))
});
```

### Step 2: Add output schema to OutputSchemas.ts

```ts
// In src/mcp/OutputSchemas.ts:
import { EnrichmentTriggerResult } from ... // or define inline

export const StartEnrichmentMcpOutput = Schema.extend(
  Schema.Struct({
    postUri: AtUri,
    enrichmentType: EnrichmentKind,
    status: Schema.Literal("queued"),
    runId: Schema.String
  }),
  DisplayField
);
```

### Step 3: Add formatter to Fmt.ts

```ts
export const formatStartEnrichment = (result: {
  postUri: string;
  enrichmentType: string;
  status: string;
  runId: string;
}): string =>
  `Enrichment started: ${result.enrichmentType} for ${result.postUri}\n  Run ID: ${result.runId}\n  Status: ${result.status}\n  Use get_post_enrichments to check readiness.`;
```

### Step 4: Add tool definition

```ts
export const StartEnrichmentTool = Tool.make("start_enrichment", {
  description: "Trigger enrichment for a curated post. Queues vision analysis (for charts/screenshots) or source attribution (for links). Use get_post_enrichments to poll readiness after triggering. The post must have been curated first via curate_post.",
  parameters: StartEnrichmentMcpInput.fields,
  success: StartEnrichmentMcpOutput,
  failure: McpToolQueryError
})
  .annotate(Tool.Title, "Start Enrichment")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);
```

### Step 5: Add to toolkit variants

Add `StartEnrichmentTool` to `CurationWriteMcpToolkit` and `WorkflowWriteMcpToolkit`. NOT to `ReadOnlyMcpToolkit` or `EditorialWriteMcpToolkit` — the tool requires `curation:write` scope, which editorial-only users don't have. Showing a tool that will always fail is confusing.

### Step 6: Add handler

In `makeReadOnlyHandlers`, do NOT add the handler (it's a write tool).

Create a new handler function:

```ts
const makeStartEnrichmentHandler = (enrichmentTriggerClient: EnrichmentTriggerClientI) => ({
  start_enrichment: (input: typeof StartEnrichmentMcpInput.Type) =>
    Effect.gen(function* () {
      // If enrichmentType not specified, look up the post's embed type
      let enrichmentType = input.enrichmentType;
      if (enrichmentType === undefined) {
        const payloadService = yield* CandidatePayloadService;
        const payload = yield* payloadService.getPayload(input.postUri);
        if (payload === null) {
          return yield* McpToolQueryError.make({
            tool: "start_enrichment",
            message: "Post must be curated before starting enrichment",
            error: new Error("payload not found")
          });
        }
        enrichmentType = hasVisualAssets(payload.embedPayload)
          ? "vision"
          : "source-attribution";
      }

      const result = yield* enrichmentTriggerClient.start({
        postUri: input.postUri,
        enrichmentType
      });

      return {
        postUri: input.postUri,
        enrichmentType,
        status: result.status,
        runId: result.runId,
        _display: formatStartEnrichment({
          postUri: input.postUri,
          enrichmentType,
          status: result.status,
          runId: result.runId
        })
      };
    }).pipe(
      Effect.mapError((e) =>
        "_tag" in e && (e as any)._tag === "McpToolQueryError"
          ? (e as McpToolQueryError)
          : toQueryError("start_enrichment")(e as any)
      )
    ) as any
});
```

NOTE: The handler needs `CandidatePayloadService` for auto-detection and `EnrichmentTriggerClient` for the actual proxy call. Use `Effect.serviceOption(EnrichmentTriggerClient)` to gracefully handle environments where the trigger client is not available (return an error telling the user enrichment is not available in this deployment).

Add the handler to `CurationWriteMcpHandlers` and `WorkflowWriteMcpHandlers` only (not editorial — they lack `curation:write`).

### Step 7: Add scope mapping

In `src/mcp/RequestAuth.ts`, add to `TOOL_SCOPES`:

```ts
start_enrichment: ["curation:write"],
```

### Step 8: Run tests + typecheck

Run: `bun run test`
Run: `bunx tsc --noEmit`

### Step 9: Commit

```bash
git add src/mcp/Toolkit.ts src/mcp/OutputSchemas.ts src/mcp/Fmt.ts src/mcp/RequestAuth.ts
git commit -m "feat(mcp): add start_enrichment tool with service-binding proxy (SKY-XX)"
```

---

## Task 4: Update curate-session Prompt

**Files:**
- Modify: `src/mcp/prompts.ts`

### Step 1: Update the curate-session prompt

Replace the WORKFLOW section in `CurateSessionPrompt` (lines 107-143 of `src/mcp/prompts.ts`). Key changes:

- Step 4 (CURATE): Remove "queues enrichment automatically" — curate_post only captures payload
- Step 5 (START ENRICHMENT): New explicit step — call `start_enrichment(postUri)` after curating
- Step 6 (VERIFY READINESS): Call `get_post_enrichments(postUri)` to poll. If `pending`, do other work and check again. If `complete`, proceed to accept.
- Remove the outdated "enrichment inspection tools are coming in a future update" note

Updated prompt text:

```
4. CURATE — Candidate → Enriching
   Call curate_post(postUri: <uri>, action: "curate", note: "<1 sentence reason>").
   This captures the post's embed data for enrichment.
   Reject weak candidates: curate_post(postUri: <uri>, action: "reject", note: "<reason>").

5. START ENRICHMENT
   Call start_enrichment(postUri: <uri>) to queue enrichment.
   The enrichment type is auto-detected: vision for charts/screenshots, source attribution for links.
   You can override with start_enrichment(postUri: <uri>, enrichmentType: "vision").
   IMPORTANT: Posts with visual embeds may need TWO enrichment passes:
   first vision (chart analysis), then source-attribution (which uses vision output).
   After vision completes, call start_enrichment again — it will auto-detect source-attribution.

6. VERIFY READINESS — Enriching → Reviewable
   Call get_post_enrichments(postUri: <uri>) to check readiness.
   Readiness values: none (not started), pending (running), complete (ready), failed, needs-review.
   If pending: continue evaluating other candidates and check back later.
   If complete: check whether all expected enrichment types are present (vision AND source-attribution for visual posts).
     If source-attribution is missing, call start_enrichment again to trigger it.
   If failed or needs-review: note the issue and skip for now.
```

### Step 2: Run tests

Run: `bun run test tests/mcp.test.ts`
Expected: PASS

### Step 3: Commit

```bash
git add src/mcp/prompts.ts
git commit -m "feat(mcp): update curate-session prompt for explicit enrichment flow (SKY-XX)"
```

---

## Task 5: Update Glossary + curate_post Description

**Files:**
- Modify: `src/mcp/glossary.ts`
- Modify: `src/mcp/Toolkit.ts` (curate_post description)

### Step 1: Update glossary

Add `start_enrichment` to the Write Tools section:

```
**start_enrichment** — Queue enrichment for a curated post. Auto-detects type from embed (vision for charts/screenshots, source-attribution for links). Proxies to the enrichment workflow. Use get_post_enrichments to poll readiness. Requires curation:write scope.
```

Update `curate_post` description to remove the enrichment promise:

```
**curate_post** — Advance a candidate to Enriching (curate) or Rejected (reject). Curating fetches live embed data from Bluesky and captures the payload. Call start_enrichment separately to queue enrichment. Requires curation:write scope.
```

### Step 2: Update curate_post tool description

In `src/mcp/Toolkit.ts`, update the `CuratePostTool` description to match:

```ts
description: "Curate or reject a post. Curating fetches live embed data from Bluesky and captures the payload. Call start_enrichment separately to queue enrichment processing. Rejecting dismisses the post. Idempotent."
```

### Step 3: Run tests

Run: `bun run test`
Expected: PASS

### Step 4: Commit

```bash
git add src/mcp/glossary.ts src/mcp/Toolkit.ts
git commit -m "docs(mcp): update glossary and curate_post description for explicit enrichment (SKY-XX)"
```

---

## Task 6: MCP Tests

**Files:**
- Modify: `tests/mcp.test.ts` — update tool counts, add start_enrichment test

### Step 1: Update tool name assertions

The read-only tool list stays at 13 tools (start_enrichment is NOT a read tool).

For the workflow-write profile test (if it exists), verify `start_enrichment` appears. If no profile-specific tool list test exists for workflow-write, add one.

### Step 2: Add start_enrichment tool test

```ts
describe("MCP start_enrichment", () => {
  it.live("start_enrichment requires curated post", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const seedLayer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(seedLayer)));

        const { client, close } = await createMcpClient(
          makeBiLayer({ filename }),
          workflowIdentity
        );

        try {
          // Try to start enrichment on a post that hasn't been curated
          const result = await client.callTool({
            name: "start_enrichment",
            arguments: { postUri: `at://${sampleDid}/app.bsky.feed.post/post-solar` }
          });
          expect(result.isError).toBe(true);
        } finally {
          await close();
        }
      })
    )
  );
});
```

NOTE: A full integration test requires the trigger client to be wired into the test layer. The test layer doesn't have `INGEST_SERVICE`. You may need to provide a mock `EnrichmentTriggerClient` in the test layer, or use `Effect.serviceOption` so the tool handler gracefully reports "enrichment not available in test mode" instead of crashing.

### Step 3: Run tests

Run: `bun run test tests/mcp.test.ts`
Expected: PASS

### Step 4: Commit

```bash
git add tests/mcp.test.ts
git commit -m "test(mcp): add start_enrichment tool tests (SKY-XX)"
```

---

## Task 7: Gate submit_editorial_pick on Enrichment Readiness (SKY-83)

**Files:**
- Modify: `src/mcp/Toolkit.ts` — add readiness check in submit_editorial_pick handler
- Modify: `tests/mcp.test.ts` or new test file

### Step 1: Add readiness gate

In `src/mcp/Toolkit.ts`, in the `makeSubmitPickHandler` function, after the existing curation status check (which verifies the post is curated), add an enrichment readiness check:

```ts
// After: if (curation === null || curation.status !== "curated") { ... }

const enrichment = yield* enrichmentReadService.getPost(input.postUri);
if (enrichment.readiness !== "complete") {
  return yield* McpToolQueryError.make({
    tool: "submit_editorial_pick",
    message: `Post enrichment is not complete (readiness: ${enrichment.readiness}). Use start_enrichment to trigger enrichment, then poll get_post_enrichments until readiness is "complete".`,
    error: new Error("enrichment not complete")
  });
}
```

The `enrichmentReadService` is already available in the handler layers (added in SKY-77). The `makeSubmitPickHandler` function needs to accept it as a parameter, similar to how `makeReadOnlyHandlers` accepts it.

### Step 2: Add test

Add a test that verifies `submit_editorial_pick` rejects a curated but un-enriched post:

```ts
it.live("submit_editorial_pick rejects when enrichment not complete", () =>
  Effect.promise(() =>
    withTempSqliteFile(async (filename) => {
      const layer = makeBiLayer({ filename });
      await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

      // Curate a post (but don't enrich it)
      const { client, close } = await createMcpClient(
        makeBiLayer({ filename }),
        workflowIdentity
      );

      try {
        await client.callTool({
          name: "curate_post",
          arguments: {
            postUri: `at://${sampleDid}/app.bsky.feed.post/post-solar`,
            action: "curate",
            note: "test"
          }
        });

        // Try to accept without enrichment
        const result = await client.callTool({
          name: "submit_editorial_pick",
          arguments: {
            postUri: `at://${sampleDid}/app.bsky.feed.post/post-solar`,
            score: 80,
            reason: "test pick"
          }
        });
        expect(result.isError).toBe(true);
        const text = result.content.find(
          (c): c is { type: "text"; text: string } => c.type === "text"
        );
        expect(text!.text).toContain("enrichment is not complete");
      } finally {
        await close();
      }
    })
  )
);
```

### Step 3: Run tests

Run: `bun run test tests/mcp.test.ts`
Expected: PASS

### Step 4: Commit

```bash
git add src/mcp/Toolkit.ts tests/mcp.test.ts
git commit -m "feat(mcp): gate submit_editorial_pick on enrichment readiness (SKY-83)"
```

---

## Verification Checklist

1. `bunx tsc --noEmit` — zero errors
2. `bun run test` — all tests pass
3. MCP tool counts:
   - read-only: 13 tools (unchanged)
   - curation-write: 15 tools (+start_enrichment)
   - editorial-write: 14 tools (unchanged — no curation:write scope)
   - workflow-write: 16 tools (+start_enrichment)
4. `start_enrichment` proxies through `INGEST_SERVICE` to ingest worker
5. `curate_post` no longer promises automatic enrichment
6. `curate-session` prompt teaches: curate → start_enrichment → poll get_post_enrichments (multi-step for visual posts) → accept
7. Glossary documents `start_enrichment` in Write Tools
8. `submit_editorial_pick` rejects posts where readiness !== "complete" (SKY-83)

## Explicitly Out of Scope

- MCP Tasks spec (2025-11-25) — future upgrade when clients support it
- Progress notifications during enrichment — blocked on spec support
- Auto-detecting enrichment type from post content analysis — just uses embed type
- Retry semantics — existing `/admin/enrichment/runs/:id/retry` handles this
- Removing `queuePickedEnrichment` from `CurationService` — can be cleaned up separately but doesn't hurt to leave it (it's a no-op on the agent worker)
