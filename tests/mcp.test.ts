import { Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { describe, expect, it } from "@effect/vitest";
import { parseAvatarUrl } from "../src/bluesky/BskyCdn";
import { BlueskyClient } from "../src/bluesky/BlueskyClient";
import { runMigrations } from "../src/db/migrate";
import { Did, type PostUri } from "../src/domain/types";
import { decodeCallToolResultWith } from "../src/mcp/Client";
import { BULK_CURATE_MAX_DECISIONS } from "../src/domain/curation";
import { BULK_START_ENRICHMENT_MAX_POSTS } from "../src/domain/enrichment";
import { createPersistentMcpHandler } from "../src/mcp/Router";
import {
  AddExpertMcpOutput,
  BulkCurateMcpOutput,
  BulkStartEnrichmentMcpOutput,
  CurationCandidatesMcpOutput,
  EnrichmentGapsMcpOutput,
  EnrichmentIssuesMcpOutput,
  KnowledgePostsMcpOutput,
  ExpertListMcpOutput,
  OntologyTopicsMcpOutput,
  EditorialPickBundleMcpOutput,
  EditorialPicksMcpOutput,
  PipelineStatusMcpOutput,
  ImportPostsMcpOutput,
  SetExpertActiveMcpOutput,
  ThreadDocumentMcpOutput
} from "../src/mcp/OutputSchemas";
import { EnrichmentTriggerClient } from "../src/services/EnrichmentTriggerClient";
import { smokeFixtureUris } from "../src/staging/SmokeFixture";
import {
  createMcpClient,
  expertsWriteIdentity,
  makeBiLayer,
  opsCurationWriteIdentity,
  opsEditorialWriteIdentity,
  opsExpertsWriteIdentity,
  opsReadIdentity,
  opsRefreshIdentity,
  readOnlyIdentity,
  markEditorialFixturePostDeleted,
  seedEditorialPickBundleFixture,
  workflowIdentity,
  workflowWriteIdentity,
  sampleDid,
  seedKnowledgeBase,
  withTempSqliteFile
} from "./support/runtime";

const decodeSearchResponse = decodeCallToolResultWith(KnowledgePostsMcpOutput);
const decodeCurationCandidatesResponse = decodeCallToolResultWith(CurationCandidatesMcpOutput);
const decodeBulkCurateResponse = decodeCallToolResultWith(BulkCurateMcpOutput);
const decodeBulkStartEnrichmentResponse = decodeCallToolResultWith(BulkStartEnrichmentMcpOutput);
const decodeEnrichmentGapsResponse = decodeCallToolResultWith(EnrichmentGapsMcpOutput);
const decodeEnrichmentIssuesResponse = decodeCallToolResultWith(EnrichmentIssuesMcpOutput);
const decodeExpertsResponse = decodeCallToolResultWith(ExpertListMcpOutput);
const decodeTopicsResponse = decodeCallToolResultWith(OntologyTopicsMcpOutput);
const decodeEditorialPickBundleResponse = decodeCallToolResultWith(EditorialPickBundleMcpOutput);
const decodeEditorialPicksResponse = decodeCallToolResultWith(EditorialPicksMcpOutput);
const decodePipelineStatusResponse = decodeCallToolResultWith(PipelineStatusMcpOutput);
const decodeImportPostsResponse = decodeCallToolResultWith(ImportPostsMcpOutput);
const decodeAddExpertResponse = decodeCallToolResultWith(AddExpertMcpOutput);
const decodeSetExpertActiveResponse = decodeCallToolResultWith(SetExpertActiveMcpOutput);
const decodeThreadDocumentResponse = decodeCallToolResultWith(ThreadDocumentMcpOutput);
const decodeDid = Schema.decodeUnknownSync(Did);

const expertRegistryDid = decodeDid("did:plc:mcp-expert-1");
const expertRegistryHandle = "gridwatch.bsky.social";
const expertRegistryDisplayName = "Grid Watch";
const expertRegistryAvatar = parseAvatarUrl(
  "https://cdn.bsky.app/img/avatar/plain/did:plc:mcp-expert-1/avatar@jpeg"
);

const makeExpertRegistryBlueskyLayer = () =>
  Layer.succeed(BlueskyClient, {
    resolveDidOrHandle: (input: string) =>
      Effect.succeed({
        did: expertRegistryDid,
        handle: input.startsWith("did:") ? expertRegistryHandle : input
      }),
    getProfile: () =>
      Effect.succeed({
        did: expertRegistryDid,
        handle: expertRegistryHandle,
        displayName: expertRegistryDisplayName,
        description: "Energy market analyst",
        avatar: expertRegistryAvatar
      }),
    getFollows: () =>
      Effect.die("unexpected getFollows"),
    resolveRepoService: () =>
      Effect.die("unexpected resolveRepoService"),
    listRecordsAtService: () =>
      Effect.die("unexpected listRecordsAtService"),
    getPostThread: () =>
      Effect.die("unexpected getPostThread"),
    getPosts: () =>
      Effect.die("unexpected getPosts")
  } as any);

const makeThreadNode = (
  uri: string,
  opts?: {
    readonly parent?: unknown;
    readonly replies?: ReadonlyArray<unknown>;
  }
) => ({
  $type: "app.bsky.feed.defs#threadViewPost",
  post: {
    uri,
    cid: `cid-${uri}`,
    author: {
      did: sampleDid,
      handle: "seed.example.com",
      displayName: "Seed Example"
    },
    record: {
      text: `Thread ${uri}`,
      createdAt: "2026-03-18T12:00:00.000Z",
      $type: "app.bsky.feed.post"
    },
    replyCount: opts?.replies?.length ?? 0,
    repostCount: 1,
    likeCount: 2,
    quoteCount: 0,
    indexedAt: "2026-03-18T12:05:00.000Z"
  },
  ...(opts?.parent === undefined ? {} : { parent: opts.parent }),
  ...(opts?.replies === undefined ? {} : { replies: Array.from(opts.replies) })
});

const makeThreadBlueskyLayer = (focusUri: string) => {
  const ancestorUri = `at://${sampleDid}/app.bsky.feed.post/thread-parent`;
  const replyUri = `at://${sampleDid}/app.bsky.feed.post/thread-reply`;
  const reply = makeThreadNode(replyUri);
  const ancestor = makeThreadNode(ancestorUri);
  const focus = makeThreadNode(focusUri, {
    parent: ancestor,
    replies: [reply]
  });

  return Layer.succeed(BlueskyClient, {
    resolveDidOrHandle: () => Effect.die("unexpected resolveDidOrHandle"),
    getProfile: () => Effect.die("unexpected getProfile"),
    getFollows: () => Effect.die("unexpected getFollows"),
    resolveRepoService: () => Effect.die("unexpected resolveRepoService"),
    listRecordsAtService: () => Effect.die("unexpected listRecordsAtService"),
    getPostThread: () => Effect.succeed({ thread: focus }),
    getPosts: () => Effect.die("unexpected getPosts")
  } as any);
};

const initializePersistentPromptSession = async (
  layer: ReturnType<typeof makeBiLayer>
) => {
  const webHandler = createPersistentMcpHandler(layer, readOnlyIdentity);

  const post = async (
    body: unknown,
    headers: Record<string, string> = {}
  ) =>
    webHandler.handler(new Request("https://skygest.local/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...headers
      },
      body: JSON.stringify(body)
    }));

  const initResponse = await post({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: {
        name: "skygest-mcp-tests",
        version: "0.1.0"
      }
    }
  });

  const sessionId = initResponse.headers.get("mcp-session-id");
  if (sessionId == null) {
    throw new Error("missing MCP session id");
  }

  await post(
    {
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {}
    },
    { "mcp-session-id": sessionId }
  );

  return {
    getPrompt: async (name: string, args: Record<string, string>) => {
      const response = await post(
        {
          jsonrpc: "2.0",
          id: 2,
          method: "prompts/get",
          params: {
            name,
            arguments: args
          }
        },
        { "mcp-session-id": sessionId }
      );

      return response.text();
    },
    close: () => webHandler.dispose()
  };
};

const getTextContent = (result: {
  readonly content: ReadonlyArray<{
    readonly type: string;
    readonly text?: string;
  }>;
}) => {
  const textContent = result.content.find(
    (content): content is { type: "text"; text: string } =>
      content.type === "text" && typeof content.text === "string"
  );

  if (textContent === undefined) {
    throw new Error("missing text content");
  }

  return textContent.text;
};

describe("read-only MCP server", () => {
  it.live("serves the phase-one tools and returns structured search data", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const seedLayer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(seedLayer)));

        const { client, close } = await createMcpClient(makeBiLayer({ filename }));

        try {
          const tools = await client.listTools();
          expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
            "expand_topics",
            "explain_post_topics",
            "get_editorial_pick_bundle",
            "get_post_enrichments",
            "get_post_links",
            "get_post_thread",
            "get_recent_posts",
            "get_thread_document",
            "get_topic",
            "list_curation_candidates",
            "list_editorial_picks",
            "list_enrichment_gaps",
            "list_enrichment_issues",
            "list_experts",
            "list_topics",
            "search_posts"
          ]);

          const search = await client.callTool({
            name: "search_posts",
            arguments: { query: "solar" }
          });
          const experts = await client.callTool({
            name: "list_experts",
            arguments: { domain: "energy" }
          });
          const topics = await client.callTool({
            name: "list_topics",
            arguments: { view: "facets" }
          });
          const searchItems = decodeSearchResponse(search).items;
          const expertItems = decodeExpertsResponse(experts).items;
          const topicItems = decodeTopicsResponse(topics).items;
          const searchTool = tools.tools.find((tool) => tool.name === "search_posts");

          expect(searchItems).toHaveLength(1);
          expect(searchItems[0]?.topics).toContain("solar");
          expect(expertItems.length).toBeGreaterThan(0);
          expect(expertItems[0]?.domain).toBe("energy");
          expect(topicItems.some((item) => item.slug === "solar")).toBe(true);
          expect(searchTool?.description).toContain("quoted phrases");
          expect(searchTool?.description).toContain("OR / NOT");
          expect(searchTool?.description).toContain("expert handles");
          expect(searchTool?.description).toContain("exact handle phrases");
          expect(searchTool?.description).toContain("topic-match terms");
        } finally {
          await close();
        }
      })
    ),
    15_000
  );
});

