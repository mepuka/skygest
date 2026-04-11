import * as HttpApiSchema from "effect/unstable/httpapi/HttpApiSchema";
import { Schema, SchemaGetter } from "effect";
import {
  AddExpertInput,
  AdminExpertResult,
  BootstrapExpertsResult,
  ExpandTopicsInput,
  ExpandedTopicsOutput,
  ExpertListItem,
  ExpertSource,
  ExpertTier,
  ExplainPostTopicsOutput,
  GetTopicInput,
  KnowledgeLinkResult,
  KnowledgePostResult,
  ListExpertsInput,
  ListPublicationsInput,
  ListTopicsInput,
  LoadSmokeFixtureResult,
  OntologyListTopic,
  OntologyTopicsOutput,
  PostThreadOutput,
  PublicationListOutput,
  PublicationSource,
  PublicationTier,
  RefreshProfilesResult,
  SeedPublicationsResult,
  SetExpertActiveInput,
  SetExpertActiveResult,
  TopicSlug
} from "./bi";
import {
  IngestQueuedResponse,
  IngestRepairSummary,
  IngestRunItemRecord,
  IngestRunRecord,
  PollBackfillInput,
  PollHeadInput,
  PollReconcileInput
} from "./polling";
import {
  EnrichmentQueuedResponse,
  EnrichmentRepairSummary,
  EnrichmentRunRecord,
  EnrichmentRunStatus,
  EnrichmentRunsOutput
} from "./enrichmentRun";
import { EmbedKind, EmbedPayload } from "./embed";
import { EnrichmentKind, PostEnrichmentsOutput } from "./enrichment";
import {
  EditorialPickBundle,
  EditorialScore,
  SubmitEditorialPickInput,
  RemoveEditorialPickInput,
  SubmitEditorialPickOutput,
  RemoveEditorialPickOutput,
  EditorialPicksOutput,
  CuratedPostResult
} from "./editorial";
import {
  CuratePostInput,
  CuratePostOutput
} from "./curation";
import { DataLayerRegistryEntity } from "./data-layer";
import { AtUri, Did, PostUri } from "./types";

const withStatus = <S extends Schema.Top>(
  schema: S,
  statusCode: number
) => schema.pipe(HttpApiSchema.status(statusCode));

const ErrorMessage = Schema.String.pipe(Schema.check(Schema.isMinLength(1)));
const ErrorFields = {
  message: ErrorMessage,
  retryable: Schema.optionalKey(Schema.Boolean)
} as const;

export const BadRequestError = withStatus(
  Schema.Struct({
    error: Schema.Literal("BadRequest"),
    ...ErrorFields
  }),
  400
);
export type BadRequestError = Schema.Schema.Type<typeof BadRequestError>;

export const UnauthorizedError = withStatus(
  Schema.Struct({
    error: Schema.Literal("Unauthorized"),
    ...ErrorFields
  }),
  401
);
export type UnauthorizedError = Schema.Schema.Type<typeof UnauthorizedError>;

export const ForbiddenError = withStatus(
  Schema.Struct({
    error: Schema.Literal("Forbidden"),
    ...ErrorFields
  }),
  403
);
export type ForbiddenError = Schema.Schema.Type<typeof ForbiddenError>;

export const NotFoundError = withStatus(
  Schema.Struct({
    error: Schema.Literal("NotFound"),
    ...ErrorFields
  }),
  404
);
export type NotFoundError = Schema.Schema.Type<typeof NotFoundError>;

export const ConflictError = withStatus(
  Schema.Struct({
    error: Schema.Literal("Conflict"),
    ...ErrorFields
  }),
  409
);
export type ConflictError = Schema.Schema.Type<typeof ConflictError>;

export const UpstreamFailureError = withStatus(
  Schema.Struct({
    error: Schema.Literal("UpstreamFailure"),
    ...ErrorFields
  }),
  502
);
export type UpstreamFailureError = Schema.Schema.Type<typeof UpstreamFailureError>;

