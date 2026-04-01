import type { SqlError } from "@effect/sql/SqlError";
import type { DbError } from "../domain/errors";
import { Tool, Toolkit } from "@effect/ai";
import { Context, Effect, Layer, Option, Schema } from "effect";
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
import { ListEditorialPicksInput, SubmitEditorialPickMcpInput } from "../domain/editorial";
import { ListCurationCandidatesInput, CuratePostInput } from "../domain/curation";
import { GetPostEnrichmentsInput, EnrichmentKind } from "../domain/enrichment";
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
  CuratePostMcpOutput,
  SubmitEditorialPickMcpOutput,
  PostEnrichmentsMcpOutput,
  StartEnrichmentMcpOutput
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
  formatCurationCandidates,
  formatCuratePostResult,
  formatSubmitPickResult,
  formatEnrichments,
  formatStartEnrichment
} from "./Fmt.ts";
import { EditorialService } from "../services/EditorialService";
import { CurationService } from "../services/CurationService";
import { CurationRepo } from "../services/CurationRepo";
import { KnowledgeQueryService } from "../services/KnowledgeQueryService";
import { BlueskyClient } from "../bluesky/BlueskyClient";
import { PostEnrichmentReadService } from "../services/PostEnrichmentReadService";
import { EnrichmentTriggerClient } from "../services/EnrichmentTriggerClient";
import { CandidatePayloadService } from "../services/CandidatePayloadService";
import { extractEmbedKind, buildTypedEmbed } from "../bluesky/EmbedExtract";
import { flattenThread } from "../bluesky/ThreadFlatten.ts";
import { printThread } from "../bluesky/ThreadPrinter.ts";
import { OperatorIdentity } from "../http/Identity";
import type { McpCapabilityProfile } from "./RequestAuth";

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

const StartEnrichmentMcpInput = Schema.Struct({
  postUri: GetPostEnrichmentsInput.fields.postUri,
  enrichmentType: Schema.optional(EnrichmentKind.annotations({
    description: "Enrichment type: 'vision' for charts/screenshots, 'source-attribution' for links. If omitted, auto-detected from embed type."
  }))
});

const toQueryError = (tool: string) => (error: { message: string }) =>
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

export const GetPostEnrichmentsTool = Tool.make("get_post_enrichments", {
  description: "Inspect enrichment state and readiness for a post. Returns validated enrichment payloads (vision, source-attribution, grounding) and latest enrichment run summaries. Readiness values: none, pending, complete, failed, needs-review.",
  parameters: GetPostEnrichmentsInput.fields,
  success: PostEnrichmentsMcpOutput,
  failure: McpToolQueryError
})
  .annotate(Tool.Title, "Get Post Enrichments")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

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

export const CuratePostTool = Tool.make("curate_post", {
  description: "Curate or reject a post. Curating fetches live embed data from Bluesky and captures the payload. Call start_enrichment separately to queue enrichment processing. Rejecting dismisses the post. Idempotent.",
  parameters: CuratePostInput.fields,
  success: CuratePostMcpOutput,
  failure: McpToolQueryError
})
  .annotate(Tool.Title, "Curate Post")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

export const SubmitEditorialPickTool = Tool.make("submit_editorial_pick", {
  description: "Accept a curated post into the editorial feed. The post must have been curated first via curate_post. Provide a quality score (0-100) and reason.",
  parameters: SubmitEditorialPickMcpInput.fields,
  success: SubmitEditorialPickMcpOutput,
  failure: McpToolQueryError
})
  .annotate(Tool.Title, "Submit Editorial Pick")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

// ---------------------------------------------------------------------------
// Capability-scoped toolkit variants
// ---------------------------------------------------------------------------

export const ReadOnlyMcpToolkit = Toolkit.make(
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
  ListCurationCandidatesTool,
  GetPostEnrichmentsTool
);

export const CurationWriteMcpToolkit = Toolkit.make(
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
  ListCurationCandidatesTool,
  GetPostEnrichmentsTool,
  CuratePostTool,
  StartEnrichmentTool
);

export const EditorialWriteMcpToolkit = Toolkit.make(
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
  ListCurationCandidatesTool,
  GetPostEnrichmentsTool,
  SubmitEditorialPickTool
);

export const WorkflowWriteMcpToolkit = Toolkit.make(
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
  ListCurationCandidatesTool,
  GetPostEnrichmentsTool,
  CuratePostTool,
  SubmitEditorialPickTool,
  StartEnrichmentTool
);