describe("MCP display formatting", () => {
  it.live("tool responses include _display in structuredContent and as text payload", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const seedLayer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(seedLayer)));

        const { client, close } = await createMcpClient(makeBiLayer({ filename }));

        try {
          const result = await client.callTool({
            name: "search_posts",
            arguments: { query: "solar" }
          });

          // structuredContent should include _display as a string
          const sc = result.structuredContent as Record<string, unknown>;
          expect(sc).toBeDefined();
          expect(typeof sc._display).toBe("string");
          expect((sc._display as string).length).toBeGreaterThan(0);

          // text content should be the display string, NOT raw JSON
          const textContent = result.content.find(
            (c): c is { type: "text"; text: string } => c.type === "text"
          );
          expect(textContent).toBeDefined();
          expect(textContent!.text).not.toMatch(/^\s*\{/);
          expect(textContent!.text).toContain("[P");

          // MCP wrapper schema decode should succeed (includes _display)
          const decoded = decodeSearchResponse(result);
          expect(decoded.items).toHaveLength(1);
          expect(decoded._display).toBe(textContent!.text);
        } finally {
          await close();
        }
      })
    )
  );

  it.live("experts tool response has display text with [E prefix", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const seedLayer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(seedLayer)));

        const { client, close } = await createMcpClient(makeBiLayer({ filename }));

        try {
          const result = await client.callTool({
            name: "list_experts",
            arguments: { domain: "energy" }
          });

          const textContent = result.content.find(
            (c): c is { type: "text"; text: string } => c.type === "text"
          );
          expect(textContent).toBeDefined();
          expect(textContent!.text).toContain("[E");

          const decoded = decodeExpertsResponse(result);
          expect(decoded.items.length).toBeGreaterThan(0);
          expect(typeof decoded._display).toBe("string");
        } finally {
          await close();
        }
      })
    )
  );

  it.live("thread document responses include _display in structuredContent and as text payload", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const [solarUri] = smokeFixtureUris(sampleDid);
        const seedLayer = makeBiLayer({
          filename,
          blueskyClient: makeThreadBlueskyLayer(solarUri)
        });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(seedLayer)));

        const { client, close } = await createMcpClient(seedLayer);

        try {
          const result = await client.callTool({
            name: "get_thread_document",
            arguments: { postUri: solarUri }
          });

          // structuredContent should include _display as a string
          const sc = result.structuredContent as Record<string, unknown>;
          expect(sc).toBeDefined();
          expect(typeof sc._display).toBe("string");
          expect((sc._display as string).length).toBeGreaterThan(0);

          // text content should be the display string, NOT raw JSON
          const textContent = result.content.find(
            (c): c is { type: "text"; text: string } => c.type === "text"
          );
          expect(textContent).toBeDefined();
          expect(textContent!.text).not.toMatch(/^\s*\{/);

          const decoded = decodeThreadDocumentResponse(result);
          expect(typeof decoded._display).toBe("string");
          expect(decoded._display).toBe(textContent!.text);
          expect(decoded.body).toContain(solarUri);
          expect(decoded.body).toContain("@");
        } finally {
          await close();
        }
      })
    )
  );

  it.live("thread document returns error for unavailable thread", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const [solarUri] = smokeFixtureUris(sampleDid);
        const notFoundLayer = Layer.succeed(BlueskyClient, {
          resolveDidOrHandle: () => Effect.die("unexpected resolveDidOrHandle"),
          getProfile: () => Effect.die("unexpected getProfile"),
          getFollows: () => Effect.die("unexpected getFollows"),
          resolveRepoService: () => Effect.die("unexpected resolveRepoService"),
          listRecordsAtService: () => Effect.die("unexpected listRecordsAtService"),
          getPostThread: () => Effect.succeed({
            thread: { $type: "app.bsky.feed.defs#notFoundPost", uri: solarUri, notFound: true }
          }),
          getPosts: () => Effect.die("unexpected getPosts")
        } as any);
        const seedLayer = makeBiLayer({
          filename,
          blueskyClient: notFoundLayer
        });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(seedLayer)));

        const { client, close } = await createMcpClient(seedLayer);

        try {
          const result = await client.callTool({
            name: "get_thread_document",
            arguments: { postUri: solarUri }
          });

          expect(result.isError).toBe(true);
          const textContent = result.content.find(
            (c): c is { type: "text"; text: string } => c.type === "text"
          );
          expect(textContent).toBeDefined();
          expect(textContent!.text).toContain("Post not found or thread unavailable");
        } finally {
          await close();
        }
      })
    )
  );

  it.live("topics tool response has display text with [T prefix", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const seedLayer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(seedLayer)));

        const { client, close } = await createMcpClient(makeBiLayer({ filename }));

        try {
          const result = await client.callTool({
            name: "list_topics",
            arguments: { view: "facets" }
          });

          const textContent = result.content.find(
            (c): c is { type: "text"; text: string } => c.type === "text"
          );
          expect(textContent).toBeDefined();
          expect(textContent!.text).toContain("[T");

          const decoded = decodeTopicsResponse(result);
          expect(decoded.items.length).toBeGreaterThan(0);
          expect(typeof decoded._display).toBe("string");
        } finally {
          await close();
        }
      })
    )
  );
});

describe("MCP list_editorial_picks", () => {
  const fixtureUris = smokeFixtureUris(sampleDid);
  const solarUri = fixtureUris[0] as PostUri;

  it.live("returns submitted picks via MCP tool", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        // Insert a pick directly via SQL
        await Effect.runPromise(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            yield* sql`
              INSERT INTO editorial_picks (post_uri, score, reason, category, curator, status, picked_at, expires_at)
              VALUES (${solarUri}, 85, 'Important solar analysis', 'analysis', 'test-curator', 'active', ${Date.now()}, NULL)
            `;
          }).pipe(Effect.provide(layer))
        );

        const { client, close } = await createMcpClient(makeBiLayer({ filename }));

        try {
          const result = await client.callTool({
            name: "list_editorial_picks",
            arguments: {}
          });
          const picks = decodeEditorialPicksResponse(result);

          expect(picks.items.length).toBeGreaterThan(0);
          const pick = picks.items.find((p) => p.postUri === solarUri);
          expect(pick).toBeDefined();
          expect(pick!.score).toBe(85);
          expect(pick!.reason).toBe("Important solar analysis");
          expect(pick!.category).toBe("analysis");
          expect(pick!.curator).toBe("test-curator");
        } finally {
          await close();
        }
      })
    )
  );

  it.live("respects minScore filter", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        const windUri = fixtureUris[1];

        // Insert two picks with different scores
        await Effect.runPromise(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            yield* sql`
              INSERT INTO editorial_picks (post_uri, score, reason, category, curator, status, picked_at, expires_at)
              VALUES (${solarUri}, 90, 'High score', 'analysis', 'curator', 'active', ${Date.now()}, NULL)
            `;
            yield* sql`
              INSERT INTO editorial_picks (post_uri, score, reason, category, curator, status, picked_at, expires_at)
              VALUES (${windUri}, 40, 'Low score', 'discussion', 'curator', 'active', ${Date.now()}, NULL)
            `;
          }).pipe(Effect.provide(layer))
        );

        const { client, close } = await createMcpClient(makeBiLayer({ filename }));

        try {
          const highOnly = await client.callTool({
            name: "list_editorial_picks",
            arguments: { minScore: 80 }
          });
          const highPicks = decodeEditorialPicksResponse(highOnly);
          expect(highPicks.items).toHaveLength(1);
          expect(highPicks.items[0]!.postUri).toBe(solarUri);

          const all = await client.callTool({
            name: "list_editorial_picks",
            arguments: {}
          });
          const allPicks = decodeEditorialPicksResponse(all);
          expect(allPicks.items).toHaveLength(2);
        } finally {
          await close();
        }
      })
    )
  );
});

describe("MCP get_editorial_pick_bundle", () => {
  const fixtureUris = smokeFixtureUris(sampleDid);
  const solarUri = fixtureUris[0] as PostUri;

  it.live("returns the structured pick bundle and display text", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));
        await seedEditorialPickBundleFixture(layer, solarUri);

        const { client, close } = await createMcpClient(makeBiLayer({ filename }));

        try {
          const result = await client.callTool({
            name: "get_editorial_pick_bundle",
            arguments: { postUri: solarUri }
          });
          const bundle = decodeEditorialPickBundleResponse(result);

          expect(bundle.post_uri).toBe(solarUri);
          expect(bundle.post.author).toBe(sampleDid);
          expect(bundle.editorial_pick.score).toBe(85);
          expect(bundle.editorial_pick.curator).toBe("test-curator");
          expect(bundle.enrichments.readiness).toBe("complete");
          expect(bundle.enrichments.vision).toBeUndefined();
          expect(bundle.enrichments.source_attribution?.provider?.providerId).toBe("ercot");
          expect(bundle.source_providers).toEqual(["ercot"]);
          expect(bundle.resolved_expert).toBe("Skygest Seed Primary");
          expect(bundle._display).toContain(`Pick: ${solarUri}`);
          expect(getTextContent(result)).toContain("Readiness: complete");
        } finally {
          await close();
        }
      })
    )
  );

  it.live("returns full enrichments when vision data is present", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));
        await seedEditorialPickBundleFixture(layer, solarUri, {
          withVisionEnrichment: true
        });

        const { client, close } = await createMcpClient(makeBiLayer({ filename }));

        try {
          const result = await client.callTool({
            name: "get_editorial_pick_bundle",
            arguments: { postUri: solarUri }
          });
          const bundle = decodeEditorialPickBundleResponse(result);

          expect(bundle.enrichments.readiness).toBe("complete");
          expect(bundle.enrichments.vision?.kind).toBe("vision");
          expect(bundle.enrichments.vision?.summary.text).toContain("ERCOT load");
          expect(bundle.enrichments.source_attribution?.provider?.providerId).toBe("ercot");
        } finally {
          await close();
        }
      })
    )
  );

  it.live("rejects a URI that is not a committed editorial pick", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        const { client, close } = await createMcpClient(makeBiLayer({ filename }));

        try {
          const result = await client.callTool({
            name: "get_editorial_pick_bundle",
            arguments: { postUri: solarUri }
          });

          expect(result.isError).toBe(true);
          expect(getTextContent(result)).toContain("not a committed editorial pick");
        } finally {
          await close();
        }
      })
    )
  );

  it.live("rejects a pick whose backing post row is no longer active", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));
        await seedEditorialPickBundleFixture(layer, solarUri);
        await markEditorialFixturePostDeleted(layer, solarUri);

        const { client, close } = await createMcpClient(makeBiLayer({ filename }));

        try {
          const result = await client.callTool({
            name: "get_editorial_pick_bundle",
            arguments: { postUri: solarUri }
          });

          expect(result.isError).toBe(true);
          expect(getTextContent(result)).toContain(`post not found: ${solarUri}`);
        } finally {
          await close();
        }
      })
    )
  );

  it.live("rejects a committed pick whose enrichment is still incomplete", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));
        await seedEditorialPickBundleFixture(layer, solarUri, {
          withEnrichment: false
        });

        const { client, close } = await createMcpClient(makeBiLayer({ filename }));

        try {
          const result = await client.callTool({
            name: "get_editorial_pick_bundle",
            arguments: { postUri: solarUri }
          });

          expect(result.isError).toBe(true);
          expect(getTextContent(result)).toContain("enrichment is not complete");
        } finally {
          await close();
        }
      })
    )
  );
});

describe("MCP prompts by profile", () => {
  it.live("read-only profile exposes 3 prompts (no curate-session)", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        const { client, close } = await createMcpClient(makeBiLayer({ filename }), readOnlyIdentity);

        try {
          const prompts = await client.listPrompts();
          const names = prompts.prompts.map((p) => p.name).sort();
          expect(names).toEqual(["assess-expert", "curate-digest", "explore-topic"]);
        } finally {
          await close();
        }
      })
    )
  );

  it.live("workflow-write-refresh profile exposes 5 prompts including assemble-stories and curate-session", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        const { client, close } = await createMcpClient(makeBiLayer({ filename }), workflowIdentity);

        try {
          const prompts = await client.listPrompts();
          const names = prompts.prompts.map((p) => p.name).sort();
          expect(names).toEqual(["assemble-stories", "assess-expert", "curate-digest", "curate-session", "explore-topic"]);
        } finally {
          await close();
        }
      })
    )
  );

  it.live("explore-topic prompt teaches the model the supported search syntax", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        const { getPrompt, close } = await initializePersistentPromptSession(layer);

        try {
          const promptJson = await getPrompt("explore-topic", { query: "solar" });
          expect(promptJson).toContain("quoted phrases");
          expect(promptJson).toContain("OR / NOT");
          expect(promptJson).toContain("prefix search");
          expect(promptJson).toContain("full Bluesky handle");
          expect(promptJson).toContain("electro*");
        } finally {
          await close();
        }
      })
    )
  );
});

