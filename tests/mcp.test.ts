import { Effect } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { ExpertListOutput, KnowledgePostsOutput, OntologyTopicsOutput } from "../src/domain/bi";
import { decodeCallToolResultWith } from "../src/mcp/Client";
import {
  createMcpClient,
  makeBiLayer,
  seedKnowledgeBase,
  withTempSqliteFile
} from "./support/runtime";

const decodeSearchResponse = decodeCallToolResultWith(KnowledgePostsOutput);
const decodeExpertsResponse = decodeCallToolResultWith(ExpertListOutput);
const decodeTopicsResponse = decodeCallToolResultWith(OntologyTopicsOutput);

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