export const ServiceUnavailableError = withStatus(
  Schema.Struct({
    error: Schema.Literal("ServiceUnavailable"),
    ...ErrorFields
  }),
  503
);
export type ServiceUnavailableError = Schema.Schema.Type<typeof ServiceUnavailableError>;

export const InternalServerError = withStatus(
  Schema.Struct({
    error: Schema.Literal("InternalServerError"),
    ...ErrorFields
  }),
  500
);
export type InternalServerError = Schema.Schema.Type<typeof InternalServerError>;

/** Error schemas array for HttpApi endpoint error declarations */
export const ApiErrorSchemas = [
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  UpstreamFailureError,
  ServiceUnavailableError,
  InternalServerError
] as const;

export const HttpErrorEnvelope = Schema.Union([
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  UpstreamFailureError,
  ServiceUnavailableError,
  InternalServerError
]);
export type HttpErrorEnvelope = Schema.Schema.Type<typeof HttpErrorEnvelope>;

export const badRequestError = (
  message: string,
  retryable?: boolean
): BadRequestError => ({
  error: "BadRequest",
  message,
  ...(retryable === undefined ? {} : { retryable })
});

export const unauthorizedError = (
  message = "unauthorized"
): UnauthorizedError => ({
  error: "Unauthorized",
  message
});

export const forbiddenError = (
  message = "forbidden"
): ForbiddenError => ({
  error: "Forbidden",
  message
});

export const notFoundError = (
  message = "not found"
): NotFoundError => ({
  error: "NotFound",
  message
});

export const conflictError = (
  message: string,
  retryable?: boolean
): ConflictError => ({
  error: "Conflict",
  message,
  ...(retryable === undefined ? {} : { retryable })
});

export const upstreamFailureError = (
  message: string,
  retryable?: boolean
): UpstreamFailureError => ({
  error: "UpstreamFailure",
  message,
  ...(retryable === undefined ? {} : { retryable })
});

export const serviceUnavailableError = (
  message: string,
  retryable?: boolean
): ServiceUnavailableError => ({
  error: "ServiceUnavailable",
  message,
  ...(retryable === undefined ? {} : { retryable })
});

export const internalServerError = (
  message: string,
  retryable?: boolean
): InternalServerError => ({
  error: "InternalServerError",
  message,
  ...(retryable === undefined ? {} : { retryable })
});

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const toBase64Url = (value: string) => {
  let binary = "";

  for (const byte of textEncoder.encode(value)) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/gu, "");
};

const fromBase64Url = (value: string) => {
  const base64 = value
    .replace(/-/gu, "+")
    .replace(/_/gu, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));

  return textDecoder.decode(bytes);
};

const StringFromBase64Url = Schema.String.pipe(
  Schema.decodeTo(Schema.String, {
    decode: SchemaGetter.transform((value: string) => fromBase64Url(value)),
    encode: SchemaGetter.transform((value: string) => toBase64Url(value))
  })
).annotate({ identifier: "StringFromBase64Url" });

const BooleanFromString = Schema.String.pipe(
  Schema.refine((s): s is "true" | "false" => s === "true" || s === "false"),
  Schema.decodeTo(Schema.Boolean, {
    decode: SchemaGetter.transform((s) => s === "true"),
    encode: SchemaGetter.transform((b) => b ? "true" as const : "false" as const)
  })
);

const StringFromUriComponent = Schema.String.pipe(
  Schema.decodeTo(Schema.String, {
    decode: SchemaGetter.transform((s: string) => decodeURIComponent(s)),
    encode: SchemaGetter.transform((s: string) => encodeURIComponent(s))
  })
);

const OptionalNumberFromString = Schema.optionalKey(Schema.NumberFromString);
const OptionalNonNegativeIntFromString = Schema.optionalKey(
  Schema.NumberFromString.pipe(
    Schema.check(Schema.isInt()),
    Schema.check(Schema.isGreaterThanOrEqualTo(0))
  )
);
const OptionalBooleanFromString = Schema.optionalKey(BooleanFromString);
const OptionalString = Schema.optionalKey(Schema.String);
export const DataLayerKind = Schema.Literals([
  "agents",
  "catalogs",
  "catalog-records",
  "datasets",
  "distributions",
  "data-services",
  "dataset-series",
  "variables",
  "series"
]);
export type DataLayerKind = Schema.Schema.Type<typeof DataLayerKind>;