describe("MCP tool visibility by profile", () => {
  it.live("experts-write profile includes expert tools but not operator or workflow tools", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const seedLayer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(seedLayer)));

        const { client, close } = await createMcpClient(
          makeBiLayer({ filename }),
          expertsWriteIdentity
        );

        try {
          const tools = await client.listTools();
          const names = tools.tools.map((t) => t.name);
          expect(names).toContain("add_expert");
          expect(names).toContain("set_expert_active");
          expect(names).not.toContain("get_pipeline_status");
          expect(names).not.toContain("import_posts");
          expect(names).not.toContain("curate_post");
          expect(names).not.toContain("bulk_curate");
          expect(names).not.toContain("start_enrichment");
          expect(names).not.toContain("bulk_start_enrichment");
          expect(names).not.toContain("submit_editorial_pick");
        } finally {
          await close();
        }
      })
    )
  );

  it.live("workflow-write profile includes write tools but not operator tools", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const seedLayer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(seedLayer)));

        const { client, close } = await createMcpClient(
          makeBiLayer({ filename }),
          workflowWriteIdentity
        );

        try {
          const tools = await client.listTools();
          const names = tools.tools.map((t) => t.name);
          expect(names).not.toContain("get_pipeline_status");
          expect(names).not.toContain("import_posts");
          expect(names).not.toContain("add_expert");
          expect(names).not.toContain("set_expert_active");
          expect(names).toContain("start_enrichment");
          expect(names).toContain("bulk_start_enrichment");
          expect(names).toContain("curate_post");
          expect(names).toContain("bulk_curate");
          expect(names).toContain("submit_editorial_pick");
        } finally {
          await close();
        }
      })
    )
  );

  it.live("ops-workflow profile includes operator and write tools", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const seedLayer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(seedLayer)));

        const { client, close } = await createMcpClient(
          makeBiLayer({ filename }),
          workflowIdentity
        );

        try {
          const tools = await client.listTools();
          const names = tools.tools.map((t) => t.name);
          expect(names).toContain("get_pipeline_status");
          expect(names).toContain("import_posts");
          expect(names).toContain("add_expert");
          expect(names).toContain("set_expert_active");
          expect(names).toContain("start_enrichment");
          expect(names).toContain("bulk_start_enrichment");
          expect(names).toContain("curate_post");
          expect(names).toContain("bulk_curate");
          expect(names).toContain("submit_editorial_pick");
        } finally {
          await close();
        }
      })
    )
  );

  it.live("ops-curation-write profile includes pipeline status and curation tools only", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const seedLayer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(seedLayer)));

        const { client, close } = await createMcpClient(
          makeBiLayer({ filename }),
          opsCurationWriteIdentity
        );

        try {
          const tools = await client.listTools();
          const names = tools.tools.map((t) => t.name);
          expect(names).toContain("get_pipeline_status");
          expect(names).not.toContain("import_posts");
          expect(names).not.toContain("add_expert");
          expect(names).not.toContain("set_expert_active");
          expect(names).toContain("curate_post");
          expect(names).toContain("bulk_curate");
          expect(names).toContain("start_enrichment");
          expect(names).toContain("bulk_start_enrichment");
          expect(names).not.toContain("submit_editorial_pick");
        } finally {
          await close();
        }
      })
    )
  );

  it.live("ops-editorial-write profile includes pipeline status and editorial tools only", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const seedLayer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(seedLayer)));

        const { client, close } = await createMcpClient(
          makeBiLayer({ filename }),
          opsEditorialWriteIdentity
        );

        try {
          const tools = await client.listTools();
          const names = tools.tools.map((t) => t.name);
          expect(names).toContain("get_pipeline_status");
          expect(names).not.toContain("import_posts");
          expect(names).not.toContain("add_expert");
          expect(names).not.toContain("set_expert_active");
          expect(names).toContain("submit_editorial_pick");
          expect(names).not.toContain("curate_post");
          expect(names).not.toContain("bulk_curate");
          expect(names).not.toContain("start_enrichment");
          expect(names).not.toContain("bulk_start_enrichment");
        } finally {
          await close();
        }
      })
    )
  );

  it.live("read-only profile does not include operator or write tools", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const seedLayer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(seedLayer)));

        const { client, close } = await createMcpClient(
          makeBiLayer({ filename }),
          readOnlyIdentity
        );

        try {
          const tools = await client.listTools();
          const names = tools.tools.map((t) => t.name);
          expect(names).toContain("list_enrichment_gaps");
          expect(names).toContain("list_enrichment_issues");
          expect(names).not.toContain("get_pipeline_status");
          expect(names).not.toContain("import_posts");
          expect(names).not.toContain("add_expert");
          expect(names).not.toContain("set_expert_active");
          expect(names).not.toContain("start_enrichment");
          expect(names).not.toContain("bulk_start_enrichment");
          expect(names).not.toContain("curate_post");
          expect(names).not.toContain("bulk_curate");
        } finally {
          await close();
        }
      })
    )
  );

  it.live("ops-read profile includes get_pipeline_status but not import_posts or write tools", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const seedLayer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(seedLayer)));

        const { client, close } = await createMcpClient(
          makeBiLayer({ filename }),
          opsReadIdentity
        );

        try {
          const tools = await client.listTools();
          const names = tools.tools.map((t) => t.name);
          expect(names).toContain("get_pipeline_status");
          expect(names).not.toContain("import_posts");
          expect(names).not.toContain("add_expert");
          expect(names).not.toContain("set_expert_active");
          expect(names).not.toContain("start_enrichment");
          expect(names).not.toContain("bulk_start_enrichment");
          expect(names).not.toContain("curate_post");
          expect(names).not.toContain("bulk_curate");
          expect(names).not.toContain("submit_editorial_pick");
        } finally {
          await close();
        }
      })
    )
  );

  it.live("ops-refresh profile includes import_posts but not pipeline status or write tools", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const seedLayer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(seedLayer)));

        const { client, close } = await createMcpClient(
          makeBiLayer({ filename }),
          opsRefreshIdentity
        );

        try {
          const tools = await client.listTools();
          const names = tools.tools.map((t) => t.name);
          expect(names).not.toContain("get_pipeline_status");
          expect(names).toContain("import_posts");
          expect(names).not.toContain("add_expert");
          expect(names).not.toContain("set_expert_active");
          expect(names).not.toContain("curate_post");
          expect(names).not.toContain("bulk_curate");
          expect(names).not.toContain("submit_editorial_pick");
          expect(names).not.toContain("start_enrichment");
          expect(names).not.toContain("bulk_start_enrichment");
        } finally {
          await close();
        }
      })
    )
  );

  it.live("ops-experts-write profile combines expert tools with pipeline status only", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const seedLayer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(seedLayer)));

        const { client, close } = await createMcpClient(
          makeBiLayer({ filename }),
          opsExpertsWriteIdentity
        );

        try {
          const tools = await client.listTools();
          const names = tools.tools.map((t) => t.name);
          expect(names).toContain("get_pipeline_status");
          expect(names).toContain("add_expert");
          expect(names).toContain("set_expert_active");
          expect(names).not.toContain("import_posts");
          expect(names).not.toContain("curate_post");
          expect(names).not.toContain("bulk_curate");
          expect(names).not.toContain("start_enrichment");
          expect(names).not.toContain("bulk_start_enrichment");
          expect(names).not.toContain("submit_editorial_pick");
        } finally {
          await close();
        }
      })
    )
  );
});

