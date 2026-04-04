import { SqlError } from "effect/unstable/sql/SqlError";
import type { DbError } from "../domain/errors";
import { Tool, Toolkit } from "effect/unstable/ai";
import { Duration, Effect, Layer, Option, Result, Schedule, Schema } from "effect";
import { ImportPostsInput } from "../domain/api";
import {
  decodeJsonStringEitherWith,
  encodeJsonStringWith,
  formatSchemaParseError,
  stringifyUnknown,
  stripUndefined
} from "../platform/Json";
import {
  ExplainPostTopicsInput,
  ExpandTopicsInput,
  GetPostLinksInput,
  GetPostThreadInput,
  GetRecentPostsInput,
  GetTopicInput,
  GetThreadDocumentInput,
  ListTopicsInput,
  ListExpertsInput,
  McpToolQueryError,
  SearchPostsInput
} from "../domain/bi";
import { ListEditorialPicksInput, SubmitEditorialPickMcpInput } from "../domain/editorial";
import {
  BULK_CURATE_MAX_DECISIONS,
  BulkCurateInput,
  CuratePostInput,
  CurationCandidateCursor,
  ListCurationCandidatesInput
} from "../domain/curation";
import {
  BULK_START_ENRICHMENT_MAX_POSTS,
  BulkStartEnrichmentInput,
  GapEnrichmentType,
  GetPostEnrichmentsInput,
  ListEnrichmentGapsInput,
  ListEnrichmentIssuesInput
} from "../domain/enrichment";
import { GetPipelineStatusInput } from "../domain/pipeline";
import type { PostUri } from "../domain/types";
import {
  BulkCurateMcpOutput,
  BulkStartEnrichmentMcpOutput,
  KnowledgePostsMcpOutput,
  KnowledgeLinksMcpOutput,
  EnrichmentGapsMcpOutput,
  EnrichmentIssuesMcpOutput,
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
  StartEnrichmentMcpOutput,
  PipelineStatusMcpOutput,
  ImportPostsMcpOutput
} from "./OutputSchemas.ts";
import {
  formatBulkCurateResult,
  formatBulkStartEnrichmentResult,
  formatCurationCandidateCounts,
  formatCurationCandidateExportPage,
  formatCurationCandidatePage,
  formatEnrichmentGaps,
  formatEnrichmentIssues,
  formatPosts,
  formatLinks,
  formatExperts,
  formatTopics,
  formatTopic,
  formatExpandedTopics,
  formatExplainedPostTopics,
  formatEditorialPicks,
  formatCuratePostResult,
  formatSubmitPickResult,
  formatImportPosts,
  formatEnrichments,
  formatStartEnrichment,
  formatPipelineStatus
} from "./Fmt.ts";
import { EditorialService } from "../services/EditorialService";
import { CurationService } from "../services/CurationService";
import { CurationRepo } from "../services/CurationRepo";
import { KnowledgeQueryService } from "../services/KnowledgeQueryService";
import { BlueskyClient } from "../bluesky/BlueskyClient";
import { PostEnrichmentReadService } from "../services/PostEnrichmentReadService";
import {
  EnrichmentTriggerClient
} from "../services/EnrichmentTriggerClient";
import { PipelineStatusService } from "../services/PipelineStatusService";
import { PostImportService } from "../services/PostImportService";
import { CandidatePayloadService } from "../services/CandidatePayloadService";
import { extractEmbedKind, buildTypedEmbed } from "../bluesky/EmbedExtract";
import { flattenThread } from "../bluesky/ThreadFlatten.ts";
import { printThread } from "../bluesky/ThreadPrinter.ts";
import { OperatorIdentity } from "../http/Identity";
import type { McpCapabilityProfile } from "./RequestAuth";
import {
  hasVisualEmbedPayload,
  inferPrimaryEnrichmentType
} from "../enrichment/EmbedSignals";

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
  enrichmentType: Schema.optionalKey(GapEnrichmentType.annotate({
    description: "Enrichment type: 'vision' for charts/screenshots or 'source-attribution' for links. If omitted, auto-detected from the stored embed."
  }))
});
const ImportPostsMcpInput = ImportPostsInput;
const BulkStartEnrichmentMcpInput = BulkStartEnrichmentInput;
const GetPipelineStatusMcpInput = GetPipelineStatusInput;

const ListCurationCandidatesMcpInput = Schema.Struct({
  status: ListCurationCandidatesInput.fields.status,
  minScore: ListCurationCandidatesInput.fields.minScore,
  topic: ListCurationCandidatesInput.fields.topic,
  platform: ListCurationCandidatesInput.fields.platform,
  since: ListCurationCandidatesInput.fields.since,
  limit: ListCurationCandidatesInput.fields.limit,
  cursor: Schema.optionalKey(Schema.String.annotate({
    description: "Opaque pagination cursor returned by a previous list_curation_candidates call."
  })),
  export: Schema.optionalKey(Schema.Boolean.annotate({
    description: "Return compact export rows optimized for bulk classification."
  })),
  count: Schema.optionalKey(Schema.Boolean.annotate({
    description: "Return only aggregate candidate counts by platform."
  }))
});