export const DataLayerEntityTag = Schema.Literals([
  "Agent",
  "Catalog",
  "CatalogRecord",
  "Dataset",
  "Distribution",
  "DataService",
  "DatasetSeries",
  "Variable",
  "Series"
]);
export type DataLayerEntityTag = Schema.Schema.Type<typeof DataLayerEntityTag>;

const DecodedDid = StringFromUriComponent.pipe(Schema.decodeTo(Did));
const DecodedAtUri = StringFromUriComponent.pipe(Schema.decodeTo(AtUri));
const DecodedPostUri = StringFromUriComponent.pipe(Schema.decodeTo(PostUri));
const DecodedSlug = StringFromUriComponent.pipe(
  Schema.decodeTo(Schema.String.pipe(Schema.check(Schema.isMinLength(1))))
);
const DecodedId = StringFromUriComponent.pipe(
  Schema.decodeTo(Schema.String.pipe(Schema.check(Schema.isMinLength(1))))
);
const DecodedDataLayerKind = StringFromUriComponent.pipe(
  Schema.decodeTo(DataLayerKind)
);


export const ChronologicalCursor = Schema.Struct({
  createdAt: Schema.Number,
  uri: PostUri
});
export type ChronologicalCursor = Schema.Schema.Type<typeof ChronologicalCursor>;

export const LinkPageCursor = Schema.Struct({
  createdAt: Schema.Number,
  postUri: PostUri,
  url: Schema.String
});
export type LinkPageCursor = Schema.Schema.Type<typeof LinkPageCursor>;

const ChronologicalCursorString = StringFromBase64Url.pipe(
  Schema.decodeTo(Schema.fromJsonString(ChronologicalCursor))
);

const LinkPageCursorString = StringFromBase64Url.pipe(
  Schema.decodeTo(Schema.fromJsonString(LinkPageCursor))
);

export const encodeChronologicalCursor = (cursor: ChronologicalCursor | null) =>
  cursor === null
    ? null
    : Schema.encodeSync(ChronologicalCursorString)(cursor);

export const encodeLinkPageCursor = (cursor: LinkPageCursor | null) =>
  cursor === null
    ? null
    : Schema.encodeSync(LinkPageCursorString)(cursor);

export const SearchPostsCursor = Schema.Struct({
  rank: Schema.Number,
  createdAt: Schema.Number,
  uri: PostUri
});
export type SearchPostsCursor = Schema.Schema.Type<typeof SearchPostsCursor>;

const SearchPostsCursorString = StringFromBase64Url.pipe(
  Schema.decodeTo(Schema.fromJsonString(SearchPostsCursor))
);

export const encodeSearchPostsCursor = (cursor: SearchPostsCursor | null) =>
  cursor === null
    ? null
    : Schema.encodeSync(SearchPostsCursorString)(cursor);

export const SearchPostsUrlParams = Schema.Struct({
  q: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  topic: OptionalString,
  since: OptionalNumberFromString,
  until: OptionalNumberFromString,
  limit: OptionalNumberFromString,
  cursor: Schema.optionalKey(SearchPostsCursorString)
});
export type SearchPostsUrlParams = Schema.Schema.Type<typeof SearchPostsUrlParams>;

export const SearchPostsPageInput = Schema.Struct({
  query: Schema.String,
  topic: Schema.optionalKey(Schema.String),
  since: Schema.optionalKey(Schema.Number),
  until: Schema.optionalKey(Schema.Number),
  limit: Schema.optionalKey(Schema.Number),
  cursor: Schema.optionalKey(SearchPostsCursor)
});
export type SearchPostsPageInput = Schema.Schema.Type<typeof SearchPostsPageInput>;

export const SearchPostsPageQueryInput = Schema.Struct({
  query: Schema.String,
  topicSlugs: Schema.optionalKey(Schema.Array(TopicSlug)),
  since: Schema.optionalKey(Schema.Number),
  until: Schema.optionalKey(Schema.Number),
  limit: Schema.optionalKey(Schema.Number),
  cursor: Schema.optionalKey(SearchPostsCursor)
});
export type SearchPostsPageQueryInput = Schema.Schema.Type<typeof SearchPostsPageQueryInput>;

