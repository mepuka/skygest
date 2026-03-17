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
  GetPostThreadInput,
  GetThreadDocumentInput,
  ListExpertsInput,
  McpToolQueryError,
  SearchPostsInput
} from "../domain/bi";
import { ListEditorialPicksInput } from "../domain/editorial";
import { ListCurationCandidatesInput, CuratePostInput } from "../domain/curation";
import {
  KnowledgePostsMcpOutput,
  KnowledgeLinksMcpOutput,
  ExpertListMcpOutput,
  OntologyTopicsMcpOutput,
  OntologyTopicMcpOutput,
  ExpandedTopicsMcpOutput,
  ExplainPostTopicsMcpOutput,
  EditorialPicksMcpOutput,
  PostThreadMcpOutput,
  ThreadDocumentMcpOutput,
  CurationCandidatesMcpOutput,
  CuratePostMcpOutput
} from "./OutputSchemas.ts";
import {
  formatPosts,
  formatLinks,
  formatExperts,
  formatTopics,
  formatTopic,
  formatExpandedTopics,
  formatExplainedPostTopics,
  formatEditorialPicks,
  formatCurationCandidates
} from "./Fmt.ts";
import { EditorialService } from "../services/EditorialService";
import { CurationService } from "../services/CurationService";
import { KnowledgeQueryService } from "../services/KnowledgeQueryService";
import { BlueskyClient } from "../bluesky/BlueskyClient";
import { flattenThread } from "../bluesky/ThreadFlatten.ts";
import { printThread } from "../bluesky/ThreadPrinter.ts";

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
  description: "Look up a single topic by its slug. Returns label, kind, description, concept slugs, parent/child relationships, matching terms, hashtags, and signal domains.",
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
  description: "Given topic slugs, find related topics. mode='exact' (default) for direct matches, mode='descendants' for narrower sub-topics, mode='ancestors' for broader parent topics.",
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
  description: "Explain why a post was classified under its topics. Shows the matched term, signal type (term, hashtag, or domain), and match score for each topic assignment.",
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
  description: "List posts that have been editorially selected for the curated feed. Filter by minimum score (0-100) or pick date. Returns the post URI, score, reason, category, curator, and pick timestamp for each pick.",
  parameters: ListEditorialPicksInput.fields,
  success: EditorialPicksMcpOutput,
  failure: McpToolQueryError
})
  .annotate(Tool.Title, "List Editorial Picks")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const GetPostThreadTool = Tool.make("get_post_thread", {
  description: "Get the thread context for a Bluesky post. Returns ancestor posts (conversation history), the focus post, and replies. Includes engagement metrics (likes, reposts, reply counts). Calls the live Bluesky API.",
  parameters: GetPostThreadInput.fields,
  success: PostThreadMcpOutput,
  failure: McpToolQueryError
})
  .annotate(Tool.Title, "Get Post Thread")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

export const GetThreadDocumentTool = Tool.make("get_thread_document", {
  description: "Render a Bluesky thread as a readable document. Returns the thread author's posts as a narrative with numbered sections, plus filtered expert discussion. Use this to read and understand threads — prefer over get_post_thread for analysis. Supports filtering replies by engagement (minLikes), depth (maxDepth), and top-N.",
  parameters: GetThreadDocumentInput.fields,
  success: ThreadDocumentMcpOutput,
  failure: McpToolQueryError
})
  .annotate(Tool.Title, "Get Thread Document")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

export const ListCurationCandidatesTool = Tool.make("list_curation_candidates", {
  description: "List posts flagged by curation predicates for editorial review. Shows signal score, matched predicates, and post details. Use to find high-signal posts that may warrant enrichment.",
  parameters: ListCurationCandidatesInput.fields,
  success: CurationCandidatesMcpOutput,
  failure: McpToolQueryError
})
  .annotate(Tool.Title, "List Curation Candidates")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const CuratePostTool = Tool.make("curate_post", {
  description: "Curate or reject a post. Curating fetches live embed data from Bluesky, captures the payload, and marks it for enrichment. Rejecting dismisses the post. Idempotent — re-curating an already-curated post is a no-op.",
  parameters: CuratePostInput.fields,
  success: CuratePostMcpOutput,
  failure: McpToolQueryError
})
  .annotate(Tool.Title, "Curate Post")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

// NOTE: CuratePostTool is defined but intentionally excluded from the shared
// MCP toolkit. The /mcp route is gated by mcp:read scope only — exposing a
// write tool here would bypass auth. curate_post will be added back once the
// MCP route supports write-scope gating (or it moves to the admin surface).

export const KnowledgeMcpToolkit = Toolkit.make(
  SearchPostsTool,
  GetRecentPostsTool,
  GetPostLinksTool,
  ListExpertsTool,
  ListTopicsTool,
  GetTopicTool,
  ExpandTopicsTool,
  ExplainPostTopicsTool,
  ListEditorialPicksTool,
  GetPostThreadTool,
  GetThreadDocumentTool,
  ListCurationCandidatesTool
);

const extractText = (record: unknown): string => {
  if (typeof record === "object" && record !== null && "text" in record) {
    return typeof record.text === "string" ? record.text : "";
  }
  return "";
};

const extractCreatedAt = (record: unknown, fallbackIndexedAt: string): string => {
  if (typeof record === "object" && record !== null && "createdAt" in record) {
    return typeof record.createdAt === "string" ? record.createdAt : fallbackIndexedAt;
  }
  return fallbackIndexedAt;
};