describe("MCP get_pipeline_status", () => {
  const seedPipelineStatusFixture = (now: number) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* sql`
        INSERT INTO experts (
          did,
          handle,
          display_name,
          description,
          avatar,
          domain,
          source,
          source_ref,
          shard,
          active,
          tier,
          added_at,
          last_synced_at
        ) VALUES
          (${sampleDid}, ${"solar.bsky.social"}, ${"Solar"}, NULL, NULL, ${"energy"}, ${"manual"}, NULL, 0, 1, ${"energy-focused"}, ${now - 1000}, NULL),
          (${`did:x:manual-twitter`}, ${"gridwatch"}, ${"Grid Watch"}, NULL, NULL, ${"energy"}, ${"manual"}, NULL, 0, 1, ${"general-outlet"}, ${now - 900}, NULL),
          (${`did:plc:independent-1`}, ${"indie.bsky.social"}, ${"Indie"}, NULL, NULL, ${"energy"}, ${"bluesky-import"}, NULL, 0, 1, ${"independent"}, ${now - 800}, NULL),
          (${`did:plc:inactive-1`}, ${"inactive.bsky.social"}, ${"Inactive"}, NULL, NULL, ${"energy"}, ${"bluesky-import"}, NULL, 0, 0, ${"general-outlet"}, ${now - 700}, NULL)
      `;

      yield* sql`
        INSERT INTO posts (
          uri,
          did,
          cid,
          text,
          created_at,
          indexed_at,
          has_links,
          status,
          ingest_id,
          embed_type
        ) VALUES
          (${`at://${sampleDid}/app.bsky.feed.post/status-1`}, ${sampleDid}, ${"cid-status-1"}, ${"Bluesky active curated post"}, ${now - 700}, ${now - 700}, 0, ${"active"}, ${"ingest-status-1"}, NULL),
          (${`x://tweet/status-2`}, ${`did:x:manual-twitter`}, ${"cid-status-2"}, ${"Twitter active rejected post"}, ${now - 600}, ${now - 600}, 1, ${"active"}, ${"ingest-status-2"}, ${"link"}),
          (${`at://did:plc:independent-1/app.bsky.feed.post/status-3`}, ${`did:plc:independent-1`}, ${"cid-status-3"}, ${"Bluesky active flagged post"}, ${now - 500}, ${now - 500}, 0, ${"active"}, ${"ingest-status-3"}, NULL),
          (${`at://${sampleDid}/app.bsky.feed.post/status-4`}, ${sampleDid}, ${"cid-status-4"}, ${"Bluesky active uncurated post"}, ${now - 400}, ${now - 400}, 0, ${"active"}, ${"ingest-status-4"}, NULL),
          (${`at://did:plc:inactive-1/app.bsky.feed.post/status-5`}, ${`did:plc:inactive-1`}, ${"cid-status-5"}, ${"Deleted post"}, ${now - 300}, ${now - 300}, 0, ${"deleted"}, ${"ingest-status-5"}, NULL)
      `;

      yield* sql`
        INSERT INTO post_curation
          (post_uri, status, signal_score, predicates_applied, flagged_at, curated_at, curated_by, review_note)
        VALUES
          (${`at://${sampleDid}/app.bsky.feed.post/status-1`}, ${"curated"}, 91, ${JSON.stringify(["has-media"])}, ${now - 700}, ${now - 690}, ${"tester"}, NULL),
          (${`x://tweet/status-2`}, ${"rejected"}, 55, ${JSON.stringify(["off-topic"])}, ${now - 600}, NULL, NULL, ${"off topic"}),
          (${`at://did:plc:independent-1/app.bsky.feed.post/status-3`}, ${"flagged"}, 48, ${JSON.stringify(["manual-review"])}, ${now - 500}, NULL, NULL, NULL),
          (${`at://did:plc:inactive-1/app.bsky.feed.post/status-5`}, ${"flagged"}, 22, ${JSON.stringify(["stale"])}, ${now - 300}, NULL, NULL, NULL)
      `;

      yield* sql`
        INSERT INTO post_payloads (
          post_uri,
          capture_stage,
          embed_type,
          embed_payload_json,
          captured_at,
          updated_at
        ) VALUES
          (${`at://${sampleDid}/app.bsky.feed.post/status-1`}, ${"picked"}, ${"img"}, ${JSON.stringify({ kind: "img", images: [] })}, ${now - 450}, ${now - 450}),
          (${`x://tweet/status-2`}, ${"picked"}, ${"link"}, ${JSON.stringify({ kind: "link", uri: "https://example.com/twitter-link", title: "Grid Watch", description: null, thumb: null })}, ${now - 350}, ${now - 350}),
          (${`at://did:plc:independent-1/app.bsky.feed.post/status-3`}, ${"picked"}, ${"quote"}, ${JSON.stringify({ kind: "quote", uri: `at://${sampleDid}/app.bsky.feed.post/source`, author: "solar.bsky.social", text: "Quoted claim" })}, ${now - 250}, ${now - 250})
      `;

      yield* sql`
        INSERT INTO post_enrichments (
          post_uri,
          enrichment_type,
          enrichment_payload_json,
          updated_at,
          enriched_at
        ) VALUES
          (${`at://${sampleDid}/app.bsky.feed.post/status-1`}, ${"vision"}, ${"{}"}, ${now - 400}, ${now - 400}),
          (${`x://tweet/status-2`}, ${"source-attribution"}, ${"{}"}, ${now - 300}, ${now - 300}),
          (${`at://did:plc:independent-1/app.bsky.feed.post/status-3`}, ${"grounding"}, ${"{}"}, ${now - 200}, ${now - 200})
      `;

      yield* sql`
        INSERT INTO post_enrichment_runs (
          id,
          workflow_instance_id,
          post_uri,
          enrichment_type,
          schema_version,
          triggered_by,
          requested_by,
          status,
          phase,
          attempt_count,
          model_lane,
          prompt_version,
          input_fingerprint,
          started_at,
          finished_at,
          last_progress_at,
          result_written_at,
          error
        ) VALUES
          (${`run-queued-${now}`}, ${`wf-queued-${now}`}, ${`at://${sampleDid}/app.bsky.feed.post/status-1`}, ${"vision"}, ${"v2"}, ${"admin"}, ${"ops@test.com"}, ${"queued"}, ${"queued"}, 0, NULL, NULL, NULL, ${now - 250}, NULL, ${now - 250}, NULL, NULL),
          (${`run-running-${now}`}, ${`wf-running-${now}`}, ${`x://tweet/status-2`}, ${"source-attribution"}, ${"v2"}, ${"admin"}, ${"ops@test.com"}, ${"running"}, ${"executing"}, 0, NULL, NULL, NULL, ${now - 240}, NULL, ${now - 200}, NULL, NULL),
          (${`run-complete-${now}`}, ${`wf-complete-${now}`}, ${`at://did:plc:independent-1/app.bsky.feed.post/status-3`}, ${"vision"}, ${"v2"}, ${"admin"}, ${"ops@test.com"}, ${"complete"}, ${"complete"}, 1, NULL, NULL, NULL, ${now - 230}, ${now - 220}, ${now - 220}, ${now - 220}, NULL),
          (${`run-failed-${now}`}, ${`wf-failed-${now}`}, ${`at://${sampleDid}/app.bsky.feed.post/status-1`}, ${"source-attribution"}, ${"v2"}, ${"admin"}, ${"ops@test.com"}, ${"failed"}, ${"failed"}, 1, NULL, NULL, NULL, ${now - 210}, ${now - 205}, ${now - 205}, NULL, NULL),
          (${`run-review-${now}`}, ${`wf-review-${now}`}, ${`x://tweet/status-2`}, ${"vision"}, ${"v2"}, ${"admin"}, ${"ops@test.com"}, ${"needs-review"}, ${"needs-review"}, 1, NULL, NULL, NULL, ${now - 204}, ${now - 203}, ${now - 203}, NULL, NULL)
      `;

      yield* sql`
        INSERT INTO ingest_runs (
          id,
          workflow_instance_id,
          kind,
          triggered_by,
          requested_by,
          status,
          phase,
          started_at,
          finished_at,
          last_progress_at,
          total_experts,
          experts_succeeded,
          experts_failed,
          pages_fetched,
          posts_seen,
          posts_stored,
          posts_deleted,
          error
        ) VALUES
          (${`head-old-${now}`}, ${`head-old-${now}`}, ${"head-sweep"}, ${"admin"}, ${"ops@test.com"}, ${"complete"}, ${"complete"}, ${now - 2000}, ${now - 1900}, ${now - 1900}, 2, 2, 0, 10, 10, 4, 0, NULL),
          (${`head-running-${now}`}, ${`head-running-${now}`}, ${"head-sweep"}, ${"admin"}, ${"ops@test.com"}, ${"running"}, ${"running"}, ${now - 1600}, NULL, ${now - 1500}, 3, 0, 0, 3, 3, 0, 0, NULL),
          (${`head-latest-${now}`}, ${`head-latest-${now}`}, ${"head-sweep"}, ${"admin"}, ${"ops@test.com"}, ${"failed"}, ${"failed"}, ${now - 1500}, ${now - 1400}, ${now - 1400}, 3, 2, 1, 12, 12, 5, 0, NULL)
      `;
    });

  it.live("returns an operator snapshot with active counts and latest sweep details", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({ filename });
        await Effect.runPromise(runMigrations.pipe(Effect.provide(layer)));

        const now = Date.now();
        await Effect.runPromise(seedPipelineStatusFixture(now).pipe(Effect.provide(layer)));

        const { client, close } = await createMcpClient(layer, opsReadIdentity);

        try {
          const requestedAt = Date.now();
          const summaryResult = await client.callTool({
            name: "get_pipeline_status",
            arguments: {}
          });
          const summary = decodePipelineStatusResponse(summaryResult);

          expect(summary.asOf).toBeGreaterThanOrEqual(requestedAt);
          expect(summary.experts).toEqual({
            total: 3,
            bluesky: 2,
            twitter: 1,
            byTier: {
              energyFocused: 1,
              generalOutlet: 1,
              independent: 1
            }
          });
          expect(summary.posts).toEqual({
            total: 4,
            bluesky: 3,
            twitter: 1
          });
          expect(summary.curation).toEqual({
            curated: 1,
            rejected: 1,
            flagged: 1,
            uncurated: 1
          });
          expect(summary.enrichments.stored).toEqual({
            total: 3,
            vision: 1,
            sourceAttribution: 1,
            grounding: 1
          });
          expect(summary.enrichments.runs).toEqual({
            queued: 1,
            running: 1,
            complete: 1,
            failed: 1,
            needsReview: 1
          });
          expect(summary.lastSweep).toEqual({
            runId: `head-latest-${now}`,
            completedAt: now - 1400,
            postsStored: 5,
            expertsFailed: 1,
            status: "failed"
          });
          expect(summary._display).toContain("As of:");
          expect(summary._display).toContain("Experts: 3 active");
          expect(summary._display).toContain("uncurated 1");
          expect(summary._display).toContain("grounding 1");
          expect(summary._display).toContain(`Last sweep: head-latest-${now}`);
          expect(summary._display).toContain("experts failed 1");

          const fullResult = await client.callTool({
            name: "get_pipeline_status",
            arguments: {
              detail: "full",
              since: now - 1500
            }
          });
          const full = decodePipelineStatusResponse(fullResult);
          expect(full.lastSweep?.runId).toBe(`head-latest-${now}`);
          expect(full._display).toContain("Completed:");
          expect(full._display).toContain("Status: failed");
          expect(full._display).toContain("Experts failed: 1");

          const staleSweepResult = await client.callTool({
            name: "get_pipeline_status",
            arguments: {
              since: now - 1000
            }
          });
          const staleSweep = decodePipelineStatusResponse(staleSweepResult);
          expect(staleSweep.lastSweep).toBeNull();
        } finally {
          await close();
        }
      })
    )
  );

  it.live("returns zeros and no sweep for an empty database", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({ filename });
        await Effect.runPromise(runMigrations.pipe(Effect.provide(layer)));

        const { client, close } = await createMcpClient(layer, opsReadIdentity);

        try {
          const result = await client.callTool({
            name: "get_pipeline_status",
            arguments: { detail: "full" }
          });
          const snapshot = decodePipelineStatusResponse(result);

          expect(snapshot.experts.total).toBe(0);
          expect(snapshot.posts.total).toBe(0);
          expect(snapshot.curation).toEqual({
            curated: 0,
            rejected: 0,
            flagged: 0,
            uncurated: 0
          });
          expect(snapshot.enrichments.stored).toEqual({
            total: 0,
            vision: 0,
            sourceAttribution: 0,
            grounding: 0
          });
          expect(snapshot.enrichments.runs).toEqual({
            queued: 0,
            running: 0,
            complete: 0,
            failed: 0,
            needsReview: 0
          });
          expect(snapshot.lastSweep).toBeNull();
          expect(snapshot._display).toContain("Last sweep: none recorded.");
        } finally {
          await close();
        }
      })
    )
  );

  it.live("omits lastSweep when only unfinished or non-head runs exist", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({ filename });
        await Effect.runPromise(runMigrations.pipe(Effect.provide(layer)));

        await Effect.runPromise(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            const now = Date.now();

            yield* sql`
              INSERT INTO experts (
                did,
                handle,
                display_name,
                description,
                avatar,
                domain,
                source,
                source_ref,
                shard,
                active,
                tier,
                added_at,
                last_synced_at
              ) VALUES
                (${sampleDid}, ${"solar.bsky.social"}, ${"Solar"}, NULL, NULL, ${"energy"}, ${"manual"}, NULL, 0, 1, ${"energy-focused"}, ${now - 1000}, NULL)
            `;

            yield* sql`
              INSERT INTO posts (
                uri,
                did,
                cid,
                text,
                created_at,
                indexed_at,
                has_links,
                status,
                ingest_id,
                embed_type
              ) VALUES
                (${`at://${sampleDid}/app.bsky.feed.post/status-only`}, ${sampleDid}, ${"cid-status-only"}, ${"Active post"}, ${now - 900}, ${now - 900}, 0, ${"active"}, ${"ingest-status-only"}, NULL)
            `;

            yield* sql`
              INSERT INTO ingest_runs (
                id,
                workflow_instance_id,
                kind,
                triggered_by,
                requested_by,
                status,
                phase,
                started_at,
                finished_at,
                last_progress_at,
                total_experts,
                experts_succeeded,
                experts_failed,
                pages_fetched,
                posts_seen,
                posts_stored,
                posts_deleted,
                error
              ) VALUES
                (${`head-running-${now}`}, ${`head-running-${now}`}, ${"head-sweep"}, ${"admin"}, ${"ops@test.com"}, ${"running"}, ${"running"}, ${now - 500}, NULL, ${now - 400}, 1, 0, 0, 0, 0, 0, 0, NULL),
                (${`backfill-complete-${now}`}, ${`backfill-complete-${now}`}, ${"expert-refresh"}, ${"admin"}, ${"ops@test.com"}, ${"complete"}, ${"complete"}, ${now - 700}, ${now - 600}, ${now - 600}, 1, 1, 0, 0, 0, 0, 0, NULL)
            `;
          }).pipe(Effect.provide(layer))
        );

        const { client, close } = await createMcpClient(layer, opsReadIdentity);

        try {
          const result = await client.callTool({
            name: "get_pipeline_status",
            arguments: { detail: "full" }
          });
          const snapshot = decodePipelineStatusResponse(result);

          expect(snapshot.experts.total).toBe(1);
          expect(snapshot.posts.total).toBe(1);
          expect(snapshot.lastSweep).toBeNull();
          expect(snapshot._display).toContain("Last sweep: none recorded.");
        } finally {
          await close();
        }
      })
    )
  );
});

describe("MCP import_posts", () => {
  it.live("imports posts through the shared import pipeline", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({ filename });
        await Effect.runPromise(runMigrations.pipe(Effect.provide(layer)));

        const { client, close } = await createMcpClient(layer, opsRefreshIdentity);

        try {
          const result = await client.callTool({
            name: "import_posts",
            arguments: {
              experts: [{
                did: "did:x:import-operator-1",
                handle: "importer",
                domain: "energy",
                source: "twitter-import",
                tier: "energy-focused"
              }],
              posts: [
                {
                  uri: "x://importer/status/1001",
                  did: "did:x:import-operator-1",
                  text: "Solar installations are accelerating across the power grid.",
                  createdAt: 1_700_000_000_000,
                  links: []
                },
                {
                  uri: "x://importer/status/1002",
                  did: "did:x:import-operator-1",
                  text: "Lunch was great today.",
                  createdAt: 1_700_000_000_001,
                  links: []
                }
              ]
            }
          });
          const summary = decodeImportPostsResponse(result);

          expect(summary.imported).toBe(1);
          expect(summary.skipped).toBe(1);
          expect(summary._display).toContain("Imported: 1");

          const storedPosts = await Effect.runPromise(
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient;
              const rows = yield* sql<{ total: number }>`
                SELECT COUNT(*) as total
                FROM posts
                WHERE uri = ${"x://importer/status/1001"}
              `;
              return Number(rows[0]?.total ?? 0);
            }).pipe(Effect.provide(layer))
          );

          expect(storedPosts).toBe(1);
        } finally {
          await close();
        }
      })
    )
  );
});

describe("MCP expert registry tools", () => {
  it.live("adds a Bluesky-backed expert through the registry service", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({
          filename,
          blueskyClient: makeExpertRegistryBlueskyLayer()
        });
        await Effect.runPromise(runMigrations.pipe(Effect.provide(layer)));

        const { client, close } = await createMcpClient(layer, expertsWriteIdentity);

        try {
          const result = await client.callTool({
            name: "add_expert",
            arguments: {
              didOrHandle: expertRegistryHandle,
              domain: "energy",
              active: true
            }
          });
          expect(result.isError).toBe(false);

          const expert = decodeAddExpertResponse(result);
          expect(expert.did).toBe(expertRegistryDid);
          expect(expert.handle).toBe(expertRegistryHandle);
          expect(expert.displayName).toBe(expertRegistryDisplayName);
          expect(expert.avatar).toBe(expertRegistryAvatar);
          expect(expert.domain).toBe("energy");
          expect(expert.source).toBe("manual");
          expect(expert.active).toBe(true);
          expect(expert._display).toContain("Expert registered:");

          const storedExpert = await Effect.runPromise(
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient;
              const rows = yield* sql<{
                did: string;
                handle: string | null;
                display_name: string | null;
                avatar: string | null;
                source: string;
                active: number;
              }>`
                SELECT did, handle, display_name, avatar, source, active
                FROM experts
                WHERE did = ${expertRegistryDid}
              `;
              return rows[0] ?? null;
            }).pipe(Effect.provide(layer))
          );

          expect(storedExpert).toEqual({
            did: expertRegistryDid,
            handle: expertRegistryHandle,
            display_name: expertRegistryDisplayName,
            avatar: expertRegistryAvatar,
            source: "manual",
            active: 1
          });
        } finally {
          await close();
        }
      })
    )
  );

  it.live("toggles an expert active state through MCP", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({
          filename,
          blueskyClient: makeExpertRegistryBlueskyLayer()
        });
        await Effect.runPromise(runMigrations.pipe(Effect.provide(layer)));

        const { client, close } = await createMcpClient(layer, expertsWriteIdentity);

        try {
          const addResult = await client.callTool({
            name: "add_expert",
            arguments: {
              didOrHandle: expertRegistryHandle,
              domain: "energy",
              active: true
            }
          });
          const added = decodeAddExpertResponse(addResult);

          const setInactiveResult = await client.callTool({
            name: "set_expert_active",
            arguments: {
              did: added.did,
              active: false
            }
          });
          expect(setInactiveResult.isError).toBe(false);

          const updated = decodeSetExpertActiveResponse(setInactiveResult);
          expect(updated.did).toBe(expertRegistryDid);
          expect(updated.active).toBe(false);
          expect(updated._display).toContain("is now inactive");

          const activeFlag = await Effect.runPromise(
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient;
              const rows = yield* sql<{ active: number }>`
                SELECT active
                FROM experts
                WHERE did = ${expertRegistryDid}
              `;
              return Number(rows[0]?.active ?? -1);
            }).pipe(Effect.provide(layer))
          );

          expect(activeFlag).toBe(0);
        } finally {
          await close();
        }
      })
    )
  );

  it.live("add_expert is idempotent — second call upserts without error", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({
          filename,
          blueskyClient: makeExpertRegistryBlueskyLayer()
        });
        await Effect.runPromise(runMigrations.pipe(Effect.provide(layer)));

        const { client, close } = await createMcpClient(layer, expertsWriteIdentity);

        try {
          const first = await client.callTool({
            name: "add_expert",
            arguments: {
              didOrHandle: expertRegistryHandle,
              domain: "energy",
              active: true
            }
          });
          expect(first.isError).toBe(false);

          const second = await client.callTool({
            name: "add_expert",
            arguments: {
              didOrHandle: expertRegistryHandle,
              domain: "energy",
              active: true
            }
          });
          expect(second.isError).toBe(false);

          const expert = decodeAddExpertResponse(second);
          expect(expert.did).toBe(expertRegistryDid);
          expect(expert.handle).toBe(expertRegistryHandle);

          const storedCount = await Effect.runPromise(
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient;
              const rows = yield* sql<{ cnt: number }>`
                SELECT COUNT(*) as cnt FROM experts WHERE did = ${expertRegistryDid}
              `;
              return Number(rows[0]?.cnt ?? 0);
            }).pipe(Effect.provide(layer))
          );

          expect(storedCount).toBe(1);
        } finally {
          await close();
        }
      })
    )
  );

  it.live("set_expert_active on non-existent DID returns isError", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({
          filename,
          blueskyClient: makeExpertRegistryBlueskyLayer()
        });
        await Effect.runPromise(runMigrations.pipe(Effect.provide(layer)));

        const { client, close } = await createMcpClient(layer, expertsWriteIdentity);

        try {
          const result = await client.callTool({
            name: "set_expert_active",
            arguments: {
              did: "did:plc:nonexistent999",
              active: false
            }
          });
          expect(result.isError).toBe(true);
          expect(getTextContent(result)).toContain("McpToolQueryError");
        } finally {
          await close();
        }
      })
    )
  );

  it.live("add_expert rejects non-Bluesky DID with guidance to use import_posts", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({
          filename,
          blueskyClient: makeExpertRegistryBlueskyLayer()
        });
        await Effect.runPromise(runMigrations.pipe(Effect.provide(layer)));

        const { client, close } = await createMcpClient(layer, expertsWriteIdentity);

        try {
          const result = await client.callTool({
            name: "add_expert",
            arguments: {
              didOrHandle: "did:x:12345",
              domain: "energy",
              active: true
            }
          });
          expect(result.isError).toBe(true);
          expect(getTextContent(result)).toContain("import_posts");
        } finally {
          await close();
        }
      })
    )
  );
});

describe("MCP list_curation_candidates", () => {
  const fixtureUris = smokeFixtureUris(sampleDid);
  const solarUri = fixtureUris[0]!;
  const windUri = fixtureUris[1]!;
  const twitterUri = "x://tweet/mcp-1";

  it.live("supports count mode and export pagination", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({
          filename,
          config: { curationMinSignalScore: 100 }
        });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        await Effect.runPromise(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            const now = Date.now();

            yield* sql`
              INSERT INTO posts (
                uri,
                did,
                cid,
                text,
                created_at,
                indexed_at,
                has_links,
                status,
                ingest_id,
                embed_type
              ) VALUES (
                ${twitterUri},
                ${sampleDid},
                ${"cid-twitter-mcp-1"},
                ${"Imported Twitter export candidate"},
                ${now - 1000},
                ${now - 1000},
                ${0},
                ${"active"},
                ${"ingest-twitter-mcp-1"},
                ${null}
              )
            `;

            yield* sql`
              INSERT INTO post_curation
                (post_uri, status, signal_score, predicates_applied, flagged_at, curated_at, curated_by, review_note)
              VALUES
                (${solarUri}, 'flagged', ${95}, ${JSON.stringify(["has-links"])}, ${now + 3}, NULL, NULL, NULL),
                (${windUri}, 'flagged', ${85}, ${JSON.stringify(["multi-topic"])}, ${now + 2}, NULL, NULL, NULL),
                (${twitterUri}, 'flagged', ${75}, ${JSON.stringify(["manual-import"])}, ${now + 1}, NULL, NULL, NULL)
              ON CONFLICT(post_uri) DO UPDATE SET
                status = excluded.status,
                signal_score = excluded.signal_score,
                predicates_applied = excluded.predicates_applied,
                flagged_at = excluded.flagged_at
            `;
          }).pipe(Effect.provide(layer))
        );

        const { client, close } = await createMcpClient(makeBiLayer({ filename }));

        try {
          const countsResult = await client.callTool({
            name: "list_curation_candidates",
            arguments: { count: true }
          });
          const counts = decodeCurationCandidatesResponse(countsResult);
          expect(counts.mode).toBe("count");
          expect(counts.total).toBe(3);
          expect(counts.byPlatform).toEqual({ bluesky: 2, twitter: 1 });
          expect(counts.items).toEqual([]);
          expect(counts.exportItems).toEqual([]);

          const exportResult = await client.callTool({
            name: "list_curation_candidates",
            arguments: { export: true, limit: 2 }
          });
          const exportPage = decodeCurationCandidatesResponse(exportResult);
          expect(exportPage.mode).toBe("export");
          expect(exportPage.total).toBe(3);
          expect(exportPage.exportItems).toHaveLength(2);
          expect(exportPage.items).toEqual([]);
          expect(exportPage.nextCursor).not.toBeNull();
          expect(exportPage._display).toContain("Showing 2 of 3 curation candidates.");

          const secondPageResult = await client.callTool({
            name: "list_curation_candidates",
            arguments: {
              export: true,
              limit: 2,
              cursor: exportPage.nextCursor
            }
          });
          const secondPage = decodeCurationCandidatesResponse(secondPageResult);
          expect(secondPage.exportItems).toHaveLength(1);
          expect(secondPage.exportItems[0]?.uri).toBe(twitterUri);
          expect(secondPage.nextCursor).toBeNull();
        } finally {
          await close();
        }
      })
    )
  );

  it.live("rejects invalid cursors and conflicting list modes", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        const { client, close } = await createMcpClient(layer);

        try {
          const invalidCursor = await client.callTool({
            name: "list_curation_candidates",
            arguments: { cursor: "not-json" }
          });
          expect(invalidCursor.isError).toBe(true);
          expect(getTextContent(invalidCursor)).toContain("Invalid curation cursor");

          const conflictingModes = await client.callTool({
            name: "list_curation_candidates",
            arguments: { export: true, count: true }
          });
          expect(conflictingModes.isError).toBe(true);
          expect(getTextContent(conflictingModes)).toContain(
            "Choose either export mode or count mode"
          );
        } finally {
          await close();
        }
      })
    )
  );
});

describe("MCP bulk_curate", () => {
  const solarUri = `at://${sampleDid}/app.bsky.feed.post/post-solar`;
  const windUri = `at://${sampleDid}/app.bsky.feed.post/post-wind`;

  it.live("returns batch counts and per-post errors", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({
          filename,
          config: { curationMinSignalScore: 100 }
        });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        const now = Date.now();
        await Effect.runPromise(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            const embedPayloadJson = JSON.stringify({
              kind: "link",
              uri: "https://example.com/article",
              title: "Stored payload",
              description: null,
              thumb: null
            });

            yield* sql`
              INSERT INTO post_curation
                (post_uri, status, signal_score, predicates_applied, flagged_at, curated_at, curated_by, review_note)
              VALUES
                (${solarUri}, 'flagged', ${60}, ${JSON.stringify(["has-links"])}, ${now + 1}, NULL, NULL, NULL),
                (${windUri}, 'flagged', ${55}, ${JSON.stringify(["multi-topic"])}, ${now}, NULL, NULL, NULL)
              ON CONFLICT(post_uri) DO UPDATE SET
                status = excluded.status,
                signal_score = excluded.signal_score,
                predicates_applied = excluded.predicates_applied,
                flagged_at = excluded.flagged_at
            `;
            yield* sql`
              INSERT INTO post_payloads (post_uri, capture_stage, embed_type, embed_payload_json, captured_at, updated_at)
              VALUES (${solarUri}, 'candidate', 'link', ${embedPayloadJson}, ${now}, ${now})
              ON CONFLICT(post_uri) DO UPDATE SET
                capture_stage = excluded.capture_stage,
                embed_type = excluded.embed_type,
                embed_payload_json = excluded.embed_payload_json,
                updated_at = excluded.updated_at
            `;
          }).pipe(Effect.provide(layer))
        );

        const { client, close } = await createMcpClient(
          makeBiLayer({ filename }),
          workflowIdentity
        );

        try {
          const result = await client.callTool({
            name: "bulk_curate",
            arguments: {
              decisions: [
                { postUri: solarUri, action: "curate" },
                { postUri: windUri, action: "reject", note: "off topic" },
                { postUri: "at://did:plc:missing/app.bsky.feed.post/nope", action: "reject" }
              ]
            }
          });
          expect(result.isError).toBe(false);

          const summary = decodeBulkCurateResponse(result);
          expect(summary.curated).toBe(1);
          expect(summary.rejected).toBe(1);
          expect(summary.skipped).toBe(0);
          expect(summary.errors).toHaveLength(1);
          expect(summary.errors[0]?.postUri).toBe("at://did:plc:missing/app.bsky.feed.post/nope");
          expect(summary._display).toContain("Bulk curation completed.");
        } finally {
          await close();
        }
      })
    )
  );

  it.live("rejects empty, duplicate, and oversized batches before execution", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        const { client, close } = await createMcpClient(layer, workflowIdentity);

        try {
          const empty = await client.callTool({
            name: "bulk_curate",
            arguments: { decisions: [] }
          });
          expect(empty.isError).toBe(true);
          expect(getTextContent(empty)).toContain("Provide at least one curation decision.");

          const duplicate = await client.callTool({
            name: "bulk_curate",
            arguments: {
              decisions: [
                { postUri: solarUri, action: "curate" },
                { postUri: solarUri, action: "reject" }
              ]
            }
          });
          expect(duplicate.isError).toBe(true);
          expect(getTextContent(duplicate)).toContain("Duplicate postUri in batch");

          const tooMany = await client.callTool({
            name: "bulk_curate",
            arguments: {
              decisions: Array.from(
                { length: BULK_CURATE_MAX_DECISIONS + 1 },
                (_, index) => ({
                  postUri: `at://did:plc:bulk-curate/app.bsky.feed.post/post-${index}`,
                  action: "reject" as const
                })
              )
            }
          });
          expect(tooMany.isError).toBe(true);
          expect(getTextContent(tooMany)).toContain(
            `Maximum: ${BULK_CURATE_MAX_DECISIONS}.`
          );
        } finally {
          await close();
        }
      })
    )
  );

  it.live("counts idempotent curate decisions as skipped", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({
          filename,
          config: { curationMinSignalScore: 100 }
        });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        const now = Date.now();
        await Effect.runPromise(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;

            yield* sql`
              INSERT INTO post_curation
                (post_uri, status, signal_score, predicates_applied, flagged_at, curated_at, curated_by, review_note)
              VALUES
                (${solarUri}, 'curated', ${60}, ${JSON.stringify(["already-curated"])}, ${now + 1}, ${now + 1}, 'tester', NULL),
                (${windUri}, 'flagged', ${55}, ${JSON.stringify(["multi-topic"])}, ${now}, NULL, NULL, NULL)
              ON CONFLICT(post_uri) DO UPDATE SET
                status = excluded.status,
                signal_score = excluded.signal_score,
                predicates_applied = excluded.predicates_applied,
                flagged_at = excluded.flagged_at,
                curated_at = excluded.curated_at,
                curated_by = excluded.curated_by
            `;
          }).pipe(Effect.provide(layer))
        );

        const { client, close } = await createMcpClient(layer, workflowIdentity);

        try {
          const result = await client.callTool({
            name: "bulk_curate",
            arguments: {
              decisions: [
                { postUri: solarUri, action: "curate" },
                { postUri: windUri, action: "reject", note: "off topic" }
              ]
            }
          });

          expect(result.isError).toBe(false);
          const summary = decodeBulkCurateResponse(result);
          expect(summary.curated).toBe(0);
          expect(summary.rejected).toBe(1);
          expect(summary.skipped).toBe(1);
          expect(summary.errors).toEqual([]);
        } finally {
          await close();
        }
      })
    )
  );
});

