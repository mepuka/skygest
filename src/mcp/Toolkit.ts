import type { SqlError } from "@effect/sql/SqlError";
import type { DbError } from "../domain/errors";
import { Tool, Toolkit } from "@effect/ai";
import { Effect, Schema } from "effect";
import {
  ExplainPostTopicsInput,
  ExpandTopicsInput,
  GetTopicInput,
  ListTopicsInput,
  GetPostLinksInput,
  GetRecentPostsInput,
  ListExpertsInput,
  McpToolQueryError,
  SearchPostsInput
} from "../domain/bi";
import { ListEditorialPicksInput } from "../domain/editorial";
import {
  KnowledgePostsMcpOutput,
  KnowledgeLinksMcpOutput,
  ExpertListMcpOutput,
  OntologyTopicsMcpOutput,
  OntologyTopicMcpOutput,
  ExpandedTopicsMcpOutput,
  ExplainPostTopicsMcpOutput,
  EditorialPicksMcpOutput
} from "./OutputSchemas.ts";
import {
  formatPosts,
  formatLinks,
  formatExperts,
  formatTopics,
  formatTopic,
  formatExpandedTopics,
  formatExplainedPostTopics,
  formatEditorialPicks
} from "./Fmt.ts";
import { EditorialService } from "../services/EditorialService";
import { KnowledgeQueryService } from "../services/KnowledgeQueryService";

// ---------------------------------------------------------------------------
// MCP-specific input schemas — strip cursor fields that LLMs cannot construct
// ---------------------------------------------------------------------------

const GetRecentPostsMcpInput = Schema.Struct({
  topic: GetRecentPostsInput.fields.topic,
  expertDid: GetRecentPostsInput.fields.expertDid,
  since: GetRecentPostsInput.fields.since,
  until: GetRecentPostsInput.fields.until,
  limit: GetRecentPostsInput.fields.limit
});

const GetPostLinksMcpInput = Schema.Struct({
  domain: GetPostLinksInput.fields.domain,
  topic: GetPostLinksInput.fields.topic,
  since: GetPostLinksInput.fields.since,
  until: GetPostLinksInput.fields.until,
  limit: GetPostLinksInput.fields.limit
});

const toQueryError = (tool: string) => (error: SqlError | DbError) =>
  McpToolQueryError.make({
    tool,
    message: error.message,
    error
  });

export const SearchPostsTool = Tool.make("search_posts", {
  description: "Search expert posts by keyword using full-text search. Supports topic and time range filters. Use this for keyword-based discovery; use get_recent_posts for chronological browsing.",
  parameters: SearchPostsInput.fields,
  success: KnowledgePostsMcpOutput,
  failure: McpToolQueryError
})
  .annotate(Tool.Title, "Search Posts")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const GetRecentPostsTool = Tool.make("get_recent_posts", {
  description: "Browse posts in reverse chronological order. Filter by topic slug or expert DID. Use this for chronological browsing; use search_posts for keyword matching.",
  parameters: GetRecentPostsMcpInput.fields,
  success: KnowledgePostsMcpOutput,
  failure: McpToolQueryError
})
  .annotate(Tool.Title, "Get Recent Posts")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const GetPostLinksTool = Tool.make("get_post_links", {
  description: "List URLs shared in expert posts. Filter by link hostname (e.g. 'reuters.com') or topic. Returns title, description, and image metadata for each link.",
  parameters: GetPostLinksMcpInput.fields,
  success: KnowledgeLinksMcpOutput,
  failure: McpToolQueryError
})
  .annotate(Tool.Title, "Get Post Links")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const ListExpertsTool = Tool.make("list_experts", {
  description: "List domain experts tracked by the knowledge base. Filter by knowledge domain (e.g. 'energy') or active status.",
  parameters: ListExpertsInput.fields,
  success: ExpertListMcpOutput,
  failure: McpToolQueryError
})
  .annotate(Tool.Title, "List Experts")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const ListTopicsTool = Tool.make("list_topics", {
  description: "List topics used to classify posts. Use view='facets' for high-level categories (e.g. Solar, Hydrogen, Wind) or view='concepts' for fine-grained ontology nodes.",
  parameters: ListTopicsInput.fields,
  success: OntologyTopicsMcpOutput,
  failure: McpToolQueryError
})
  .annotate(Tool.Title, "List Topics")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const GetTopicTool = Tool.make("get_topic", {
  description: "Look up a single topic by its slug. Returns the topic's label, description, related concepts, and matching terms.",
  parameters: GetTopicInput.fields,
  success: OntologyTopicMcpOutput,
  failure: McpToolQueryError
})
  .annotate(Tool.Title, "Get Topic")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const ExpandTopicsTool = Tool.make("expand_topics", {
  description: "Given topic slugs, find related topics. Use mode='descendants' to get narrower sub-topics, mode='ancestors' to get broader parent topics. Useful for broadening or narrowing a search scope.",
  parameters: ExpandTopicsInput.fields,
  success: ExpandedTopicsMcpOutput,
  failure: McpToolQueryError
})
  .annotate(Tool.Title, "Expand Topics")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const ExplainPostTopicsTool = Tool.make("explain_post_topics", {
  description: "Explain why a post was classified under its topics. Shows the matched term, signal type (keyword, hashtag, or domain), and match score for each topic assignment.",
  parameters: ExplainPostTopicsInput.fields,
  success: ExplainPostTopicsMcpOutput,
  failure: McpToolQueryError
})
  .annotate(Tool.Title, "Explain Post Topics")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const ListEditorialPicksTool = Tool.make("list_editorial_picks", {
  description: "List posts that have been editorially selected for the curated feed. Filter by minimum score (0-100). Returns the post URI, score, reason, category, and curator for each pick.",
  parameters: ListEditorialPicksInput.fields,
  success: EditorialPicksMcpOutput,
  failure: McpToolQueryError
})
  .annotate(Tool.Title, "List Editorial Picks")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const KnowledgeMcpToolkit = Toolkit.make(
  SearchPostsTool,
  GetRecentPostsTool,
  GetPostLinksTool,
  ListExpertsTool,
  ListTopicsTool,
  GetTopicTool,
  ExpandTopicsTool,
  ExplainPostTopicsTool,
  ListEditorialPicksTool
);

