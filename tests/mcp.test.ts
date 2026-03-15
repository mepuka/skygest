import { Effect } from "effect";
import { SqlClient } from "@effect/sql";
import { describe, expect, it } from "@effect/vitest";
import { ExpertListOutput, KnowledgePostsOutput, OntologyTopicsOutput } from "../src/domain/bi";
import { EditorialPicksOutput } from "../src/domain/editorial";
import { decodeCallToolResultWith } from "../src/mcp/Client";
import { smokeFixtureUris } from "../src/staging/SmokeFixture";
import {
  createMcpClient,
  makeBiLayer,
  sampleDid,
  seedKnowledgeBase,
  withTempSqliteFile
} from "./support/runtime";

const decodeSearchResponse = decodeCallToolResultWith(KnowledgePostsOutput);
const decodeExpertsResponse = decodeCallToolResultWith(ExpertListOutput);
const decodeTopicsResponse = decodeCallToolResultWith(OntologyTopicsOutput);
const decodeEditorialPicksResponse = decodeCallToolResultWith(EditorialPicksOutput);

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
            "get_recent_posts",
            "get_topic",
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