// Keep legacy export for backward compatibility in tests
export const KnowledgeMcpToolkit = ReadOnlyMcpToolkit;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Service inner types (what `yield*` returns from Context.Tag)
// ---------------------------------------------------------------------------

type KnowledgeQueryServiceI = Context.Tag.Service<typeof KnowledgeQueryService>;
type EditorialServiceI = Context.Tag.Service<typeof EditorialService>;
type CurationServiceI = Context.Tag.Service<typeof CurationService>;
type BlueskyClientI = Context.Tag.Service<typeof BlueskyClient>;
type PostEnrichmentReadServiceI = Context.Tag.Service<typeof PostEnrichmentReadService>;

// ---------------------------------------------------------------------------
// Shared read-only handler implementations
// ---------------------------------------------------------------------------

const makeReadOnlyHandlers = (
  queryService: KnowledgeQueryServiceI,
  editorialService: EditorialServiceI,
  curationService: CurationServiceI,
  bskyClient: BlueskyClientI,
  enrichmentReadService: PostEnrichmentReadServiceI
) => ({
  search_posts: (input: typeof SearchPostsInput.Type) =>
    queryService.searchPosts(input).pipe(
      Effect.map((items) => ({
        items,
        _display: formatPosts(items)
      })),
      Effect.mapError(toQueryError("search_posts"))
    ),
  get_recent_posts: (input: typeof GetRecentPostsMcpInput.Type) =>
    queryService.getRecentPosts(input).pipe(
      Effect.map((items) => ({
        items,
        _display: formatPosts(items)
      })),
      Effect.mapError(toQueryError("get_recent_posts"))
    ),
  get_post_links: (input: typeof GetPostLinksMcpInput.Type) =>
    queryService.getPostLinks(input).pipe(
      Effect.map((items) => ({
        items,
        _display: formatLinks(items)
      })),
      Effect.mapError(toQueryError("get_post_links"))
    ),
  list_experts: (input: typeof ListExpertsInput.Type) =>
    queryService.listExperts(input).pipe(
      Effect.map((items) => ({
        items,
        _display: formatExperts(items)
      })),
      Effect.mapError(toQueryError("list_experts"))
    ),
  list_topics: (input: typeof ListTopicsInput.Type) =>
    queryService.listTopics(input).pipe(
      Effect.map((items) => ({
        view: input.view ?? "facets",
        items,
        _display: formatTopics(items, input.view ?? "facets")
      })),
      Effect.mapError(toQueryError("list_topics"))
    ),
  get_topic: (input: typeof GetTopicInput.Type) =>
    queryService.getTopic(input).pipe(
      Effect.map((item) => ({
        item,
        _display: item !== null ? formatTopic(item) : "Topic not found."
      })),
      Effect.mapError(toQueryError("get_topic"))
    ),
  expand_topics: (input: typeof ExpandTopicsInput.Type) =>
    queryService.expandTopics(input).pipe(
      Effect.map((result) => ({
        ...result,
        _display: formatExpandedTopics(result)
      })),
      Effect.mapError(toQueryError("expand_topics"))
    ),
  explain_post_topics: (input: typeof ExplainPostTopicsInput.Type) =>
    queryService.explainPostTopics(input.postUri).pipe(
      Effect.map((result) => ({
        ...result,
        _display: formatExplainedPostTopics(result)
      })),
      Effect.mapError(toQueryError("explain_post_topics"))
    ),
  list_editorial_picks: (input: typeof ListEditorialPicksInput.Type) =>
    editorialService.listPicks(input).pipe(
      Effect.map((items) => ({
        items,
        _display: formatEditorialPicks(items)
      })),
      Effect.mapError(toQueryError("list_editorial_picks"))
    ),
  get_post_thread: (input: typeof GetPostThreadInput.Type) =>
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
          embedType: extractEmbedKind(fp.post.embed),
          embedContent: buildTypedEmbed(fp.post.embed)
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
  get_thread_document: (input: typeof GetThreadDocumentInput.Type) =>
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
  list_curation_candidates: (input: typeof ListCurationCandidatesInput.Type) =>
    curationService.listCandidates(input).pipe(
      Effect.flatMap((items) =>
        Effect.forEach(items, (item) =>
          enrichmentReadService.getPost(item.uri).pipe(
            Effect.map((e) => ({ ...item, enrichmentReadiness: e.readiness }))
          ),
          { concurrency: "unbounded" }
        )
      ),
      Effect.map((items) => ({
        items,
        _display: formatCurationCandidates(items)
      })),
      Effect.mapError(toQueryError("list_curation_candidates"))
    ),
  get_post_enrichments: (input: typeof GetPostEnrichmentsInput.Type) =>
    enrichmentReadService.getPost(input.postUri).pipe(
      Effect.map((result) => ({
        ...result,
        _display: formatEnrichments(result)
      })),
      Effect.mapError(toQueryError("get_post_enrichments"))
    )
});

