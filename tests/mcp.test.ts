import { Effect } from "effect";
import { SqlClient } from "@effect/sql";
import { describe, expect, it } from "@effect/vitest";
import { decodeCallToolResultWith } from "../src/mcp/Client";
import {
  KnowledgePostsMcpOutput,
  ExpertListMcpOutput,
  OntologyTopicsMcpOutput,
  EditorialPicksMcpOutput
} from "../src/mcp/OutputSchemas";
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
const decodeExpertsResponse = decodeCallToolResultWith(ExpertListMcpOutput);
const decodeTopicsResponse = decodeCallToolResultWith(OntologyTopicsMcpOutput);
const decodeEditorialPicksResponse = decodeCallToolResultWith(EditorialPicksMcpOutput);

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
            "get_post_links",
            "get_post_thread",
            "get_recent_posts",
            "get_thread_document",
            "get_topic",
            "list_curation_candidates",
            "list_editorial_picks",
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

          expect(searchItems).toHaveLength(1);
          expect(searchItems[0]?.topics).toContain("solar");
          expect(expertItems.length).toBeGreaterThan(0);
          expect(expertItems[0]?.domain).toBe("energy");
          expect(topicItems.some((item) => item.slug === "solar")).toBe(true);
        } finally {
          await close();
        }
      })
    )
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
});