const decodeCurationCandidateCursor = decodeJsonStringEitherWith(CurationCandidateCursor);
const encodeCurationCandidateCursor = encodeJsonStringWith(CurationCandidateCursor);
const ENRICHMENT_TRIGGER_RETRY_SCHEDULE = Schedule.exponential(Duration.millis(250)).pipe(
  Schedule.jittered,
  Schedule.both(Schedule.recurs(2))
);

const toQueryError = (tool: string) => (error: unknown) =>
  new McpToolQueryError({
    tool,
    message: stringifyUnknown(error),
    error
  });

const isMcpToolQueryError = (error: unknown): error is McpToolQueryError =>
  typeof error === "object" &&
  error !== null &&
  "_tag" in error &&
  error._tag === "McpToolQueryError";

const passThroughMcpToolError = (tool: string) => (error: unknown) =>
  isMcpToolQueryError(error)
    ? error
    : toQueryError(tool)(error);

export const SearchPostsTool = Tool.make("search_posts", {
  description: "Search expert posts using SQLite full-text search. Matches post text, expert handles, and stored topic-match terms. Full handle strings like solar-desk.bsky.social are treated as exact handle phrases. Supports quoted phrases, OR / NOT boolean logic, and prefix search with *. Supports topic and time range filters. Use this for keyword, handle, and topic-term discovery; use get_recent_posts for chronological browsing.",
  parameters: SearchPostsInput,
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
  parameters: GetRecentPostsMcpInput,
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
  parameters: GetPostLinksMcpInput,
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
  parameters: ListExpertsInput,
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
  parameters: ListTopicsInput,
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
  parameters: GetTopicInput,
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
  parameters: ExpandTopicsInput,
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
  parameters: ExplainPostTopicsInput,
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
  parameters: ListEditorialPicksInput,
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
  parameters: GetPostThreadInput,
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
  parameters: GetThreadDocumentInput,
  success: ThreadDocumentMcpOutput,
  failure: McpToolQueryError
})
  .annotate(Tool.Title, "Get Thread Document")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

export const ListCurationCandidatesTool = Tool.make("list_curation_candidates", {
  description: "List posts flagged by curation predicates for review. Supports platform filtering, aggregate count mode, compact export mode for sub-agent classification, and opaque pagination cursors.",
  parameters: ListCurationCandidatesMcpInput,
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
  parameters: GetPostEnrichmentsInput,
  success: PostEnrichmentsMcpOutput,
  failure: McpToolQueryError
})
  .annotate(Tool.Title, "Get Post Enrichments")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const ListEnrichmentGapsTool = Tool.make("list_enrichment_gaps", {
  description: "List curated posts that are currently safe to queue for enrichment. Supports platform, enrichment-type, and since filtering. Returns separate vision and source-attribution buckets, plus total counts per bucket.",
  parameters: ListEnrichmentGapsInput,
  success: EnrichmentGapsMcpOutput,
  failure: McpToolQueryError
})
  .annotate(Tool.Title, "List Enrichment Gaps")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const ListEnrichmentIssuesTool = Tool.make("list_enrichment_issues", {
  description: "List failed or needs-review enrichment runs. Returns the post URI, enrichment type, run ID, latest progress timestamp, and any stored error envelope.",
  parameters: ListEnrichmentIssuesInput,
  success: EnrichmentIssuesMcpOutput,
  failure: McpToolQueryError
})
  .annotate(Tool.Title, "List Enrichment Issues")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const GetPipelineStatusTool = Tool.make("get_pipeline_status", {
  description: "Get an operator snapshot of the ingestion, curation, and enrichment pipeline. Returns aggregate counts for active experts, active posts, curation status, enrichment storage, enrichment runs, and the latest finished head sweep.",
  parameters: GetPipelineStatusMcpInput,
  success: PipelineStatusMcpOutput,
  failure: McpToolQueryError
})
  .annotate(Tool.Title, "Get Pipeline Status")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const StartEnrichmentTool = Tool.make("start_enrichment", {
  description: "Trigger enrichment for a curated post. Queues vision analysis (for charts/screenshots) or source attribution (for links). Use get_post_enrichments to poll readiness after triggering. The post must have been curated first via curate_post.",
  parameters: StartEnrichmentMcpInput,
  success: StartEnrichmentMcpOutput,
  failure: McpToolQueryError
})
  .annotate(Tool.Title, "Start Enrichment")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

export const BulkStartEnrichmentTool = Tool.make("bulk_start_enrichment", {
  description: "Queue enrichment for many curated posts in one call. Accepts explicit posts or the direct output of list_enrichment_gaps. Retries transient 503 failures and treats already-queued conflicts as skipped.",
  parameters: BulkStartEnrichmentMcpInput,
  success: BulkStartEnrichmentMcpOutput,
  failure: McpToolQueryError
})
  .annotate(Tool.Title, "Bulk Start Enrichment")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