// ---------------------------------------------------------------------------
// Write tool handler implementations
// ---------------------------------------------------------------------------

/**
 * OperatorIdentity is a request-scoped service provided at runtime via
 * `HttpLayerRouter.toWebHandler.handler(request, context)`.  The Fiber
 * context will contain it, so `yield* OperatorIdentity` resolves at
 * call time.  We assert `as any` on the return to remove the compile-time
 * `R = OperatorIdentity` requirement — the Toolkit type system expects
 * `R = never` for handler functions.
 */
const makeCuratePostHandler = (curationService: CurationServiceI) => ({
  curate_post: (input: typeof CuratePostInput.Type) =>
    Effect.flatMap(OperatorIdentity, (identity) =>
      curationService.curatePost(input, identity.email ?? identity.subject ?? "mcp-operator")
    ).pipe(
      Effect.map((result) => ({
        ...result,
        _display: formatCuratePostResult(result)
      })),
      Effect.mapError(toQueryError("curate_post"))
    ) as any
});

const makeSubmitPickHandler = (editorialService: EditorialServiceI) => ({
  submit_editorial_pick: (input: typeof SubmitEditorialPickMcpInput.Type) =>
    Effect.gen(function* () {
      // Gate: verify the post was curated before accepting a pick.
      // This prevents skipping straight from Discovered to Accepted.
      const curationRepo = yield* CurationRepo;
      const curation = yield* curationRepo.getByPostUri(input.postUri);
      if (curation === null || curation.status !== "curated") {
        return yield* McpToolQueryError.make({
          tool: "submit_editorial_pick",
          message: `Post must be curated before accepting as a brief. Current status: ${curation?.status ?? "not curated"}`,
          error: new Error("post not curated")
        });
      }

      // Gate: verify enrichment is complete before accepting a pick.
      const enrichmentReadService = yield* PostEnrichmentReadService;
      const enrichment = yield* enrichmentReadService.getPost(input.postUri);
      if (enrichment.readiness !== "complete") {
        return yield* McpToolQueryError.make({
          tool: "submit_editorial_pick",
          message: `Post enrichment is not complete (readiness: ${enrichment.readiness}). Use start_enrichment to trigger enrichment, then poll get_post_enrichments until readiness is "complete".`,
          error: new Error("enrichment not complete")
        });
      }

      const identity = yield* OperatorIdentity;
      const result = yield* editorialService.submitPick(
        input,
        identity.email ?? identity.subject ?? "mcp-operator"
      );
      return {
        ...result,
        _display: formatSubmitPickResult(result)
      };
    }).pipe(
      Effect.mapError((e) =>
        "_tag" in e && (e as any)._tag === "McpToolQueryError"
          ? (e as McpToolQueryError)
          : toQueryError("submit_editorial_pick")(e as any)
      )
    ) as any
});

const makeStartEnrichmentHandler = () => ({
  start_enrichment: (input: typeof StartEnrichmentMcpInput.Type) =>
    Effect.gen(function* () {
      const triggerOption = yield* Effect.serviceOption(EnrichmentTriggerClient);
      if (Option.isNone(triggerOption)) {
        return yield* McpToolQueryError.make({
          tool: "start_enrichment",
          message: "Enrichment trigger is not available in this deployment. Use the admin enrichment endpoint on the ingest worker.",
          error: new Error("EnrichmentTriggerClient not available")
        });
      }
      const trigger = triggerOption.value;

      // Auto-detect enrichment type if not specified
      let enrichmentType = input.enrichmentType;
      if (enrichmentType === undefined) {
        const payloadService = yield* CandidatePayloadService;
        const payload = yield* payloadService.getPayload(input.postUri);
        if (payload === null) {
          return yield* McpToolQueryError.make({
            tool: "start_enrichment",
            message: "Post must be curated before starting enrichment. Call curate_post first.",
            error: new Error("payload not found")
          });
        }
        // Detect from embed type: img/video/media -> vision, everything else -> source-attribution
        enrichmentType = (payload.embedType === "img" || payload.embedType === "video" || payload.embedType === "media")
          ? "vision" as const
          : "source-attribution" as const;
      }

      const result = yield* trigger.start({
        postUri: input.postUri,
        enrichmentType
      }).pipe(
        Effect.mapError((e) =>
          McpToolQueryError.make({
            tool: "start_enrichment",
            message: e.message,
            error: e
          })
        )
      );

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
        "_tag" in (e as any) && (e as any)._tag === "McpToolQueryError"
          ? (e as McpToolQueryError)
          : toQueryError("start_enrichment")(e as any)
      )
    ) as any
});