export type SearchPostsPageResult = {
  readonly items: ReadonlyArray<Schema.Schema.Type<typeof KnowledgePostResult>>;
  readonly nextCursor: SearchPostsCursor | null;
};

export const GetRecentPostsPageInput = Schema.Struct({
  topic: Schema.optionalKey(Schema.String),
  expertDid: Schema.optionalKey(Did),
  since: Schema.optionalKey(Schema.Number),
  until: Schema.optionalKey(Schema.Number),
  limit: Schema.optionalKey(Schema.Number),
  cursor: Schema.optionalKey(ChronologicalCursor)
});
export type GetRecentPostsPageInput = Schema.Schema.Type<typeof GetRecentPostsPageInput>;

export const GetRecentPostsPageUrlParams = Schema.Struct({
  topic: OptionalString,
  expertDid: Schema.optionalKey(DecodedDid),
  since: OptionalNumberFromString,
  until: OptionalNumberFromString,
  limit: OptionalNumberFromString,
  cursor: Schema.optionalKey(ChronologicalCursorString)
});
export type GetRecentPostsPageUrlParams = Schema.Schema.Type<typeof GetRecentPostsPageUrlParams>;

export const GetExpertPostsPageUrlParams = Schema.Struct({
  topic: OptionalString,
  since: OptionalNumberFromString,
  until: OptionalNumberFromString,
  limit: OptionalNumberFromString,
  cursor: Schema.optionalKey(ChronologicalCursorString)
});
export type GetExpertPostsPageUrlParams = Schema.Schema.Type<typeof GetExpertPostsPageUrlParams>;

const OptionalThreadTraversalDepthFromString = Schema.optionalKey(
  Schema.NumberFromString.pipe(Schema.check(Schema.isInt()), Schema.check(Schema.isBetween({ minimum: 0, maximum: 10 })))
);

export const GetThreadUrlParams = Schema.Struct({
  depth: OptionalThreadTraversalDepthFromString,
  parentHeight: OptionalThreadTraversalDepthFromString
});
export type GetThreadUrlParams = Schema.Schema.Type<typeof GetThreadUrlParams>;

export const GetRecentPostsPageQueryInput = Schema.Struct({
  topicSlugs: Schema.optionalKey(Schema.Array(TopicSlug)),
  expertDid: Schema.optionalKey(Did),
  since: Schema.optionalKey(Schema.Number),
  until: Schema.optionalKey(Schema.Number),
  limit: Schema.optionalKey(Schema.Number),
  cursor: Schema.optionalKey(ChronologicalCursor)
});
export type GetRecentPostsPageQueryInput = Schema.Schema.Type<typeof GetRecentPostsPageQueryInput>;

export const GetPostLinksPageInput = Schema.Struct({
  domain: Schema.optionalKey(Schema.String),
  topic: Schema.optionalKey(Schema.String),
  since: Schema.optionalKey(Schema.Number),
  until: Schema.optionalKey(Schema.Number),
  limit: Schema.optionalKey(Schema.Number),
  cursor: Schema.optionalKey(LinkPageCursor)
});
export type GetPostLinksPageInput = Schema.Schema.Type<typeof GetPostLinksPageInput>;

export const GetPostLinksPageUrlParams = Schema.Struct({
  domain: OptionalString,
  topic: OptionalString,
  since: OptionalNumberFromString,
  until: OptionalNumberFromString,
  limit: OptionalNumberFromString,
  cursor: Schema.optionalKey(LinkPageCursorString)
});
export type GetPostLinksPageUrlParams = Schema.Schema.Type<typeof GetPostLinksPageUrlParams>;