describe("MCP start_enrichment", () => {
  it.live("returns error when trigger client not available", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const seedLayer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(seedLayer)));

        const { client, close } = await createMcpClient(
          makeBiLayer({ filename }),
          workflowIdentity
        );

        try {
          const result = await client.callTool({
            name: "start_enrichment",
            arguments: { postUri: `at://${sampleDid}/app.bsky.feed.post/post-solar` }
          });
          expect(result.isError).toBe(true);
          const text = result.content.find(
            (c): c is { type: "text"; text: string } => c.type === "text"
          );
          expect(text!.text).toContain("not available");
        } finally {
          await close();
        }
      })
    )
  );
});

describe("MCP list_enrichment_gaps", () => {
  const fixtureUris = smokeFixtureUris(sampleDid);
  const solarUri = fixtureUris[0]!;
  const windUri = fixtureUris[1]!;
  const twitterUri = "x://tweet/enrichment-gap-1";

  it.live("groups queueable gaps by enrichment type and platform", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        const now = Date.now();
        await Effect.runPromise(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;

            yield* sql`
              INSERT INTO posts (
                uri,
                did,
                cid,
                text,
                created_at,
                indexed_at,
                has_links,
                status,
                ingest_id,
                embed_type
              ) VALUES (
                ${twitterUri},
                ${sampleDid},
                ${"cid-twitter-enrichment-gap-1"},
                ${"Imported Twitter link candidate"},
                ${now - 500},
                ${now - 500},
                ${1},
                ${"active"},
                ${"ingest-twitter-enrichment-gap-1"},
                ${"link"}
              )
            `;

            yield* sql`
              INSERT INTO post_curation
                (post_uri, status, signal_score, predicates_applied, flagged_at, curated_at, curated_by, review_note)
              VALUES
                (${solarUri}, 'curated', ${90}, ${JSON.stringify(["has-media"])}, ${now - 30}, ${now - 30}, 'tester', NULL),
                (${windUri}, 'curated', ${80}, ${JSON.stringify(["has-links"])}, ${now - 20}, ${now - 20}, 'tester', NULL),
                (${twitterUri}, 'curated', ${70}, ${JSON.stringify(["imported"])}, ${now - 10}, ${now - 10}, 'tester', NULL)
              ON CONFLICT(post_uri) DO UPDATE SET
                status = excluded.status,
                signal_score = excluded.signal_score,
                predicates_applied = excluded.predicates_applied,
                flagged_at = excluded.flagged_at,
                curated_at = excluded.curated_at,
                curated_by = excluded.curated_by
            `;

            yield* sql`
              INSERT INTO post_payloads (post_uri, capture_stage, embed_type, embed_payload_json, captured_at, updated_at)
              VALUES
                (${solarUri}, 'picked', 'img', ${JSON.stringify({ kind: "img", images: [{ alt: "Chart", fullsize: "https://example.com/chart.jpg", thumb: "https://example.com/chart-thumb.jpg" }] })}, ${now}, ${now}),
                (${windUri}, 'picked', 'link', ${JSON.stringify({ kind: "link", uri: "https://example.com/wind", title: "Wind article", description: null, thumb: null })}, ${now}, ${now}),
                (${twitterUri}, 'picked', 'link', ${JSON.stringify({ kind: "link", uri: "https://example.com/twitter-link", title: "Twitter article", description: null, thumb: null })}, ${now}, ${now})
              ON CONFLICT(post_uri) DO UPDATE SET
                capture_stage = excluded.capture_stage,
                embed_type = excluded.embed_type,
                embed_payload_json = excluded.embed_payload_json,
                updated_at = excluded.updated_at
            `;
          }).pipe(Effect.provide(layer))
        );

        const { client, close } = await createMcpClient(makeBiLayer({ filename }));

        try {
          const allResult = await client.callTool({
            name: "list_enrichment_gaps",
            arguments: {}
          });
          const allGaps = decodeEnrichmentGapsResponse(allResult);
          expect(allGaps.vision.count).toBe(1);
          expect(allGaps.vision.postUris).toEqual([solarUri]);
          expect(allGaps.sourceAttribution.count).toBe(2);
          expect([...allGaps.sourceAttribution.postUris].sort()).toEqual([twitterUri, windUri].sort());
          expect(allGaps._display).toContain("Vision gaps: 1");
          expect(allGaps._display).toContain("Source-attribution gaps: 2");

          const twitterResult = await client.callTool({
            name: "list_enrichment_gaps",
            arguments: { platform: "twitter" }
          });
          const twitterGaps = decodeEnrichmentGapsResponse(twitterResult);
          expect(twitterGaps.vision.count).toBe(0);
          expect(twitterGaps.sourceAttribution.count).toBe(1);
          expect(twitterGaps.sourceAttribution.postUris).toEqual([twitterUri]);
        } finally {
          await close();
        }
      })
    )
  );

  it.live("supports enrichment-type filtering and excludes posts with active runs", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        const visualUri = "x://tweet/enrichment-gap-visual-1";
        const now = Date.now();
        await Effect.runPromise(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;

            yield* sql`
              INSERT INTO posts (
                uri,
                did,
                cid,
                text,
                created_at,
                indexed_at,
                has_links,
                status,
                ingest_id,
                embed_type
              ) VALUES
                (${twitterUri}, ${sampleDid}, ${"cid-twitter-enrichment-gap-2"}, ${"Imported Twitter link candidate"}, ${now - 500}, ${now - 500}, ${1}, ${"active"}, ${"ingest-twitter-enrichment-gap-2"}, ${"link"}),
                (${visualUri}, ${sampleDid}, ${"cid-twitter-enrichment-gap-visual-1"}, ${"Imported Twitter chart candidate"}, ${now - 400}, ${now - 400}, ${0}, ${"active"}, ${"ingest-twitter-enrichment-gap-visual-1"}, ${"img"})
            `;

            yield* sql`
              INSERT INTO post_curation
                (post_uri, status, signal_score, predicates_applied, flagged_at, curated_at, curated_by, review_note)
              VALUES
                (${solarUri}, 'curated', ${90}, ${JSON.stringify(["has-media"])}, ${now - 30}, ${now - 30}, 'tester', NULL),
                (${windUri}, 'curated', ${80}, ${JSON.stringify(["has-links"])}, ${now - 20}, ${now - 20}, 'tester', NULL),
                (${twitterUri}, 'curated', ${70}, ${JSON.stringify(["imported"])}, ${now - 10}, ${now - 10}, 'tester', NULL),
                (${visualUri}, 'curated', ${75}, ${JSON.stringify(["imported-media"])}, ${now - 5}, ${now - 5}, 'tester', NULL)
              ON CONFLICT(post_uri) DO UPDATE SET
                status = excluded.status,
                signal_score = excluded.signal_score,
                predicates_applied = excluded.predicates_applied,
                flagged_at = excluded.flagged_at,
                curated_at = excluded.curated_at,
                curated_by = excluded.curated_by
            `;

            yield* sql`
              INSERT INTO post_payloads (post_uri, capture_stage, embed_type, embed_payload_json, captured_at, updated_at)
              VALUES
                (${solarUri}, 'picked', 'img', ${JSON.stringify({ kind: "img", images: [{ alt: "Chart", fullsize: "https://example.com/chart.jpg", thumb: "https://example.com/chart-thumb.jpg" }] })}, ${now}, ${now}),
                (${windUri}, 'picked', 'link', ${JSON.stringify({ kind: "link", uri: "https://example.com/wind", title: "Wind article", description: null, thumb: null })}, ${now}, ${now}),
                (${twitterUri}, 'picked', 'link', ${JSON.stringify({ kind: "link", uri: "https://example.com/twitter-link", title: "Twitter article", description: null, thumb: null })}, ${now}, ${now}),
                (${visualUri}, 'picked', 'img', ${JSON.stringify({ kind: "img", images: [{ alt: "Imported chart", fullsize: "https://example.com/imported-chart.jpg", thumb: "https://example.com/imported-chart-thumb.jpg" }] })}, ${now}, ${now})
              ON CONFLICT(post_uri) DO UPDATE SET
                capture_stage = excluded.capture_stage,
                embed_type = excluded.embed_type,
                embed_payload_json = excluded.embed_payload_json,
                updated_at = excluded.updated_at
            `;

            yield* sql`
              INSERT INTO post_enrichment_runs (
                id,
                workflow_instance_id,
                post_uri,
                enrichment_type,
                schema_version,
                triggered_by,
                requested_by,
                status,
                phase,
                attempt_count,
                model_lane,
                prompt_version,
                input_fingerprint,
                started_at,
                finished_at,
                last_progress_at,
                result_written_at,
                error
              ) VALUES (
                ${`run-active-${now}`},
                ${`workflow-active-${now}`},
                ${solarUri},
                'vision',
                'v2',
                'admin',
                'tester',
                'queued',
                'queued',
                0,
                NULL,
                NULL,
                NULL,
                ${now - 100},
                NULL,
                ${now - 100},
                NULL,
                NULL
              )
            `;
          }).pipe(Effect.provide(layer))
        );

        const { client, close } = await createMcpClient(layer);

        try {
          const allResult = await client.callTool({
            name: "list_enrichment_gaps",
            arguments: {}
          });
          const allGaps = decodeEnrichmentGapsResponse(allResult);
          expect(allGaps.vision.count).toBe(1);
          expect(allGaps.vision.postUris).toEqual([visualUri]);
          expect([...allGaps.sourceAttribution.postUris].sort()).toEqual(
            [twitterUri, windUri].sort()
          );
          expect(allGaps.vision.postUris).not.toContain(solarUri);

          const visionOnlyResult = await client.callTool({
            name: "list_enrichment_gaps",
            arguments: { enrichmentType: "vision" }
          });
          const visionOnly = decodeEnrichmentGapsResponse(visionOnlyResult);
          expect(visionOnly.vision.count).toBe(1);
          expect(visionOnly.vision.postUris).toEqual([visualUri]);
          expect(visionOnly.sourceAttribution.count).toBe(0);
          expect(visionOnly.sourceAttribution.postUris).toEqual([]);

          const recentResult = await client.callTool({
            name: "list_enrichment_gaps",
            arguments: { since: now - 8 }
          });
          const recentGaps = decodeEnrichmentGapsResponse(recentResult);
          expect(recentGaps.vision.count).toBe(1);
          expect(recentGaps.vision.postUris).toEqual([visualUri]);
          expect(recentGaps.sourceAttribution.count).toBe(0);
          expect(recentGaps.sourceAttribution.postUris).toEqual([]);
        } finally {
          await close();
        }
      })
    )
  );

  it.live("returns empty buckets when no curated posts are ready for enrichment", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        const { client, close } = await createMcpClient(layer);

        try {
          const result = await client.callTool({
            name: "list_enrichment_gaps",
            arguments: {}
          });
          const gaps = decodeEnrichmentGapsResponse(result);
          expect(gaps.vision).toEqual({ count: 0, postUris: [] });
          expect(gaps.sourceAttribution).toEqual({ count: 0, postUris: [] });
          expect(gaps._display).toContain("No enrichment gaps found.");
        } finally {
          await close();
        }
      })
    )
  );
});