export const KnowledgeMcpHandlers = KnowledgeMcpToolkit.toLayer(
  Effect.gen(function* () {
    const queryService = yield* KnowledgeQueryService;
    const editorialService = yield* EditorialService;

    return KnowledgeMcpToolkit.of({
      search_posts: (input) =>
        queryService.searchPosts(input).pipe(
          Effect.map((items) => ({
            items,
            _display: formatPosts(items)
          })),
          Effect.mapError(toQueryError("search_posts"))
        ),
      get_recent_posts: (input) =>
        queryService.getRecentPosts(input).pipe(
          Effect.map((items) => ({
            items,
            _display: formatPosts(items)
          })),
          Effect.mapError(toQueryError("get_recent_posts"))
        ),
      get_post_links: (input) =>
        queryService.getPostLinks(input).pipe(
          Effect.map((items) => ({
            items,
            _display: formatLinks(items)
          })),
          Effect.mapError(toQueryError("get_post_links"))
        ),
      list_experts: (input) =>
        queryService.listExperts(input).pipe(
          Effect.map((items) => ({
            items,
            _display: formatExperts(items)
          })),
          Effect.mapError(toQueryError("list_experts"))
        ),
      list_topics: (input) =>
        queryService.listTopics(input).pipe(
          Effect.map((items) => ({
            view: input.view ?? "facets",
            items,
            _display: formatTopics(items, input.view ?? "facets")
          })),
          Effect.mapError(toQueryError("list_topics"))
        ),
      get_topic: (input) =>
        queryService.getTopic(input).pipe(
          Effect.map((item) => ({
            item,
            _display: item !== null ? formatTopic(item) : "Topic not found."
          })),
          Effect.mapError(toQueryError("get_topic"))
        ),
      expand_topics: (input) =>
        queryService.expandTopics(input).pipe(
          Effect.map((result) => ({
            ...result,
            _display: formatExpandedTopics(result)
          })),
          Effect.mapError(toQueryError("expand_topics"))
        ),
      explain_post_topics: (input) =>
        queryService.explainPostTopics(input.postUri).pipe(
          Effect.map((result) => ({
            ...result,
            _display: formatExplainedPostTopics(result)
          })),
          Effect.mapError(toQueryError("explain_post_topics"))
        ),
      list_editorial_picks: (input) =>
        editorialService.listPicks(input).pipe(
          Effect.map((items) => ({
            items,
            _display: formatEditorialPicks(items)
          })),
          Effect.mapError(toQueryError("list_editorial_picks"))
        )
    });
  })
);