export const GetPostLinksPageQueryInput = Schema.Struct({
  domain: Schema.optionalKey(Schema.String),
  topicSlugs: Schema.optionalKey(Schema.Array(TopicSlug)),
  since: Schema.optionalKey(Schema.Number),
  until: Schema.optionalKey(Schema.Number),
  limit: Schema.optionalKey(Schema.Number),
  cursor: Schema.optionalKey(LinkPageCursor)
});
export type GetPostLinksPageQueryInput = Schema.Schema.Type<typeof GetPostLinksPageQueryInput>;

export const ListExpertsUrlParams = Schema.Struct({
  domain: OptionalString,
  active: OptionalBooleanFromString,
  limit: OptionalNonNegativeIntFromString,
  offset: OptionalNonNegativeIntFromString
});
export type ListExpertsUrlParams = Schema.Schema.Type<typeof ListExpertsUrlParams>;

export const ListTopicsUrlParams = Schema.Struct({
  view: Schema.optionalKey(Schema.Literals(["facets", "concepts"]))
});
export type ListTopicsUrlParams = Schema.Schema.Type<typeof ListTopicsUrlParams>;

export const ExpandTopicUrlParams = Schema.Struct({
  mode: Schema.optionalKey(Schema.Literals(["exact", "descendants", "ancestors"]))
});
export type ExpandTopicUrlParams = Schema.Schema.Type<typeof ExpandTopicUrlParams>;

export const ExpertDidPathParams = Schema.Struct({
  did: DecodedDid
});
export type ExpertDidPathParams = Schema.Schema.Type<typeof ExpertDidPathParams>;

export const TopicPathParams = Schema.Struct({
  slug: DecodedSlug
});
export type TopicPathParams = Schema.Schema.Type<typeof TopicPathParams>;

/** Thread path param — AT Protocol only (Bluesky thread expansion) */
export const PostUriThreadPath = Schema.Struct({
  uri: DecodedAtUri
});
export type PostUriThreadPath = Schema.Schema.Type<typeof PostUriThreadPath>;

/** Enrichments/topics path param — platform-agnostic (at:// or x://) */
export const PostUriEnrichmentsPath = Schema.Struct({
  uri: DecodedPostUri
});
export type PostUriEnrichmentsPath = Schema.Schema.Type<typeof PostUriEnrichmentsPath>;

/** @deprecated Use PostUriThreadPath or PostUriEnrichmentsPath */
export const PostUriPathParams = PostUriEnrichmentsPath;
export type PostUriPathParams = PostUriEnrichmentsPath;

export const IngestRunPathParams = Schema.Struct({
  id: DecodedId
});
export type IngestRunPathParams = Schema.Schema.Type<typeof IngestRunPathParams>;

export const ApiPage = Schema.Struct({
  nextCursor: Schema.NullOr(Schema.String)
});
export type ApiPage = Schema.Schema.Type<typeof ApiPage>;

export const KnowledgePostsPageOutput = Schema.Struct({
  items: Schema.Array(KnowledgePostResult),
  page: ApiPage
});
export type KnowledgePostsPageOutput = Schema.Schema.Type<typeof KnowledgePostsPageOutput>;

export const KnowledgeLinksPageOutput = Schema.Struct({
  items: Schema.Array(KnowledgeLinkResult),
  page: ApiPage
});
export type KnowledgeLinksPageOutput = Schema.Schema.Type<typeof KnowledgeLinksPageOutput>;

export const OffsetPage = Schema.Struct({
  offset: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  limit: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  total: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))
});
export type OffsetPage = Schema.Schema.Type<typeof OffsetPage>;

export const ExpertListPageOutput = Schema.Struct({
  items: Schema.Array(ExpertListItem),
  page: OffsetPage
});
export type ExpertListPageOutput = Schema.Schema.Type<typeof ExpertListPageOutput>;

export const PublicTopicOutput = Schema.Struct({
  item: OntologyListTopic
});
export type PublicTopicOutput = Schema.Schema.Type<typeof PublicTopicOutput>;

export const IngestRunItemsOutput = Schema.Struct({
  items: Schema.Array(IngestRunItemRecord)
});
export type IngestRunItemsOutput = Schema.Schema.Type<typeof IngestRunItemsOutput>;

export type RecentPostsPageResult = {
  readonly items: ReadonlyArray<Schema.Schema.Type<typeof KnowledgePostResult>>;
  readonly nextCursor: ChronologicalCursor | null;
};