describe("MCP list_enrichment_issues", () => {
  const fixtureUris = smokeFixtureUris(sampleDid);
  const solarUri = fixtureUris[0]!;
  const windUri = fixtureUris[1]!;

  it.live("lists failed and needs-review runs with filtering", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        const now = Date.now();
        await Effect.runPromise(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            const failureError = JSON.stringify({
              tag: "EnrichmentWorkflowLaunchError",
              message: "Vision pipeline failed",
              retryable: false,
              operation: "execute"
            });

            yield* sql`
              INSERT INTO post_payloads (post_uri, capture_stage, embed_type, embed_payload_json, captured_at, updated_at)
              VALUES
                (${solarUri}, 'picked', 'img', ${JSON.stringify({ kind: "img", images: [{ alt: "Chart", fullsize: "https://example.com/chart.jpg", thumb: "https://example.com/chart-thumb.jpg" }] })}, ${now}, ${now}),
                (${windUri}, 'picked', 'link', ${JSON.stringify({ kind: "link", uri: "https://example.com/wind", title: "Wind article", description: null, thumb: null })}, ${now}, ${now})
              ON CONFLICT(post_uri) DO UPDATE SET
                capture_stage = excluded.capture_stage,
                embed_type = excluded.embed_type,
                embed_payload_json = excluded.embed_payload_json,
                updated_at = excluded.updated_at
            `;

            yield* sql`
              INSERT INTO post_enrichment_runs (
                id,
                workflow_instance_id,
                post_uri,
                enrichment_type,
                schema_version,
                triggered_by,
                requested_by,
                status,
                phase,
                attempt_count,
                model_lane,
                prompt_version,
                input_fingerprint,
                started_at,
                finished_at,
                last_progress_at,
                result_written_at,
                error
              ) VALUES
                (${`run-failed-${now}`}, ${`workflow-failed-${now}`}, ${solarUri}, 'vision', 'v2', 'admin', 'tester', 'failed', 'failed', 1, NULL, NULL, NULL, ${now - 1000}, ${now - 900}, ${now - 900}, NULL, ${failureError}),
                (${`run-review-${now}`}, ${`workflow-review-${now}`}, ${windUri}, 'source-attribution', 'v2', 'admin', 'tester', 'needs-review', 'needs-review', 1, NULL, NULL, NULL, ${now - 800}, ${now - 700}, ${now - 700}, NULL, NULL)
            `;
          }).pipe(Effect.provide(layer))
        );

        const { client, close } = await createMcpClient(makeBiLayer({ filename }));

        try {
          const allResult = await client.callTool({
            name: "list_enrichment_issues",
            arguments: {}
          });
          const allIssues = decodeEnrichmentIssuesResponse(allResult);
          expect(allIssues.items).toHaveLength(2);
          expect(allIssues._display).toContain("failed | vision");
          expect(allIssues._display).toContain("needs-review | source-attribution");

          const failedResult = await client.callTool({
            name: "list_enrichment_issues",
            arguments: { status: "failed" }
          });
          const failedIssues = decodeEnrichmentIssuesResponse(failedResult);
          expect(failedIssues.items).toHaveLength(1);
          expect(failedIssues.items[0]?.postUri).toBe(solarUri);
          expect(failedIssues.items[0]?.error?.tag).toBe("EnrichmentWorkflowLaunchError");
          expect(failedIssues.items[0]?.error?.message).toBe("Vision pipeline failed");
        } finally {
          await close();
        }
      })
    )
  );

  it.live("returns an empty result when there are no failed or reviewable runs", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        const { client, close } = await createMcpClient(layer);

        try {
          const result = await client.callTool({
            name: "list_enrichment_issues",
            arguments: {}
          });
          const issues = decodeEnrichmentIssuesResponse(result);
          expect(issues.items).toEqual([]);
          expect(issues._display).toContain("No enrichment issues found.");
        } finally {
          await close();
        }
      })
    )
  );
});