// ---------------------------------------------------------------------------
// Handler layers — one per toolkit variant
// ---------------------------------------------------------------------------

export const ReadOnlyMcpHandlers = ReadOnlyMcpToolkit.toLayer(
  Effect.gen(function* () {
    const queryService = yield* KnowledgeQueryService;
    const editorialService = yield* EditorialService;
    const curationService = yield* CurationService;
    const bskyClient = yield* BlueskyClient;
    const enrichmentReadService = yield* PostEnrichmentReadService;

    return ReadOnlyMcpToolkit.of(
      makeReadOnlyHandlers(queryService, editorialService, curationService, bskyClient, enrichmentReadService)
    );
  })
);

export const CurationWriteMcpHandlers = CurationWriteMcpToolkit.toLayer(
  Effect.gen(function* () {
    const queryService = yield* KnowledgeQueryService;
    const editorialService = yield* EditorialService;
    const curationService = yield* CurationService;
    const bskyClient = yield* BlueskyClient;
    const enrichmentReadService = yield* PostEnrichmentReadService;

    return CurationWriteMcpToolkit.of({
      ...makeReadOnlyHandlers(queryService, editorialService, curationService, bskyClient, enrichmentReadService),
      ...makeCuratePostHandler(curationService),
      ...makeStartEnrichmentHandler()
    });
  })
);

export const EditorialWriteMcpHandlers = EditorialWriteMcpToolkit.toLayer(
  Effect.gen(function* () {
    const queryService = yield* KnowledgeQueryService;
    const editorialService = yield* EditorialService;
    const curationService = yield* CurationService;
    const bskyClient = yield* BlueskyClient;
    const enrichmentReadService = yield* PostEnrichmentReadService;

    return EditorialWriteMcpToolkit.of({
      ...makeReadOnlyHandlers(queryService, editorialService, curationService, bskyClient, enrichmentReadService),
      ...makeSubmitPickHandler(editorialService)
    });
  })
);

export const WorkflowWriteMcpHandlers = WorkflowWriteMcpToolkit.toLayer(
  Effect.gen(function* () {
    const queryService = yield* KnowledgeQueryService;
    const editorialService = yield* EditorialService;
    const curationService = yield* CurationService;
    const bskyClient = yield* BlueskyClient;
    const enrichmentReadService = yield* PostEnrichmentReadService;

    return WorkflowWriteMcpToolkit.of({
      ...makeReadOnlyHandlers(queryService, editorialService, curationService, bskyClient, enrichmentReadService),
      ...makeCuratePostHandler(curationService),
      ...makeSubmitPickHandler(editorialService),
      ...makeStartEnrichmentHandler()
    });
  })
);

// Keep legacy export for backward compatibility
export const KnowledgeMcpHandlers = ReadOnlyMcpHandlers;

// ---------------------------------------------------------------------------
// Toolkit selection by profile
// ---------------------------------------------------------------------------

export const toolkitForProfile = (profile: McpCapabilityProfile) => {
  switch (profile) {
    case "read-only":
      return { toolkit: ReadOnlyMcpToolkit, handlers: ReadOnlyMcpHandlers };
    case "curation-write":
      return { toolkit: CurationWriteMcpToolkit, handlers: CurationWriteMcpHandlers };
    case "editorial-write":
      return { toolkit: EditorialWriteMcpToolkit, handlers: EditorialWriteMcpHandlers };
    case "workflow-write":
      return { toolkit: WorkflowWriteMcpToolkit, handlers: WorkflowWriteMcpHandlers };
  }
};