export const CuratePostTool = Tool.make("curate_post", {
  description: "Curate or reject a post. Curating captures embed data for enrichment. For Bluesky posts, fetches live data. For Twitter posts, uses stored import data. When enrichment launching is available, curating also queues the appropriate enrichment automatically. Rejecting dismisses the post. Idempotent.",
  parameters: CuratePostInput,
  success: CuratePostMcpOutput,
  failure: McpToolQueryError
})
  .annotate(Tool.Title, "Curate Post")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

export const BulkCurateTool = Tool.make("bulk_curate", {
  description: "Apply many curate or reject decisions in one call. Reuses curate_post behavior for each post, including payload capture and automatic enrichment queueing when available. Returns counts plus per-post errors. Large Bluesky-heavy batches may take longer because uncached posts require live fetches.",
  parameters: BulkCurateInput,
  success: BulkCurateMcpOutput,
  failure: McpToolQueryError
})
  .annotate(Tool.Title, "Bulk Curate")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

export const SubmitEditorialPickTool = Tool.make("submit_editorial_pick", {
  description: "Accept a curated post into the editorial feed. The post must have been curated first via curate_post. Provide a quality score (0-100) and reason.",
  parameters: SubmitEditorialPickMcpInput,
  success: SubmitEditorialPickMcpOutput,
  failure: McpToolQueryError
})
  .annotate(Tool.Title, "Submit Editorial Pick")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const ImportPostsTool = Tool.make("import_posts", {
  description: "Import normalized experts and posts through the same pipeline as POST /admin/import/posts. Uses the shared ImportPostsInput schema, stores experts and posts, captures embed payloads when present, and flags imported posts for curation review. Supports operatorOverride to keep zero-topic posts when a human has already judged relevance.",
  parameters: ImportPostsMcpInput,
  success: ImportPostsMcpOutput,
  failure: McpToolQueryError
})
  .annotate(Tool.Title, "Import Posts")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

// ---------------------------------------------------------------------------
// Capability-scoped toolkit variants
// ---------------------------------------------------------------------------

type CapabilityToolkitOptions = {
  readonly opsRead?: boolean;
  readonly opsRefresh?: boolean;
  readonly curationWrite?: boolean;
  readonly editorialWrite?: boolean;
};

const ReadOnlyTools = [
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
  ListEnrichmentGapsTool,
  ListEnrichmentIssuesTool
 ] as const;

const OpsReadTools = [GetPipelineStatusTool] as const;
const OpsRefreshTools = [ImportPostsTool] as const;
const CurationWriteTools = [
  CuratePostTool,
  BulkCurateTool,
  StartEnrichmentTool,
  BulkStartEnrichmentTool
] as const;
const EditorialWriteTools = [SubmitEditorialPickTool] as const;

const makeCapabilityToolkit = (options: CapabilityToolkitOptions) =>
  Toolkit.make(
    ...ReadOnlyTools,
    ...(options.opsRead ? OpsReadTools : ([] as const)),
    ...(options.opsRefresh ? OpsRefreshTools : ([] as const)),
    ...(options.curationWrite ? CurationWriteTools : ([] as const)),
    ...(options.editorialWrite ? EditorialWriteTools : ([] as const))
  );

export const ReadOnlyMcpToolkit = makeCapabilityToolkit({});
export const OpsReadMcpToolkit = makeCapabilityToolkit({ opsRead: true });
export const OpsRefreshMcpToolkit = makeCapabilityToolkit({ opsRefresh: true });
export const OpsReadRefreshMcpToolkit = makeCapabilityToolkit({
  opsRead: true,
  opsRefresh: true
});
export const CurationWriteMcpToolkit = makeCapabilityToolkit({ curationWrite: true });
export const OpsCurationWriteMcpToolkit = makeCapabilityToolkit({
  opsRead: true,
  curationWrite: true
});
export const CurationWriteRefreshMcpToolkit = makeCapabilityToolkit({
  opsRefresh: true,
  curationWrite: true
});
export const OpsCurationWriteRefreshMcpToolkit = makeCapabilityToolkit({
  opsRead: true,
  opsRefresh: true,
  curationWrite: true
});
export const EditorialWriteMcpToolkit = makeCapabilityToolkit({ editorialWrite: true });
export const OpsEditorialWriteMcpToolkit = makeCapabilityToolkit({
  opsRead: true,
  editorialWrite: true
});
export const EditorialWriteRefreshMcpToolkit = makeCapabilityToolkit({
  opsRefresh: true,
  editorialWrite: true
});
export const OpsEditorialWriteRefreshMcpToolkit = makeCapabilityToolkit({
  opsRead: true,
  opsRefresh: true,
  editorialWrite: true
});
export const WorkflowWriteMcpToolkit = makeCapabilityToolkit({
  curationWrite: true,
  editorialWrite: true
});
export const OpsWorkflowWriteMcpToolkit = makeCapabilityToolkit({
  opsRead: true,
  curationWrite: true,
  editorialWrite: true
});
export const WorkflowWriteRefreshMcpToolkit = makeCapabilityToolkit({
  opsRefresh: true,
  curationWrite: true,
  editorialWrite: true
});
export const OpsWorkflowWriteRefreshMcpToolkit = makeCapabilityToolkit({
  opsRead: true,
  opsRefresh: true,
  curationWrite: true,
  editorialWrite: true
});

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
// Service inner types (what `yield*` returns from ServiceMap.Service)
// ---------------------------------------------------------------------------