export const KnowledgeMcpHandlers = KnowledgeMcpToolkit.toLayer(
  Effect.gen(function* () {
    const queryService = yield* KnowledgeQueryService;
    const editorialService = yield* EditorialService;
    const curationService = yield* CurationService;
    const bskyClient = yield* BlueskyClient;
    // curationService is used for list_curation_candidates (read-only).
    // curate_post handler removed — see note above KnowledgeMcpToolkit.

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
        ),
      get_post_thread: (input) =>
        bskyClient.getPostThread(input.postUri, {
          depth: input.depth ?? 3,
          parentHeight: input.parentHeight ?? 3
        }).pipe(
          Effect.flatMap((response) => {
            const flat = flattenThread(response.thread);
            if (!flat) {
              return Effect.fail(McpToolQueryError.make({
                tool: "get_post_thread",
                message: "Post not found or thread unavailable",
                error: new Error("thread decode failed")
              }));
            }

            const mapEmbedType = (embed: { $type?: string } | undefined): string | null => {
              if (!embed?.$type) return null;
              const t = embed.$type;
              if (t.includes("record") && t.includes("Media")) return "media";
              if (t.includes("record")) return "quote";
              if (t.includes("external")) return "link";
              if (t.includes("images")) return "img";
              if (t.includes("video")) return "video";
              return null;
            };

            const extractRecordText = (value: unknown): string | null => {
              if (typeof value === "object" && value !== null && "text" in value) {
                return typeof (value as any).text === "string" ? (value as any).text : null;
              }
              return null;
            };

            const buildEmbedContent = (embed: any): unknown | null => {
              if (!embed?.$type) return null;
              const t = embed.$type as string;

              if (t.includes("images") && embed.images) {
                return {
                  images: (embed.images as any[]).map((img: any) => ({
                    thumb: img.thumb,
                    fullsize: img.fullsize,
                    alt: img.alt ?? null
                  }))
                };
              }

              if (t.includes("external") && embed.external) {
                return {
                  uri: embed.external.uri,
                  title: embed.external.title ?? null,
                  description: embed.external.description ?? null,
                  thumb: embed.external.thumb ?? null
                };
              }

              if (t.includes("video")) {
                return {
                  playlist: embed.playlist ?? null,
                  thumbnail: embed.thumbnail ?? null,
                  alt: embed.alt ?? null
                };
              }

              if (t.includes("record") && t.includes("Media")) {
                const record = embed.record?.record ?? embed.record;
                const mediaEmbed = embed.media;
                return {
                  record: record ? {
                    uri: record.uri ?? null,
                    text: extractRecordText(record.value),
                    author: record.author?.handle ?? record.author?.did ?? null
                  } : null,
                  media: mediaEmbed ? buildEmbedContent({ ...mediaEmbed, $type: mediaEmbed.$type ?? "unknown" }) : null
                };
              }

              if (t.includes("record") && embed.record) {
                const rec = embed.record;
                return {
                  uri: rec.uri ?? null,
                  text: extractRecordText(rec.value),
                  author: rec.author?.handle ?? rec.author?.did ?? null
                };
              }

              return null;
            };

            const toResult = (
              fp: { post: any; depth: number; parentUri: string | null },
              position: "ancestor" | "focus" | "reply"
            ) => ({
              uri: fp.post.uri as string,
              did: fp.post.author.did as string,
              handle: (fp.post.author.handle ?? null) as string | null,
              displayName: (fp.post.author.displayName ?? null) as string | null,
              text: extractText(fp.post.record),
              createdAt: extractCreatedAt(fp.post.record, fp.post.indexedAt),
              replyCount: (fp.post.replyCount ?? null) as number | null,
              repostCount: (fp.post.repostCount ?? null) as number | null,
              likeCount: (fp.post.likeCount ?? null) as number | null,
              quoteCount: (fp.post.quoteCount ?? null) as number | null,
              position,
              depth: fp.depth,
              parentUri: (fp.parentUri ?? null) as string | null,
              embedType: mapEmbedType(fp.post.embed),
              embedContent: buildEmbedContent(fp.post.embed)
            });

            const result = {
              focusUri: flat.focus.post.uri as string,
              ancestors: flat.ancestors.map(p => toResult(p, "ancestor")),
              focus: toResult(flat.focus, "focus"),
              replies: flat.replies.map(p => toResult(p, "reply"))
            };

            return Effect.succeed({
              ...result,
              _display: printThread(flat, {}).body
            } as unknown as PostThreadMcpOutput);
          }),
          Effect.mapError((error) =>
            "_tag" in (error as any) && (error as any)._tag === "McpToolQueryError"
              ? error as McpToolQueryError
              : McpToolQueryError.make({
                  tool: "get_post_thread",
                  message: error instanceof Error ? error.message : String(error),
                  error
                })
          )
        ),
      get_thread_document: (input) =>
        bskyClient.getPostThread(input.postUri, {
          depth: input.depth ?? 3,
          parentHeight: input.parentHeight ?? 3
        }).pipe(
          Effect.flatMap((response) => {
            const flat = flattenThread(response.thread);
            if (!flat) {
              return Effect.fail(McpToolQueryError.make({
                tool: "get_thread_document",
                message: "Post not found or thread unavailable",
                error: new Error("thread decode failed")
              }));
            }

            const doc = printThread(flat, {
              maxDepth: input.maxDepth,
              minLikes: input.minLikes,
              topN: input.topN
            });

            return Effect.succeed(doc);
          }),
          Effect.mapError((error) =>
            "_tag" in (error as any) && (error as any)._tag === "McpToolQueryError"
              ? error as McpToolQueryError
              : McpToolQueryError.make({
                  tool: "get_thread_document",
                  message: error instanceof Error ? error.message : String(error),
                  error
                })
          )
        ),
      list_curation_candidates: (input) =>
        curationService.listCandidates(input).pipe(
          Effect.map((items) => ({
            items,
            _display: formatCurationCandidates(items)
          })),
          Effect.mapError(toQueryError("list_curation_candidates"))
        )
    });
  })
);
