import { Effect, Layer } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { describe, expect, it } from "@effect/vitest";
import { decodeCallToolResultWith } from "../src/mcp/Client";
import { createPersistentMcpHandler } from "../src/mcp/Router";
import {
  BulkCurateMcpOutput,
  BulkStartEnrichmentMcpOutput,
  CurationCandidatesMcpOutput,
  EnrichmentGapsMcpOutput,
  EnrichmentIssuesMcpOutput,
  KnowledgePostsMcpOutput,
  ExpertListMcpOutput,
  OntologyTopicsMcpOutput,
  EditorialPicksMcpOutput
} from "../src/mcp/OutputSchemas";
import { EnrichmentTriggerClient } from "../src/services/EnrichmentTriggerClient";
import { smokeFixtureUris } from "../src/staging/SmokeFixture";
import {
  createMcpClient,
  makeBiLayer,
  readOnlyIdentity,
  workflowIdentity,
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
const decodeEditorialPicksResponse = decodeCallToolResultWith(EditorialPicksMcpOutput);

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
  const solarUri = fixtureUris[0];

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

  it.live("workflow-write profile exposes 4 prompts including curate-session", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        const { client, close } = await createMcpClient(makeBiLayer({ filename }), workflowIdentity);

        try {
          const prompts = await client.listPrompts();
          const names = prompts.prompts.map((p) => p.name).sort();
          expect(names).toEqual(["assess-expert", "curate-digest", "curate-session", "explore-topic"]);
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
  it.live("workflow-write profile includes start_enrichment", () =>
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

  it.live("read-only profile does not include start_enrichment", () =>
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
});

describe("MCP list_curation_candidates", () => {
  const fixtureUris = smokeFixtureUris(sampleDid);
  const solarUri = fixtureUris[0]!;
  const windUri = fixtureUris[1]!;

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
            const twitterUri = "x://tweet/mcp-1";

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
});

describe("MCP bulk_start_enrichment", () => {
  const fixtureUris = smokeFixtureUris(sampleDid);
  const solarUri = fixtureUris[0]!;
  const windUri = fixtureUris[1]!;
  const linkUri = "x://tweet/bulk-enrichment-1";
  const missingUri = "at://did:plc:missing/app.bsky.feed.post/nope";

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