export type PostLinksPageResult = {
  readonly items: ReadonlyArray<Schema.Schema.Type<typeof KnowledgeLinkResult>>;
  readonly nextCursor: LinkPageCursor | null;
};

export const ListPublicationsUrlParams = Schema.Struct({
  tier: Schema.optionalKey(PublicationTier),
  source: Schema.optionalKey(PublicationSource),
  limit: OptionalNumberFromString
});
export type ListPublicationsUrlParams = Schema.Schema.Type<typeof ListPublicationsUrlParams>;

const OptionalEditorialScoreFromString = Schema.optionalKey(
  Schema.NumberFromString.pipe(Schema.decodeTo(EditorialScore))
);

export const ListEditorialPicksUrlParams = Schema.Struct({
  minScore: OptionalEditorialScoreFromString,
  since: OptionalNumberFromString,
  limit: OptionalNumberFromString
});
export type ListEditorialPicksUrlParams = Schema.Schema.Type<typeof ListEditorialPicksUrlParams>;

export const GetCuratedFeedUrlParams = Schema.Struct({
  topic: OptionalString,
  minScore: OptionalEditorialScoreFromString,
  since: OptionalNumberFromString,
  limit: OptionalNumberFromString
});
export type GetCuratedFeedUrlParams = Schema.Schema.Type<typeof GetCuratedFeedUrlParams>;

export const CuratedPostsPageOutput = Schema.Struct({
  items: Schema.Array(CuratedPostResult),
  page: ApiPage
});
export type CuratedPostsPageOutput = Schema.Schema.Type<typeof CuratedPostsPageOutput>;

export const EnrichmentRunPathParams = Schema.Struct({
  id: DecodedId
});
export type EnrichmentRunPathParams = Schema.Schema.Type<
  typeof EnrichmentRunPathParams
>;

export const ListEnrichmentRunsUrlParams = Schema.Struct({
  status: Schema.optionalKey(EnrichmentRunStatus),
  limit: OptionalNumberFromString
});
export type ListEnrichmentRunsUrlParams = Schema.Schema.Type<
  typeof ListEnrichmentRunsUrlParams
>;

export const StartEnrichmentInput = Schema.Struct({
  postUri: PostUri,
  enrichmentType: EnrichmentKind,
  schemaVersion: Schema.optionalKey(
    Schema.String.pipe(Schema.check(Schema.isMinLength(1)))
  )
});
export type StartEnrichmentInput = Schema.Schema.Type<
  typeof StartEnrichmentInput
>;

export const PublicReadRequestSchemas = {
  searchPosts: SearchPostsUrlParams,
  recentPosts: GetRecentPostsPageUrlParams,
  expertPosts: GetExpertPostsPageUrlParams,
  links: GetPostLinksPageUrlParams,
  experts: ListExpertsUrlParams,
  publications: ListPublicationsUrlParams,
  topics: ListTopicsUrlParams,
  expandTopic: ExpandTopicUrlParams,
  expertPath: ExpertDidPathParams,
  topicPath: TopicPathParams,
  postUriPath: PostUriEnrichmentsPath,
  postUriThreadPath: PostUriThreadPath,
  thread: GetThreadUrlParams,
  curatedFeed: GetCuratedFeedUrlParams
} as const;

export const PublicReadResponseSchemas = {
  postsPage: KnowledgePostsPageOutput,
  linksPage: KnowledgeLinksPageOutput,
  experts: ExpertListPageOutput,
  publications: PublicationListOutput,
  topics: OntologyTopicsOutput,
  topic: PublicTopicOutput,
  expandedTopics: ExpandedTopicsOutput,
  explainedTopics: ExplainPostTopicsOutput,
  thread: PostThreadOutput,
  enrichments: PostEnrichmentsOutput,
  curatedPostsPage: CuratedPostsPageOutput
} as const;

export const StagingStatsExperts = Schema.Struct({
  total: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  active: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))
});

export const StagingStatsPosts = Schema.Struct({
  total: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  inLast24h: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  withLinks: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))
});