describe("MCP bulk_start_enrichment", () => {
  const fixtureUris = smokeFixtureUris(sampleDid);
  const solarUri = fixtureUris[0]!;
  const windUri = fixtureUris[1]!;
  const linkUri = "x://tweet/bulk-enrichment-1";
  const missingUri = "at://did:plc:missing/app.bsky.feed.post/nope";

  it.live("returns error when the enrichment trigger client is not available", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        const { client, close } = await createMcpClient(layer, workflowIdentity);

        try {
          const result = await client.callTool({
            name: "bulk_start_enrichment",
            arguments: {
              posts: [{ postUri: solarUri }]
            }
          });
          expect(result.isError).toBe(true);
          expect(getTextContent(result)).toContain("not available");
        } finally {
          await close();
        }
      })
    )
  );

  it.live("rejects empty, duplicate, and oversized batches before triggering", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const mockFetcher = {
          fetch: async () =>
            new Response(
              JSON.stringify({ message: "unexpected trigger call" }),
              { status: 500, headers: { "content-type": "application/json" } }
            )
        } as unknown as Fetcher;
        const layer = Layer.mergeAll(
          makeBiLayer({ filename }),
          EnrichmentTriggerClient.layerFromFetcher(mockFetcher, "test-secret")
        );
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        const { client, close } = await createMcpClient(
          layer,
          workflowIdentity
        );

        try {
          const empty = await client.callTool({
            name: "bulk_start_enrichment",
            arguments: { posts: [] }
          });
          expect(empty.isError).toBe(true);
          expect(getTextContent(empty)).toContain(
            "Provide at least one post or a non-empty gaps payload."
          );

          const duplicate = await client.callTool({
            name: "bulk_start_enrichment",
            arguments: {
              posts: [{ postUri: solarUri }],
              gaps: {
                vision: { count: 1, postUris: [solarUri] },
                sourceAttribution: { count: 0, postUris: [] }
              }
            }
          });
          expect(duplicate.isError).toBe(true);
          expect(getTextContent(duplicate)).toContain("Duplicate postUri in batch");

          const tooMany = await client.callTool({
            name: "bulk_start_enrichment",
            arguments: {
              posts: Array.from(
                { length: BULK_START_ENRICHMENT_MAX_POSTS + 1 },
                (_, index) => ({
                  postUri: `at://did:plc:bulk-enrichment/app.bsky.feed.post/post-${index}`
                })
              )
            }
          });
          expect(tooMany.isError).toBe(true);
          expect(getTextContent(tooMany)).toContain(
            `Maximum: ${BULK_START_ENRICHMENT_MAX_POSTS}.`
          );
        } finally {
          await close();
        }
      })
    )
  );

  it.live("queues batches, skips existing runs, retries 503s, and reports failures", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const attempts = new Map<string, number>();
        const mockFetcher = {
          fetch: async (input: RequestInfo | URL) => {
            const request = input as Request;
            const body = await request.json() as {
              postUri: string;
              enrichmentType: string;
            };
            const nextAttempt = (attempts.get(body.postUri) ?? 0) + 1;
            attempts.set(body.postUri, nextAttempt);

            if (body.postUri === solarUri) {
              return new Response(
                JSON.stringify({
                  runId: "run-solar",
                  workflowInstanceId: "run-solar",
                  status: "queued"
                }),
                { status: 202, headers: { "content-type": "application/json" } }
              );
            }

            if (body.postUri === windUri) {
              return new Response(
                JSON.stringify({ message: "enrichment run already exists" }),
                { status: 409, headers: { "content-type": "application/json" } }
              );
            }

            if (body.postUri === linkUri && nextAttempt < 3) {
              return new Response(
                JSON.stringify({ message: "service unavailable" }),
                { status: 503, headers: { "content-type": "application/json" } }
              );
            }

            if (body.postUri === linkUri) {
              return new Response(
                JSON.stringify({
                  runId: "run-link",
                  workflowInstanceId: "run-link",
                  status: "queued"
                }),
                { status: 202, headers: { "content-type": "application/json" } }
              );
            }

            return new Response(
              JSON.stringify({ message: `unexpected postUri ${body.postUri}` }),
              { status: 500, headers: { "content-type": "application/json" } }
            );
          }
        } as unknown as Fetcher;

        const layer = Layer.mergeAll(
          makeBiLayer({ filename }),
          EnrichmentTriggerClient.layerFromFetcher(mockFetcher, "test-secret")
        );
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        const now = Date.now();
        await Effect.runPromise(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;

            yield* sql`
              INSERT INTO posts (
                uri,
                did,
                cid,
                text,
                created_at,
                indexed_at,
                has_links,
                status,
                ingest_id,
                embed_type
              ) VALUES (
                ${linkUri},
                ${sampleDid},
                ${"cid-bulk-enrichment-1"},
                ${"Imported Twitter source article"},
                ${now - 100},
                ${now - 100},
                ${1},
                ${"active"},
                ${"ingest-bulk-enrichment-1"},
                ${"link"}
              )
            `;

            yield* sql`
              INSERT INTO post_curation
                (post_uri, status, signal_score, predicates_applied, flagged_at, curated_at, curated_by, review_note)
              VALUES
                (${solarUri}, 'curated', ${90}, ${JSON.stringify(["has-media"])}, ${now - 30}, ${now - 30}, 'tester', NULL),
                (${windUri}, 'curated', ${80}, ${JSON.stringify(["has-media"])}, ${now - 20}, ${now - 20}, 'tester', NULL),
                (${linkUri}, 'curated', ${70}, ${JSON.stringify(["has-links"])}, ${now - 10}, ${now - 10}, 'tester', NULL)
              ON CONFLICT(post_uri) DO UPDATE SET
                status = excluded.status,
                signal_score = excluded.signal_score,
                predicates_applied = excluded.predicates_applied,
                flagged_at = excluded.flagged_at,
                curated_at = excluded.curated_at,
                curated_by = excluded.curated_by
            `;

            yield* sql`
              INSERT INTO post_payloads (post_uri, capture_stage, embed_type, embed_payload_json, captured_at, updated_at)
              VALUES
                (${solarUri}, 'picked', 'img', ${JSON.stringify({ kind: "img", images: [{ alt: "Chart", fullsize: "https://example.com/chart.jpg", thumb: "https://example.com/chart-thumb.jpg" }] })}, ${now}, ${now}),
                (${windUri}, 'picked', 'img', ${JSON.stringify({ kind: "img", images: [{ alt: "Wind chart", fullsize: "https://example.com/wind-chart.jpg", thumb: "https://example.com/wind-chart-thumb.jpg" }] })}, ${now}, ${now}),
                (${linkUri}, 'picked', 'link', ${JSON.stringify({ kind: "link", uri: "https://example.com/source", title: "Source article", description: null, thumb: null })}, ${now}, ${now})
              ON CONFLICT(post_uri) DO UPDATE SET
                capture_stage = excluded.capture_stage,
                embed_type = excluded.embed_type,
                embed_payload_json = excluded.embed_payload_json,
                updated_at = excluded.updated_at
            `;
          }).pipe(Effect.provide(layer))
        );

        const { client, close } = await createMcpClient(layer, workflowIdentity);

        try {
          const result = await client.callTool({
            name: "bulk_start_enrichment",
            arguments: {
              posts: [{ postUri: missingUri }],
              gaps: {
                vision: { count: 2, postUris: [solarUri, windUri] },
                sourceAttribution: { count: 1, postUris: [linkUri] }
              }
            }
          });

          expect(result.isError).toBe(false);
          const summary = decodeBulkStartEnrichmentResponse(result);
          expect(summary.queued).toBe(2);
          expect(summary.skipped).toBe(1);
          expect(summary.failed).toBe(1);
          expect(summary.errors).toEqual([
            {
              postUri: missingUri,
              error: "Post must be curated before starting enrichment. Call curate_post first."
            }
          ]);
          expect(summary._display).toContain("Bulk enrichment trigger completed.");
          expect(attempts.get(solarUri)).toBe(1);
          expect(attempts.get(windUri)).toBe(1);
          expect(attempts.get(linkUri)).toBe(3);
          expect(attempts.has(missingUri)).toBe(false);
        } finally {
          await close();
        }
      })
    )
  );
});