type KnowledgeQueryServiceI = (typeof KnowledgeQueryService)["Service"];
type EditorialServiceI = (typeof EditorialService)["Service"];
type CurationServiceI = (typeof CurationService)["Service"];
type BlueskyClientI = (typeof BlueskyClient)["Service"];
type PostEnrichmentReadServiceI = (typeof PostEnrichmentReadService)["Service"];
type PipelineStatusServiceI = (typeof PipelineStatusService)["Service"];
type PostImportServiceI = (typeof PostImportService)["Service"];
type EnrichmentTriggerClientI = (typeof EnrichmentTriggerClient)["Service"];

const invalidMcpInputError = (
  tool: string,
  message: string,
  error: unknown
) =>
  new McpToolQueryError({
    tool,
    message,
    error
  });

const decodeListCurationCursor = (
  tool: string,
  cursor: string | undefined
) =>
  Effect.gen(function* () {
    if (cursor === undefined) {
      return undefined;
    }

    const result = decodeCurationCandidateCursor(cursor);
    if (Result.isSuccess(result)) {
      return result.success;
    }

    return yield* invalidMcpInputError(
      tool,
      `Invalid curation cursor: ${formatSchemaParseError(result.failure)}`,
      result.failure
    );
  });

const validateBulkCurateInput = (input: typeof BulkCurateInput.Type) =>
  Effect.gen(function* () {
    if (input.decisions.length === 0) {
      return yield* invalidMcpInputError(
        "bulk_curate",
        "Provide at least one curation decision.",
        new Error("empty decisions")
      );
    }

    if (input.decisions.length > BULK_CURATE_MAX_DECISIONS) {
      return yield* invalidMcpInputError(
        "bulk_curate",
        `Too many curation decisions. Maximum: ${BULK_CURATE_MAX_DECISIONS}.`,
        new Error("too many decisions")
      );
    }

    const seen = new Set<string>();
    for (const decision of input.decisions) {
      if (seen.has(decision.postUri)) {
        return yield* invalidMcpInputError(
          "bulk_curate",
          `Duplicate postUri in batch: ${decision.postUri}`,
          new Error("duplicate postUri")
        );
      }

      seen.add(decision.postUri);
    }
  });

const validateBulkStartEnrichmentInput = (
  input: typeof BulkStartEnrichmentMcpInput.Type
) =>
  Effect.gen(function* () {
    const normalizedPosts = [
      ...(input.posts ?? []),
      ...(input.gaps?.vision.postUris.map((postUri) => ({
        postUri,
        enrichmentType: "vision" as const
      })) ?? []),
      ...(input.gaps?.sourceAttribution.postUris.map((postUri) => ({
        postUri,
        enrichmentType: "source-attribution" as const
      })) ?? [])
    ];

    if (normalizedPosts.length === 0) {
      return yield* invalidMcpInputError(
        "bulk_start_enrichment",
        "Provide at least one post or a non-empty gaps payload.",
        new Error("empty posts")
      );
    }

    if (normalizedPosts.length > BULK_START_ENRICHMENT_MAX_POSTS) {
      return yield* invalidMcpInputError(
        "bulk_start_enrichment",
        `Too many enrichment requests. Maximum: ${BULK_START_ENRICHMENT_MAX_POSTS}.`,
        new Error("too many posts")
      );
    }

    const seen = new Set<string>();
    for (const post of normalizedPosts) {
      if (seen.has(post.postUri)) {
        return yield* invalidMcpInputError(
          "bulk_start_enrichment",
          `Duplicate postUri in batch: ${post.postUri}`,
          new Error("duplicate postUri")
        );
      }

      seen.add(post.postUri);
    }

    return normalizedPosts;
  });

const startEnrichmentViaTrigger = (
  trigger: EnrichmentTriggerClientI,
  tool: string,
  input: {
    readonly postUri: PostUri;
    readonly enrichmentType: GapEnrichmentType;
  }
) =>
  trigger.start(input).pipe(
    Effect.retry({
      schedule: ENRICHMENT_TRIGGER_RETRY_SCHEDULE,
      while: (error) => error.status === 503
    }),
    Effect.mapError((error) =>
      new McpToolQueryError({
        tool,
        message: error.message,
        error
      })
    )
  );