export const StagingStatsCuration = Schema.Struct({
  flagged: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  curated: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  rejected: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))
});

export const StagingStatsEnrichment = Schema.Struct({
  queued: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  running: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  complete: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  failed: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  needsReview: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))
});

export const StagingStatsLastIngest = Schema.Struct({
  runId: Schema.String,
  kind: Schema.String,
  status: Schema.String,
  startedAt: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  finishedAt: Schema.NullOr(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))),
  postsSeen: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  postsStored: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))
});

export const StagingStats = Schema.Struct({
  timestamp: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  experts: StagingStatsExperts,
  posts: StagingStatsPosts,
  curation: StagingStatsCuration,
  enrichment: StagingStatsEnrichment,
  lastIngest: Schema.NullOr(StagingStatsLastIngest)
});

// ---------------------------------------------------------------------------
// Import schemas (Twitter cross-post pipeline)
// ---------------------------------------------------------------------------

export const ImportLinkInput = Schema.Struct({
  url: Schema.String,
  title: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
  domain: Schema.optionalKey(Schema.String)
});
export type ImportLinkInput = Schema.Schema.Type<typeof ImportLinkInput>;

export const ImportExpertInput = Schema.Struct({
  did: Did,
  handle: Schema.String,
  domain: Schema.String,
  source: ExpertSource,
  tier: ExpertTier,
  displayName: Schema.optionalKey(Schema.String),
  avatar: Schema.optionalKey(Schema.String)
});
export type ImportExpertInput = Schema.Schema.Type<typeof ImportExpertInput>;

export const ImportPostInput = Schema.Struct({
  uri: PostUri,
  did: Did,
  text: Schema.String,
  createdAt: Schema.Number,
  hashtags: Schema.optionalKey(Schema.Array(Schema.String)),
  embedType: Schema.optionalKey(Schema.NullOr(EmbedKind)),
  embedPayload: Schema.optionalKey(Schema.NullOr(EmbedPayload)),
  links: Schema.Array(ImportLinkInput)
});
export type ImportPostInput = Schema.Schema.Type<typeof ImportPostInput>;

export const ImportPostsInput = Schema.Struct({
  experts: Schema.Array(ImportExpertInput),
  posts: Schema.Array(ImportPostInput),
  operatorOverride: Schema.optionalKey(Schema.Boolean.annotate({
    description: "When true, import posts even with zero topic matches. For operator-submitted posts where the human has already judged relevance."
  }))
});
export type ImportPostsInput = Schema.Schema.Type<typeof ImportPostsInput>;

export const ImportPostsOutput = Schema.Struct({
  imported: Schema.Number,
  flagged: Schema.Number,
  skipped: Schema.Number
});
export type ImportPostsOutput = Schema.Schema.Type<typeof ImportPostsOutput>;

export const DataLayerKindPathParams = Schema.Struct({
  kind: DecodedDataLayerKind
});
export type DataLayerKindPathParams = Schema.Schema.Type<
  typeof DataLayerKindPathParams
>;

export const DataLayerEntityPathParams = Schema.Struct({
  kind: DecodedDataLayerKind,
  id: DecodedId
});
export type DataLayerEntityPathParams = Schema.Schema.Type<
  typeof DataLayerEntityPathParams
>;

export const DataLayerAuditPathParams = Schema.Struct({
  id: DecodedId
});
export type DataLayerAuditPathParams = Schema.Schema.Type<
  typeof DataLayerAuditPathParams
>;

export const ListDataLayerUrlParams = Schema.Struct({
  limit: OptionalNonNegativeIntFromString,
  offset: OptionalNonNegativeIntFromString
});
export type ListDataLayerUrlParams = Schema.Schema.Type<
  typeof ListDataLayerUrlParams
>;

export const DataLayerEntityPageOutput = Schema.Struct({
  items: Schema.Array(DataLayerRegistryEntity),
  page: OffsetPage
});
export type DataLayerEntityPageOutput = Schema.Schema.Type<
  typeof DataLayerEntityPageOutput
>;

