import type { SqlError } from "@effect/sql/SqlError";
import { Tool, Toolkit } from "@effect/ai";
import { Effect } from "effect";
import {
  ExplainPostTopicsInput,
  ExplainPostTopicsOutput,
  ExpandTopicsInput,
  ExpandedTopicsOutput,
  ExpertListOutput,
  GetTopicInput,
  ListTopicsInput,
  OntologyTopicOutput,
  OntologyTopicsOutput,
  GetPostLinksInput,
  GetRecentPostsInput,
  KnowledgeLinksOutput,
  KnowledgePostsOutput,
  ListExpertsInput,
  McpToolQueryError,
  SearchPostsInput
} from "../domain/bi";
import { KnowledgeQueryService } from "../services/KnowledgeQueryService";

const toQueryError = (tool: string) => (error: SqlError) =>
  McpToolQueryError.make({
    tool,
    message: error.message,
    error
  });

export const SearchPostsTool = Tool.make("search_posts", {
  description: "Search stored expert posts using full-text search and optional topic/time filters.",
  parameters: SearchPostsInput.fields,
  success: KnowledgePostsOutput,
  failure: McpToolQueryError
})
  .annotate(Tool.Title, "Search Posts")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const GetRecentPostsTool = Tool.make("get_recent_posts", {
  description: "Get recent posts for the configured knowledge base with optional topic or expert filtering.",
  parameters: GetRecentPostsInput.fields,
  success: KnowledgePostsOutput,
  failure: McpToolQueryError
})
  .annotate(Tool.Title, "Get Recent Posts")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const GetPostLinksTool = Tool.make("get_post_links", {
  description: "List links extracted from stored posts, optionally filtered by link domain or topic.",
  parameters: GetPostLinksInput.fields,
  success: KnowledgeLinksOutput,
  failure: McpToolQueryError
})
  .annotate(Tool.Title, "Get Post Links")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const ListExpertsTool = Tool.make("list_experts", {
  description: "List experts tracked by the knowledge base.",
  parameters: ListExpertsInput.fields,
  success: ExpertListOutput,
  failure: McpToolQueryError
})
  .annotate(Tool.Title, "List Experts")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const ListTopicsTool = Tool.make("list_topics", {
  description: "List canonical ontology topics or raw ontology concepts available to the knowledge base.",
  parameters: ListTopicsInput.fields,
  success: OntologyTopicsOutput,
  failure: McpToolQueryError
})
  .annotate(Tool.Title, "List Topics")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const GetTopicTool = Tool.make("get_topic", {
  description: "Look up a canonical topic or ontology concept by slug.",
  parameters: GetTopicInput.fields,
  success: OntologyTopicOutput,
  failure: McpToolQueryError
})
  .annotate(Tool.Title, "Get Topic")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const ExpandTopicsTool = Tool.make("expand_topics", {
  description: "Expand ontology topics or concepts into related canonical retrieval topics.",
  parameters: ExpandTopicsInput.fields,
  success: ExpandedTopicsOutput,
  failure: McpToolQueryError
})
  .annotate(Tool.Title, "Expand Topics")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const ExplainPostTopicsTool = Tool.make("explain_post_topics", {
  description: "Explain why a stored post matched its ontology topics.",
  parameters: ExplainPostTopicsInput.fields,
  success: ExplainPostTopicsOutput,
  failure: McpToolQueryError
})
  .annotate(Tool.Title, "Explain Post Topics")
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
  ExplainPostTopicsTool
);

export const KnowledgeMcpHandlers = KnowledgeMcpToolkit.toLayer(
  Effect.gen(function* () {
    const queryService = yield* KnowledgeQueryService;

    return KnowledgeMcpToolkit.of({
      search_posts: (input) =>
        queryService.searchPosts(input).pipe(
          Effect.map((items) => ({ items })),
          Effect.mapError(toQueryError("search_posts"))
        ),
      get_recent_posts: (input) =>
        queryService.getRecentPosts(input).pipe(
          Effect.map((items) => ({ items })),
          Effect.mapError(toQueryError("get_recent_posts"))
        ),
      get_post_links: (input) =>
        queryService.getPostLinks(input).pipe(
          Effect.map((items) => ({ items })),
          Effect.mapError(toQueryError("get_post_links"))
        ),
      list_experts: (input) =>
        queryService.listExperts(input).pipe(
          Effect.map((items) => ({ items })),
          Effect.mapError(toQueryError("list_experts"))
        ),
      list_topics: (input) =>
        queryService.listTopics(input).pipe(
          Effect.map((items) => ({ view: input.view ?? "facets", items })),
          Effect.mapError(toQueryError("list_topics"))
        ),
      get_topic: (input) =>
        queryService.getTopic(input).pipe(
          Effect.map((item) => ({ item })),
          Effect.mapError(toQueryError("get_topic"))
        ),
      expand_topics: (input) =>
        queryService.expandTopics(input).pipe(
          Effect.mapError(toQueryError("expand_topics"))
        ),
      explain_post_topics: (input) =>
        queryService.explainPostTopics(input.postUri).pipe(
          Effect.mapError(toQueryError("explain_post_topics"))
        )
    });
  })
);