describe("MCP workflow integration", () => {
  const fixtureUris = smokeFixtureUris(sampleDid);
  const solarUri = fixtureUris[0]!;
  const windUri = fixtureUris[1]!;

  it.live("supports the review-export-curate-gap-enrich workflow in one session", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const attempts = new Map<string, number>();
        const mockFetcher = {
          fetch: async (input: RequestInfo | URL) => {
            const request = input as Request;
            const body = await request.json() as {
              postUri: string;
              enrichmentType: string;
            };
            attempts.set(body.postUri, (attempts.get(body.postUri) ?? 0) + 1);

            return new Response(
              JSON.stringify({
                runId: `run-${body.enrichmentType}-${body.postUri.split("/").pop()}`,
                workflowInstanceId: `run-${body.enrichmentType}-${body.postUri.split("/").pop()}`,
                status: "queued"
              }),
              { status: 202, headers: { "content-type": "application/json" } }
            );
          }
        } as unknown as Fetcher;

        const layer = Layer.mergeAll(
          makeBiLayer({
            filename,
            config: { curationMinSignalScore: 100 }
          }),
          EnrichmentTriggerClient.layerFromFetcher(mockFetcher, "test-secret")
        );
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        const now = Date.now();
        await Effect.runPromise(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;

            yield* sql`
              INSERT INTO post_curation
                (post_uri, status, signal_score, predicates_applied, flagged_at, curated_at, curated_by, review_note)
              VALUES
                (${solarUri}, 'flagged', ${92}, ${JSON.stringify(["has-media"])}, ${now + 1}, NULL, NULL, NULL),
                (${windUri}, 'flagged', ${81}, ${JSON.stringify(["has-links"])}, ${now}, NULL, NULL, NULL)
              ON CONFLICT(post_uri) DO UPDATE SET
                status = excluded.status,
                signal_score = excluded.signal_score,
                predicates_applied = excluded.predicates_applied,
                flagged_at = excluded.flagged_at,
                curated_at = NULL,
                curated_by = NULL
            `;

            yield* sql`
              INSERT INTO post_payloads (post_uri, capture_stage, embed_type, embed_payload_json, captured_at, updated_at)
              VALUES
                (${solarUri}, 'candidate', 'img', ${JSON.stringify({ kind: "img", images: [{ alt: "Chart", fullsize: "https://example.com/chart.jpg", thumb: "https://example.com/chart-thumb.jpg" }] })}, ${now}, ${now}),
                (${windUri}, 'candidate', 'link', ${JSON.stringify({ kind: "link", uri: "https://example.com/wind", title: "Wind article", description: null, thumb: null })}, ${now}, ${now})
              ON CONFLICT(post_uri) DO UPDATE SET
                capture_stage = excluded.capture_stage,
                embed_type = excluded.embed_type,
                embed_payload_json = excluded.embed_payload_json,
                updated_at = excluded.updated_at
            `;
          }).pipe(Effect.provide(layer))
        );

        const { client, close } = await createMcpClient(layer, workflowIdentity);

        try {
          const exportResult = await client.callTool({
            name: "list_curation_candidates",
            arguments: { export: true, limit: 10 }
          });
          const exportPage = decodeCurationCandidatesResponse(exportResult);
          expect(exportPage.exportItems.map((item) => item.uri)).toEqual([
            solarUri,
            windUri
          ]);

          const curateResult = await client.callTool({
            name: "bulk_curate",
            arguments: {
              decisions: exportPage.exportItems.map((item) => ({
                postUri: item.uri,
                action: "curate" as const
              }))
            }
          });
          const curateSummary = decodeBulkCurateResponse(curateResult);
          expect(curateSummary.curated).toBe(2);
          expect(curateSummary.rejected).toBe(0);
          expect(curateSummary.skipped).toBe(0);
          expect(curateSummary.errors).toEqual([]);

          const gapsResult = await client.callTool({
            name: "list_enrichment_gaps",
            arguments: {}
          });
          const gaps = decodeEnrichmentGapsResponse(gapsResult);
          expect(gaps.vision.postUris).toEqual([solarUri]);
          expect(gaps.sourceAttribution.postUris).toEqual([windUri]);

          const bulkResult = await client.callTool({
            name: "bulk_start_enrichment",
            arguments: {
              gaps: {
                vision: gaps.vision,
                sourceAttribution: gaps.sourceAttribution
              }
            }
          });
          const bulkSummary = decodeBulkStartEnrichmentResponse(bulkResult);
          expect(bulkSummary.queued).toBe(2);
          expect(bulkSummary.skipped).toBe(0);
          expect(bulkSummary.failed).toBe(0);
          expect(bulkSummary.errors).toEqual([]);
          expect(attempts.get(solarUri)).toBe(1);
          expect(attempts.get(windUri)).toBe(1);
        } finally {
          await close();
        }
      })
    )
  );
});

describe("MCP submit_editorial_pick readiness gate", () => {
  const solarUri = `at://${sampleDid}/app.bsky.feed.post/post-solar`;

  it.live("rejects pick when enrichment not complete", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        // Directly set curation status to "curated" and add a payload row
        // so the enrichment readiness gate is exercised.
        const now = Date.now();
        await Effect.runPromise(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            yield* sql`
              INSERT INTO post_curation
                (post_uri, status, signal_score, predicates_applied, flagged_at, curated_at, curated_by, review_note)
              VALUES
                (${solarUri}, 'curated', ${0}, ${"[]"}, ${now}, ${now}, 'test-curator', 'test')
              ON CONFLICT(post_uri) DO UPDATE SET
                status = 'curated',
                curated_at = ${now},
                curated_by = 'test-curator',
                review_note = 'test'
            `;
            // Add a payload row so the enrichment readiness gate is exercised
            const embedPayloadJson = JSON.stringify({ kind: "link", uri: "https://example.com/article", title: "Test", description: "Test article", thumb: null });
            yield* sql`
              INSERT INTO post_payloads (post_uri, capture_stage, embed_type, embed_payload_json, captured_at, updated_at)
              VALUES (${solarUri}, 'picked', 'link', ${embedPayloadJson}, ${now}, ${now})
            `;
          }).pipe(Effect.provide(layer))
        );

        const { client, close } = await createMcpClient(
          makeBiLayer({ filename }),
          workflowIdentity
        );

        try {
          // Try to accept — should fail because enrichment not complete
          const result = await client.callTool({
            name: "submit_editorial_pick",
            arguments: {
              postUri: solarUri,
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

  it.live("rejects pick when an embedded post is missing stored media details", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        const now = Date.now();
        await Effect.runPromise(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            yield* sql`
              UPDATE posts
              SET embed_type = 'img'
              WHERE uri = ${solarUri}
            `;
            yield* sql`
              INSERT INTO post_curation
                (post_uri, status, signal_score, predicates_applied, flagged_at, curated_at, curated_by, review_note)
              VALUES
                (${solarUri}, 'curated', ${0}, ${"[]"}, ${now}, ${now}, 'test-curator', 'test')
              ON CONFLICT(post_uri) DO UPDATE SET
                status = 'curated',
                curated_at = ${now},
                curated_by = 'test-curator',
                review_note = 'test'
            `;
          }).pipe(Effect.provide(layer))
        );

        const { client, close } = await createMcpClient(
          makeBiLayer({ filename }),
          workflowIdentity
        );

        try {
          const result = await client.callTool({
            name: "submit_editorial_pick",
            arguments: {
              postUri: solarUri,
              score: 80,
              reason: "test pick"
            }
          });

          expect(result.isError).toBe(true);
          const text = result.content.find(
            (c): c is { type: "text"; text: string } => c.type === "text"
          );
          expect(text!.text).toContain("missing stored media details");
        } finally {
          await close();
        }
      })
    )
  );
});

describe("MCP get_post_enrichments", () => {
  it.live("returns readiness for a post with no enrichments", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const seedLayer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(seedLayer)));

        const { client, close } = await createMcpClient(makeBiLayer({ filename }));

        try {
          const result = await client.callTool({
            name: "get_post_enrichments",
            arguments: { postUri: `at://${sampleDid}/app.bsky.feed.post/post-solar` }
          });
          expect(result.isError).toBe(false);
          const text = result.content.find(
            (c): c is { type: "text"; text: string } => c.type === "text"
          );
          expect(text).toBeDefined();
          expect(text!.text).toContain("Readiness: none");
        } finally {
          await close();
        }
      })
    )
  );
});