export const DataLayerAuditEntry = Schema.Struct({
  id: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  entityId: Schema.String,
  entityKind: DataLayerEntityTag,
  operation: Schema.Literals(["insert", "update", "delete"]),
  operator: Schema.String,
  beforeRow: Schema.NullOr(DataLayerRegistryEntity),
  afterRow: Schema.NullOr(DataLayerRegistryEntity),
  timestamp: Schema.String
});
export type DataLayerAuditEntry = Schema.Schema.Type<typeof DataLayerAuditEntry>;

export const DataLayerAuditOutput = Schema.Struct({
  items: Schema.Array(DataLayerAuditEntry)
});
export type DataLayerAuditOutput = Schema.Schema.Type<
  typeof DataLayerAuditOutput
>;

export const AdminRequestSchemas = {
  addExpert: AddExpertInput,
  listExperts: ListExpertsUrlParams,
  setExpertActive: SetExpertActiveInput,
  expertPath: ExpertDidPathParams,
  curatePost: CuratePostInput,
  submitEditorialPick: SubmitEditorialPickInput,
  retractEditorialPick: RemoveEditorialPickInput,
  listEditorialPicks: ListEditorialPicksUrlParams,
  editorialPickBundlePath: PostUriEnrichmentsPath,
  importPosts: ImportPostsInput,
  dataLayerEntity: DataLayerRegistryEntity,
  dataLayerList: ListDataLayerUrlParams,
  dataLayerKindPath: DataLayerKindPathParams,
  dataLayerEntityPath: DataLayerEntityPathParams,
  dataLayerAuditPath: DataLayerAuditPathParams
} as const;

export const AdminResponseSchemas = {
  addExpert: AdminExpertResult,
  listExperts: ExpertListPageOutput,
  setExpertActive: SetExpertActiveResult,
  curatePost: CuratePostOutput,
  migrate: Schema.Struct({ ok: Schema.Literal(true) }),
  bootstrapExperts: BootstrapExpertsResult,
  loadSmokeFixture: LoadSmokeFixtureResult,
  refreshProfiles: RefreshProfilesResult,
  seedPublications: SeedPublicationsResult,
  submitEditorialPick: SubmitEditorialPickOutput,
  retractEditorialPick: RemoveEditorialPickOutput,
  listEditorialPicks: EditorialPicksOutput,
  editorialPickBundle: EditorialPickBundle,
  importPosts: ImportPostsOutput,
  stats: StagingStats,
  dataLayerEntity: DataLayerRegistryEntity,
  dataLayerEntitiesPage: DataLayerEntityPageOutput,
  dataLayerDelete: Schema.Struct({ ok: Schema.Literal(true) }),
  dataLayerAudit: DataLayerAuditOutput
} as const;

export const IngestRequestSchemas = {
  poll: PollHeadInput,
  backfill: PollBackfillInput,
  reconcile: PollReconcileInput,
  runPath: IngestRunPathParams
} as const;

export const IngestResponseSchemas = {
  queued: IngestQueuedResponse,
  run: IngestRunRecord,
  runItems: IngestRunItemsOutput,
  repair: IngestRepairSummary
} as const;

export const EnrichmentRequestSchemas = {
  start: StartEnrichmentInput,
  runPath: EnrichmentRunPathParams,
  runs: ListEnrichmentRunsUrlParams
} as const;

export const EnrichmentResponseSchemas = {
  queued: EnrichmentQueuedResponse,
  run: EnrichmentRunRecord,
  runs: EnrichmentRunsOutput,
  repair: EnrichmentRepairSummary
} as const;

export type PublicReadResponseSchemas = typeof PublicReadResponseSchemas;
export type PublicReadRequestSchemas = typeof PublicReadRequestSchemas;
export type AdminRequestSchemas = typeof AdminRequestSchemas;
export type AdminResponseSchemas = typeof AdminResponseSchemas;
export type IngestRequestSchemas = typeof IngestRequestSchemas;
export type IngestResponseSchemas = typeof IngestResponseSchemas;
export type EnrichmentRequestSchemas = typeof EnrichmentRequestSchemas;
export type EnrichmentResponseSchemas = typeof EnrichmentResponseSchemas;