const makeGetPipelineStatusHandler = (
  pipelineStatusService: PipelineStatusServiceI
) => ({
  get_pipeline_status: (input: typeof GetPipelineStatusMcpInput.Type) =>
    pipelineStatusService.getStatus(input).pipe(
      Effect.map((status) => ({
        ...status,
        _display: formatPipelineStatus(status, input.detail ?? "summary")
      })),
      Effect.mapError(toQueryError("get_pipeline_status"))
    )
});

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
          return Effect.fail(new McpToolQueryError({
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
      Effect.mapError(passThroughMcpToolError("get_post_thread"))
    ),
  get_thread_document: (input: typeof GetThreadDocumentInput.Type) =>
    bskyClient.getPostThread(input.postUri, {
      depth: input.depth ?? 3,
      parentHeight: input.parentHeight ?? 3
    }).pipe(
      Effect.flatMap((response) => {
        const flat = flattenThread(response.thread);
        if (!flat) {
          return Effect.fail(new McpToolQueryError({
            tool: "get_thread_document",
            message: "Post not found or thread unavailable",
            error: new Error("thread decode failed")
          }));
        }

        const doc = printThread(flat, stripUndefined({
          maxDepth: input.maxDepth,
          minLikes: input.minLikes,
          topN: input.topN
        }));

        return Effect.succeed(doc);
      }),
      Effect.mapError(passThroughMcpToolError("get_thread_document"))
    ),
  list_curation_candidates: (input: typeof ListCurationCandidatesMcpInput.Type) =>
    Effect.gen(function* () {
      if (input.export === true && input.count === true) {
        return yield* invalidMcpInputError(
          "list_curation_candidates",
          "Choose either export mode or count mode, not both.",
          new Error("conflicting list modes")
        );
      }

      const normalizedBaseInput = stripUndefined({
        status: input.status,
        minScore: input.minScore,
        topic: input.topic,
        platform: input.platform,
        since: input.since,
        limit: input.limit
      });

      if (input.count === true) {
        const counts = yield* curationService.countCandidates(normalizedBaseInput);
        return {
          mode: "count" as const,
          total: counts.total,
          nextCursor: null,
          byPlatform: counts.byPlatform,
          items: [],
          exportItems: [],
          _display: formatCurationCandidateCounts(counts)
        };
      }

      const cursor = yield* decodeListCurationCursor(
        "list_curation_candidates",
        input.cursor
      );
      const normalizedInput = stripUndefined({
        ...normalizedBaseInput,
        cursor
      });

      if (input.export === true) {
        const page = yield* curationService.exportCandidates(normalizedInput);
        const nextCursor = page.nextCursor === null
          ? null
          : encodeCurationCandidateCursor(page.nextCursor);

        return {
          mode: "export" as const,
          total: page.total,
          nextCursor,
          byPlatform: null,
          items: [],
          exportItems: page.items,
          _display: formatCurationCandidateExportPage({
            items: page.items,
            total: page.total,
            nextCursor
          })
        };
      }

      const page = yield* curationService.listCandidates(normalizedInput);
      const items = yield* Effect.forEach(
        page.items,
        (item) =>
          enrichmentReadService.getPost(item.uri).pipe(
            Effect.map((e) => ({ ...item, enrichmentReadiness: e.readiness }))
          ),
        { concurrency: "unbounded" }
      );
      const nextCursor = page.nextCursor === null
        ? null
        : encodeCurationCandidateCursor(page.nextCursor);

      return {
        mode: "full" as const,
        total: page.total,
        nextCursor,
        byPlatform: null,
        items,
        exportItems: [],
        _display: formatCurationCandidatePage({
          items,
          total: page.total,
          nextCursor
        })
      };
    }).pipe(
      Effect.mapError(passThroughMcpToolError("list_curation_candidates"))
    ),
  get_post_enrichments: (input: typeof GetPostEnrichmentsInput.Type) =>
    enrichmentReadService.getPost(input.postUri).pipe(
      Effect.map((result) => ({
        ...result,
        _display: formatEnrichments(result)
      })),
      Effect.mapError(toQueryError("get_post_enrichments"))
    ),
  list_enrichment_gaps: (input: typeof ListEnrichmentGapsInput.Type) =>
    enrichmentReadService.listGaps(input).pipe(
      Effect.map((result) => ({
        ...result,
        _display: formatEnrichmentGaps(result)
      })),
      Effect.mapError(toQueryError("list_enrichment_gaps"))
    ),
  list_enrichment_issues: (input: typeof ListEnrichmentIssuesInput.Type) =>
    enrichmentReadService.listIssues(input).pipe(
      Effect.map((result) => ({
        ...result,
        _display: formatEnrichmentIssues(result)
      })),
      Effect.mapError(toQueryError("list_enrichment_issues"))
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
    OperatorIdentity.use( (identity) =>
      curationService.curatePost(input, identity.email ?? identity.subject ?? "mcp-operator")
    ).pipe(
      Effect.map((result) => ({
        ...result,
        _display: formatCuratePostResult(result)
      })),
      Effect.mapError(toQueryError("curate_post"))
    ) as any
});

const makeBulkCurateHandler = (curationService: CurationServiceI) => ({
  bulk_curate: (input: typeof BulkCurateInput.Type) =>
    Effect.gen(function* () {
      yield* validateBulkCurateInput(input);
      const identity = yield* OperatorIdentity;
      const result = yield* curationService.bulkCurate(
        input,
        identity.email ?? identity.subject ?? "mcp-operator"
      );

      return {
        ...result,
        _display: formatBulkCurateResult(result)
      };
    }).pipe(
      Effect.mapError(passThroughMcpToolError("bulk_curate"))
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
        return yield* new McpToolQueryError({
          tool: "submit_editorial_pick",
          message: `Post must be curated before accepting as a brief. Current status: ${curation?.status ?? "not curated"}`,
          error: new Error("post not curated")
        });
      }

      // Gate: verify enrichment is complete before accepting a pick.
      // Plain-text posts (no payload) have nothing to enrich — allow them through.
      const payloadService = yield* CandidatePayloadService;
      const payload = yield* payloadService.getPayload(input.postUri);
      const storedEmbedType = yield* curationRepo.getPostEmbedType(input.postUri);
      const hasEnrichableContent =
        storedEmbedType !== null || payload?.embedPayload !== null;

      if (hasEnrichableContent && payload?.embedPayload == null) {
        return yield* new McpToolQueryError({
          tool: "submit_editorial_pick",
          message: "Post is missing stored media details. Re-import or re-curate it before accepting as a brief.",
          error: new Error("payload missing for embedded post")
        });
      }

      if (hasEnrichableContent) {
        const enrichmentReadService = yield* PostEnrichmentReadService;
        const enrichment = yield* enrichmentReadService.getPost(input.postUri);
        if (enrichment.readiness !== "complete") {
          return yield* new McpToolQueryError({
            tool: "submit_editorial_pick",
            message: `Post enrichment is not complete (readiness: ${enrichment.readiness}). Use start_enrichment to trigger enrichment, then poll get_post_enrichments until readiness is "complete".`,
            error: new Error("enrichment not complete")
          });
        }
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
      Effect.mapError(passThroughMcpToolError("submit_editorial_pick"))
    ) as any
});

const makeImportPostsHandler = (postImportService: PostImportServiceI) => ({
  import_posts: (input: typeof ImportPostsMcpInput.Type) =>
    Effect.gen(function* () {
      const identity = yield* OperatorIdentity;
      const result = yield* postImportService.importPosts(identity, input);

      return {
        ...result,
        _display: formatImportPosts(result)
      };
    }).pipe(
      Effect.mapError(passThroughMcpToolError("import_posts"))
    ) as any
});

const makeStartEnrichmentHandler = () => ({
  start_enrichment: (input: typeof StartEnrichmentMcpInput.Type) =>
    Effect.gen(function* () {
      const triggerOption = yield* Effect.serviceOption(EnrichmentTriggerClient);
      if (Option.isNone(triggerOption)) {
        return yield* new McpToolQueryError({
          tool: "start_enrichment",
          message: "Enrichment trigger is not available in this deployment. Use the admin enrichment endpoint on the ingest worker.",
          error: new Error("EnrichmentTriggerClient not available")
        });
      }
      const trigger = triggerOption.value;

      // Auto-detect enrichment type if not specified
      const payloadService = yield* CandidatePayloadService;
      const payload = yield* payloadService.getPayload(input.postUri);
      if (payload === null) {
        return yield* new McpToolQueryError({
          tool: "start_enrichment",
          message: "Post must be curated before starting enrichment. Call curate_post first.",
          error: new Error("payload not found")
        });
      }
      if (payload.captureStage !== "picked") {
        return yield* new McpToolQueryError({
          tool: "start_enrichment",
          message: "Post must be curated before starting enrichment. Call curate_post first.",
          error: new Error("payload not picked")
        });
      }

      let enrichmentType = input.enrichmentType;
      if (enrichmentType === undefined) {
        enrichmentType = inferPrimaryEnrichmentType(payload.embedPayload);
      }

      const result = yield* startEnrichmentViaTrigger(trigger, "start_enrichment", {
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
      Effect.mapError(passThroughMcpToolError("start_enrichment"))
    ) as any
});

const makeBulkStartEnrichmentHandler = () => ({
  bulk_start_enrichment: (input: typeof BulkStartEnrichmentMcpInput.Type) =>
    Effect.gen(function* () {
      const triggerOption = yield* Effect.serviceOption(EnrichmentTriggerClient);
      if (Option.isNone(triggerOption)) {
        return yield* new McpToolQueryError({
          tool: "bulk_start_enrichment",
          message: "Enrichment trigger is not available in this deployment. Use the admin enrichment endpoint on the ingest worker.",
          error: new Error("EnrichmentTriggerClient not available")
        });
      }

      const trigger = triggerOption.value;
      const payloadService = yield* CandidatePayloadService;
      const posts = yield* validateBulkStartEnrichmentInput(input);
      const outcomes = yield* Effect.forEach(
        posts,
        ({ postUri, enrichmentType }) =>
          Effect.gen(function* () {
            const payload = yield* payloadService.getPayload(postUri);
            if (payload === null || payload.captureStage !== "picked") {
              return {
                postUri,
                status: "failed" as const,
                error: "Post must be curated before starting enrichment. Call curate_post first."
              };
            }

            const resolvedEnrichmentType =
              enrichmentType ?? inferPrimaryEnrichmentType(payload.embedPayload);

            return yield* trigger.start({
              postUri,
              enrichmentType: resolvedEnrichmentType
            }).pipe(
              Effect.retry({
                schedule: ENRICHMENT_TRIGGER_RETRY_SCHEDULE,
                while: (error) => error.status === 503
              }),
              Effect.match({
                onSuccess: () => ({
                  postUri,
                  status: "queued" as const,
                  error: null
                }),
                onFailure: (error) => ({
                  postUri,
                  status: error.status === 409 ? "skipped" as const : "failed" as const,
                  error: error.status === 409 ? null : error.message
                })
              })
            );
          }),
        { concurrency: 10 }
      );

      const result = {
        queued: outcomes.filter((item) => item.status === "queued").length,
        skipped: outcomes.filter((item) => item.status === "skipped").length,
        failed: outcomes.filter((item) => item.status === "failed").length,
        errors: outcomes.flatMap((item) =>
          item.error === null ? [] : [{ postUri: item.postUri, error: item.error }]
        )
      };

      return {
        ...result,
        _display: formatBulkStartEnrichmentResult(result)
      };
    }).pipe(
      Effect.mapError(passThroughMcpToolError("bulk_start_enrichment"))
    ) as any
});

// ---------------------------------------------------------------------------
// Handler layers — one per toolkit variant
// ---------------------------------------------------------------------------

const makeWriteHandlers = (
  curationService: CurationServiceI,
  editorialService: EditorialServiceI,
  options: CapabilityToolkitOptions
) => ({
  ...(options.curationWrite
    ? {
        ...makeCuratePostHandler(curationService),
        ...makeBulkCurateHandler(curationService),
        ...makeStartEnrichmentHandler(),
        ...makeBulkStartEnrichmentHandler()
      }
    : {}),
  ...(options.editorialWrite ? makeSubmitPickHandler(editorialService) : {})
});

const makeCapabilityHandlers = <
  TToolkit extends ReturnType<typeof makeCapabilityToolkit>
>(
  toolkit: TToolkit,
  options: CapabilityToolkitOptions
) =>
  toolkit.toLayer(
    Effect.gen(function* () {
      const queryService = yield* KnowledgeQueryService;
      const editorialService = yield* EditorialService;
      const curationService = yield* CurationService;
      const bskyClient = yield* BlueskyClient;
      const enrichmentReadService = yield* PostEnrichmentReadService;
      const pipelineStatusService = yield* PipelineStatusService;
      const postImportService = yield* PostImportService;

      return toolkit.of({
        ...makeReadOnlyHandlers(
          queryService,
          editorialService,
          curationService,
          bskyClient,
          enrichmentReadService
        ),
        ...(options.opsRead ? makeGetPipelineStatusHandler(pipelineStatusService) : {}),
        ...(options.opsRefresh ? makeImportPostsHandler(postImportService) : {}),
        ...makeWriteHandlers(curationService, editorialService, options)
      });
    })
  );

export const ReadOnlyMcpHandlers = makeCapabilityHandlers(ReadOnlyMcpToolkit, {});
export const OpsReadMcpHandlers = makeCapabilityHandlers(OpsReadMcpToolkit, {
  opsRead: true
});
export const OpsRefreshMcpHandlers = makeCapabilityHandlers(OpsRefreshMcpToolkit, {
  opsRefresh: true
});
export const OpsReadRefreshMcpHandlers = makeCapabilityHandlers(OpsReadRefreshMcpToolkit, {
  opsRead: true,
  opsRefresh: true
});
export const CurationWriteMcpHandlers = makeCapabilityHandlers(CurationWriteMcpToolkit, {
  curationWrite: true
});
export const OpsCurationWriteMcpHandlers = makeCapabilityHandlers(
  OpsCurationWriteMcpToolkit,
  {
    opsRead: true,
    curationWrite: true
  }
);
export const CurationWriteRefreshMcpHandlers = makeCapabilityHandlers(
  CurationWriteRefreshMcpToolkit,
  {
    opsRefresh: true,
    curationWrite: true
  }
);
export const OpsCurationWriteRefreshMcpHandlers = makeCapabilityHandlers(
  OpsCurationWriteRefreshMcpToolkit,
  {
    opsRead: true,
    opsRefresh: true,
    curationWrite: true
  }
);
export const EditorialWriteMcpHandlers = makeCapabilityHandlers(EditorialWriteMcpToolkit, {
  editorialWrite: true
});
export const OpsEditorialWriteMcpHandlers = makeCapabilityHandlers(
  OpsEditorialWriteMcpToolkit,
  {
    opsRead: true,
    editorialWrite: true
  }
);
export const EditorialWriteRefreshMcpHandlers = makeCapabilityHandlers(
  EditorialWriteRefreshMcpToolkit,
  {
    opsRefresh: true,
    editorialWrite: true
  }
);
export const OpsEditorialWriteRefreshMcpHandlers = makeCapabilityHandlers(
  OpsEditorialWriteRefreshMcpToolkit,
  {
    opsRead: true,
    opsRefresh: true,
    editorialWrite: true
  }
);
export const WorkflowWriteMcpHandlers = makeCapabilityHandlers(WorkflowWriteMcpToolkit, {
  curationWrite: true,
  editorialWrite: true
});
export const OpsWorkflowWriteMcpHandlers = makeCapabilityHandlers(
  OpsWorkflowWriteMcpToolkit,
  {
    opsRead: true,
    curationWrite: true,
    editorialWrite: true
  }
);
export const WorkflowWriteRefreshMcpHandlers = makeCapabilityHandlers(
  WorkflowWriteRefreshMcpToolkit,
  {
    opsRefresh: true,
    curationWrite: true,
    editorialWrite: true
  }
);
export const OpsWorkflowWriteRefreshMcpHandlers = makeCapabilityHandlers(
  OpsWorkflowWriteRefreshMcpToolkit,
  {
    opsRead: true,
    opsRefresh: true,
    curationWrite: true,
    editorialWrite: true
  }
);

// Keep legacy export for backward compatibility
export const KnowledgeMcpHandlers = ReadOnlyMcpHandlers;

// ---------------------------------------------------------------------------
// Toolkit selection by profile
// ---------------------------------------------------------------------------

const ToolkitByProfile = {
  "read-only": { toolkit: ReadOnlyMcpToolkit, handlers: ReadOnlyMcpHandlers },
  "ops-read": { toolkit: OpsReadMcpToolkit, handlers: OpsReadMcpHandlers },
  "ops-refresh": { toolkit: OpsRefreshMcpToolkit, handlers: OpsRefreshMcpHandlers },
  "ops-read-refresh": {
    toolkit: OpsReadRefreshMcpToolkit,
    handlers: OpsReadRefreshMcpHandlers
  },
  "curation-write": { toolkit: CurationWriteMcpToolkit, handlers: CurationWriteMcpHandlers },
  "ops-curation-write": {
    toolkit: OpsCurationWriteMcpToolkit,
    handlers: OpsCurationWriteMcpHandlers
  },
  "curation-write-refresh": {
    toolkit: CurationWriteRefreshMcpToolkit,
    handlers: CurationWriteRefreshMcpHandlers
  },
  "ops-curation-write-refresh": {
    toolkit: OpsCurationWriteRefreshMcpToolkit,
    handlers: OpsCurationWriteRefreshMcpHandlers
  },
  "editorial-write": {
    toolkit: EditorialWriteMcpToolkit,
    handlers: EditorialWriteMcpHandlers
  },
  "ops-editorial-write": {
    toolkit: OpsEditorialWriteMcpToolkit,
    handlers: OpsEditorialWriteMcpHandlers
  },
  "editorial-write-refresh": {
    toolkit: EditorialWriteRefreshMcpToolkit,
    handlers: EditorialWriteRefreshMcpHandlers
  },
  "ops-editorial-write-refresh": {
    toolkit: OpsEditorialWriteRefreshMcpToolkit,
    handlers: OpsEditorialWriteRefreshMcpHandlers
  },
  "workflow-write": { toolkit: WorkflowWriteMcpToolkit, handlers: WorkflowWriteMcpHandlers },
  "ops-workflow-write": {
    toolkit: OpsWorkflowWriteMcpToolkit,
    handlers: OpsWorkflowWriteMcpHandlers
  },
  "workflow-write-refresh": {
    toolkit: WorkflowWriteRefreshMcpToolkit,
    handlers: WorkflowWriteRefreshMcpHandlers
  },
  "ops-workflow-write-refresh": {
    toolkit: OpsWorkflowWriteRefreshMcpToolkit,
    handlers: OpsWorkflowWriteRefreshMcpHandlers
  }
} satisfies Record<McpCapabilityProfile, {
  readonly toolkit: ReturnType<typeof makeCapabilityToolkit>;
  readonly handlers: ReturnType<typeof makeCapabilityHandlers>;
}>;

export const toolkitForProfile = (profile: McpCapabilityProfile) => ToolkitByProfile[profile];
