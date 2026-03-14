import * as HttpApiSchema from "@effect/platform/HttpApiSchema";
import { ParseResult, Schema } from "effect";
import {
  AddExpertInput,
  AdminExpertResult,
  BootstrapExpertsResult,
  ExpandTopicsInput,
  ExpandedTopicsOutput,
  ExplainPostTopicsOutput,
  ExpertListOutput,
  GetTopicInput,
  KnowledgeLinkResult,
  KnowledgePostResult,
  ListExpertsInput,
  ListTopicsInput,
  LoadSmokeFixtureResult,
  OntologyListTopic,
  OntologyTopicsOutput,
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
import { AtUri, Did } from "./types";

const withStatus = <A, I, R>(
  schema: Schema.Schema<A, I, R>,
  status: number
) => schema.annotations(HttpApiSchema.annotations({ status }));

const ErrorMessage = Schema.String.pipe(Schema.minLength(1));
const ErrorFields = {
  message: ErrorMessage,
  retryable: Schema.optional(Schema.Boolean)
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

export const HttpErrorEnvelope = Schema.Union(
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  UpstreamFailureError,
  ServiceUnavailableError,
  InternalServerError
);
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

const formatUnknown = (value: unknown) =>
  value instanceof Error ? value.message : String(value);

const StringFromBase64Url = Schema.transformOrFail(
  Schema.String,
  Schema.String,
  {
    strict: true,
    decode: (value, _, ast) =>
      ParseResult.try({
        try: () => fromBase64Url(value),
        catch: (error) => new ParseResult.Type(ast, value, formatUnknown(error))
      }),
    encode: (value, _, ast) =>
      ParseResult.try({
        try: () => toBase64Url(value),
        catch: (error) => new ParseResult.Type(ast, value, formatUnknown(error))
      })
  }
).annotations({ identifier: "StringFromBase64Url" });

const OptionalNumberFromString = Schema.optional(Schema.NumberFromString);
const OptionalBooleanFromString = Schema.optional(Schema.BooleanFromString);
const OptionalString = Schema.optional(Schema.String);
const DecodedDid = Schema.compose(Schema.StringFromUriComponent, Did);
const DecodedAtUri = Schema.compose(Schema.StringFromUriComponent, AtUri);
const DecodedSlug = Schema.compose(
  Schema.StringFromUriComponent,
  Schema.String.pipe(Schema.minLength(1))
);
const DecodedId = Schema.compose(
  Schema.StringFromUriComponent,
  Schema.String.pipe(Schema.minLength(1))
);


export const ChronologicalCursor = Schema.Struct({
  createdAt: Schema.Number,
  uri: AtUri
});
export type ChronologicalCursor = Schema.Schema.Type<typeof ChronologicalCursor>;

export const LinkPageCursor = Schema.Struct({
  createdAt: Schema.Number,
  postUri: AtUri,
  url: Schema.String
});
export type LinkPageCursor = Schema.Schema.Type<typeof LinkPageCursor>;

const ChronologicalCursorString = Schema.compose(
  StringFromBase64Url,
  Schema.parseJson(ChronologicalCursor)
);

const LinkPageCursorString = Schema.compose(
  StringFromBase64Url,
  Schema.parseJson(LinkPageCursor)
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
  uri: AtUri
});
export type SearchPostsCursor = Schema.Schema.Type<typeof SearchPostsCursor>;

const SearchPostsCursorString = Schema.compose(
  StringFromBase64Url,
  Schema.parseJson(SearchPostsCursor)
);

export const encodeSearchPostsCursor = (cursor: SearchPostsCursor | null) =>
  cursor === null
    ? null
    : Schema.encodeSync(SearchPostsCursorString)(cursor);

export const SearchPostsUrlParams = Schema.Struct({
  q: Schema.String.pipe(Schema.minLength(1)),
  topic: OptionalString,
  since: OptionalNumberFromString,
  until: OptionalNumberFromString,
  limit: OptionalNumberFromString,
  cursor: Schema.optional(SearchPostsCursorString)
});
export type SearchPostsUrlParams = Schema.Schema.Type<typeof SearchPostsUrlParams>;

export const SearchPostsPageInput = Schema.Struct({
  query: Schema.String,
  topic: Schema.optional(Schema.String),
  since: Schema.optional(Schema.Number),
  until: Schema.optional(Schema.Number),
  limit: Schema.optional(Schema.Number),
  cursor: Schema.optional(SearchPostsCursor)
});
export type SearchPostsPageInput = Schema.Schema.Type<typeof SearchPostsPageInput>;

export const SearchPostsPageQueryInput = Schema.Struct({
  query: Schema.String,
  topicSlugs: Schema.optional(Schema.Array(TopicSlug)),
  since: Schema.optional(Schema.Number),
  until: Schema.optional(Schema.Number),
  limit: Schema.optional(Schema.Number),
  cursor: Schema.optional(SearchPostsCursor)
});
export type SearchPostsPageQueryInput = Schema.Schema.Type<typeof SearchPostsPageQueryInput>;

export type SearchPostsPageResult = {
  readonly items: ReadonlyArray<Schema.Schema.Type<typeof KnowledgePostResult>>;
  readonly nextCursor: SearchPostsCursor | null;
};

export const GetRecentPostsPageInput = Schema.Struct({
  topic: Schema.optional(Schema.String),
  expertDid: Schema.optional(Did),
  since: Schema.optional(Schema.Number),
  until: Schema.optional(Schema.Number),
  limit: Schema.optional(Schema.Number),
  cursor: Schema.optional(ChronologicalCursor)
});
export type GetRecentPostsPageInput = Schema.Schema.Type<typeof GetRecentPostsPageInput>;

export const GetRecentPostsPageUrlParams = Schema.Struct({
  topic: OptionalString,
  expertDid: Schema.optional(DecodedDid),
  since: OptionalNumberFromString,
  until: OptionalNumberFromString,
  limit: OptionalNumberFromString,
  cursor: Schema.optional(ChronologicalCursorString)
});
export type GetRecentPostsPageUrlParams = Schema.Schema.Type<typeof GetRecentPostsPageUrlParams>;

export const GetExpertPostsPageUrlParams = Schema.Struct({
  topic: OptionalString,
  since: OptionalNumberFromString,
  until: OptionalNumberFromString,
  limit: OptionalNumberFromString,
  cursor: Schema.optional(ChronologicalCursorString)
});
export type GetExpertPostsPageUrlParams = Schema.Schema.Type<typeof GetExpertPostsPageUrlParams>;

export const GetRecentPostsPageQueryInput = Schema.Struct({
  topicSlugs: Schema.optional(Schema.Array(TopicSlug)),
  expertDid: Schema.optional(Did),
  since: Schema.optional(Schema.Number),
  until: Schema.optional(Schema.Number),
  limit: Schema.optional(Schema.Number),
  cursor: Schema.optional(ChronologicalCursor)
});
export type GetRecentPostsPageQueryInput = Schema.Schema.Type<typeof GetRecentPostsPageQueryInput>;

export const GetPostLinksPageInput = Schema.Struct({
  domain: Schema.optional(Schema.String),
  topic: Schema.optional(Schema.String),
  since: Schema.optional(Schema.Number),
  until: Schema.optional(Schema.Number),
  limit: Schema.optional(Schema.Number),
  cursor: Schema.optional(LinkPageCursor)
});
export type GetPostLinksPageInput = Schema.Schema.Type<typeof GetPostLinksPageInput>;

export const GetPostLinksPageUrlParams = Schema.Struct({
  domain: OptionalString,
  topic: OptionalString,
  since: OptionalNumberFromString,
  until: OptionalNumberFromString,
  limit: OptionalNumberFromString,
  cursor: Schema.optional(LinkPageCursorString)
});
export type GetPostLinksPageUrlParams = Schema.Schema.Type<typeof GetPostLinksPageUrlParams>;

export const GetPostLinksPageQueryInput = Schema.Struct({
  domain: Schema.optional(Schema.String),
  topicSlugs: Schema.optional(Schema.Array(TopicSlug)),
  since: Schema.optional(Schema.Number),
  until: Schema.optional(Schema.Number),
  limit: Schema.optional(Schema.Number),
  cursor: Schema.optional(LinkPageCursor)
});
export type GetPostLinksPageQueryInput = Schema.Schema.Type<typeof GetPostLinksPageQueryInput>;

export const ListExpertsUrlParams = Schema.Struct({
  domain: OptionalString,
  active: OptionalBooleanFromString,
  limit: OptionalNumberFromString
});
export type ListExpertsUrlParams = Schema.Schema.Type<typeof ListExpertsUrlParams>;

export const ListTopicsUrlParams = Schema.Struct({
  view: Schema.optional(Schema.Literal("facets", "concepts"))
});
export type ListTopicsUrlParams = Schema.Schema.Type<typeof ListTopicsUrlParams>;

export const ExpandTopicUrlParams = Schema.Struct({
  mode: Schema.optional(Schema.Literal("exact", "descendants", "ancestors"))
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

export const PostUriPathParams = Schema.Struct({
  uri: DecodedAtUri
});
export type PostUriPathParams = Schema.Schema.Type<typeof PostUriPathParams>;

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

export const PublicReadRequestSchemas = {
  searchPosts: SearchPostsUrlParams,
  recentPosts: GetRecentPostsPageUrlParams,
  expertPosts: GetExpertPostsPageUrlParams,
  links: GetPostLinksPageUrlParams,
  experts: ListExpertsUrlParams,
  topics: ListTopicsUrlParams,
  expandTopic: ExpandTopicUrlParams,
  expertPath: ExpertDidPathParams,
  topicPath: TopicPathParams,
  postUriPath: PostUriPathParams
} as const;

export const PublicReadResponseSchemas = {
  postsPage: KnowledgePostsPageOutput,
  linksPage: KnowledgeLinksPageOutput,
  experts: ExpertListOutput,
  topics: OntologyTopicsOutput,
  topic: PublicTopicOutput,
  expandedTopics: ExpandedTopicsOutput,
  explainedTopics: ExplainPostTopicsOutput
} as const;

export const AdminRequestSchemas = {
  addExpert: AddExpertInput,
  listExperts: ListExpertsUrlParams,
  setExpertActive: SetExpertActiveInput,
  expertPath: ExpertDidPathParams
} as const;

export const AdminResponseSchemas = {
  addExpert: AdminExpertResult,
  listExperts: ExpertListOutput,
  setExpertActive: SetExpertActiveResult,
  migrate: Schema.Struct({ ok: Schema.Literal(true) }),
  bootstrapExperts: BootstrapExpertsResult,
  loadSmokeFixture: LoadSmokeFixtureResult
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

export type PublicReadResponseSchemas = typeof PublicReadResponseSchemas;
export type PublicReadRequestSchemas = typeof PublicReadRequestSchemas;
export type AdminRequestSchemas = typeof AdminRequestSchemas;
export type AdminResponseSchemas = typeof AdminResponseSchemas;
export type IngestRequestSchemas = typeof IngestRequestSchemas;
export type IngestResponseSchemas = typeof IngestResponseSchemas;

