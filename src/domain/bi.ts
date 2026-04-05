import { Schema } from "effect";
import { AtUri, Did, HttpsUrl, PostUri, PublicationId } from "./types";
import { EmbedKind, EmbedPayload } from "./embed";

const isFiniteNumber = (value: number) => Number.isFinite(value);

const FiniteNumber = Schema.Number.pipe(Schema.check(Schema.makeFilter(isFiniteNumber)));

export const FlexibleNumber = Schema.Union([
  FiniteNumber,
  Schema.NumberFromString.pipe(Schema.check(Schema.makeFilter(isFiniteNumber)))
]);

export const TopicSlug = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.brand("TopicSlug")
);
export type TopicSlug = Schema.Schema.Type<typeof TopicSlug>;

export const OntologyConceptSlug = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.brand("OntologyConceptSlug")
);
export type OntologyConceptSlug = Schema.Schema.Type<typeof OntologyConceptSlug>;

export const ExpertSource = Schema.Literals(["manual", "starter_pack", "list", "network", "twitter-import", "bluesky-import"]);
export type ExpertSource = Schema.Schema.Type<typeof ExpertSource>;

export const ExpertTier = Schema.Literals(["energy-focused", "general-outlet", "independent"]);
export type ExpertTier = Schema.Schema.Type<typeof ExpertTier>;

export const ExpertSeed = Schema.Struct({
  did: Did,
  handle: Schema.optionalKey(Schema.String),
  displayName: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
  source: ExpertSource,
  sourceRef: Schema.optionalKey(Schema.String),
  active: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(() => true))
});
export type ExpertSeed = Schema.Schema.Type<typeof ExpertSeed>;

export const ExpertSeedManifest = Schema.Struct({
  domain: Schema.String,
  experts: Schema.Array(ExpertSeed)
});
export type ExpertSeedManifest = Schema.Schema.Type<typeof ExpertSeedManifest>;

export const ExpertRecord = Schema.Struct({
  did: Did,
  handle: Schema.NullOr(Schema.String),
  displayName: Schema.NullOr(Schema.String),
  description: Schema.NullOr(Schema.String),
  avatar: Schema.NullOr(HttpsUrl),
  domain: Schema.String,
  source: ExpertSource,
  sourceRef: Schema.NullOr(Schema.String),
  shard: Schema.Number,
  active: Schema.Boolean,
  tier: ExpertTier.pipe(Schema.withDecodingDefaultKey(() => "independent" as const)),
  addedAt: Schema.Number,
  lastSyncedAt: Schema.NullOr(Schema.Number)
});
export type ExpertRecord = Schema.Schema.Type<typeof ExpertRecord>;

export const ExpertListItem = Schema.Struct({
  did: Did,
  handle: Schema.NullOr(Schema.String),
  displayName: Schema.NullOr(Schema.String),
  avatar: Schema.NullOr(HttpsUrl),
  domain: Schema.String,
  source: ExpertSource,
  active: Schema.Boolean,
  tier: ExpertTier.pipe(Schema.withDecodingDefaultKey(() => "independent" as const))
});
export type ExpertListItem = Schema.Schema.Type<typeof ExpertListItem>;

export const ResolvedDidOrHandle = Schema.Struct({
  did: Did,
  handle: Schema.NullOr(Schema.String)
});
export type ResolvedDidOrHandle = Schema.Schema.Type<typeof ResolvedDidOrHandle>;

export const BlueskyProfile = Schema.Struct({
  did: Did,
  handle: Schema.NullOr(Schema.String),
  displayName: Schema.NullOr(Schema.String),
  description: Schema.NullOr(Schema.String),
  avatar: Schema.NullOr(HttpsUrl)
});
export type BlueskyProfile = Schema.Schema.Type<typeof BlueskyProfile>;

export const OntologyTopic = Schema.Struct({
  slug: TopicSlug,
  label: Schema.String,
  description: Schema.String,
  conceptSlugs: Schema.Array(OntologyConceptSlug),
  rootConceptSlugs: Schema.Array(OntologyConceptSlug),
  terms: Schema.Array(Schema.String),
  hashtags: Schema.Array(Schema.String),
  domains: Schema.Array(Schema.String)
});
export type OntologyTopic = Schema.Schema.Type<typeof OntologyTopic>;

export const OntologyConcept = Schema.Struct({
  slug: OntologyConceptSlug,
  iri: Schema.String,
  label: Schema.String,
  altLabels: Schema.Array(Schema.String),
  description: Schema.NullOr(Schema.String),
  topConcept: Schema.Boolean,
  broaderSlugs: Schema.Array(OntologyConceptSlug),
  narrowerSlugs: Schema.Array(OntologyConceptSlug),
  canonicalTopicSlug: Schema.NullOr(TopicSlug),
  matcherTerms: Schema.Array(Schema.String)
});
export type OntologyConcept = Schema.Schema.Type<typeof OntologyConcept>;

export const MatchSignal = Schema.Literals(["term", "hashtag", "domain"]);
export type MatchSignal = Schema.Schema.Type<typeof MatchSignal>;

export const OntologySignalCatalog = Schema.Struct({
  hashtags: Schema.Array(Schema.String),
  domains: Schema.Array(Schema.String),
  ambiguityTerms: Schema.Array(Schema.String)
});
export type OntologySignalCatalog = Schema.Schema.Type<typeof OntologySignalCatalog>;

export const OntologyAuthorTiers = Schema.Struct({
  energyFocused: Schema.Array(Schema.String),
  generalOutlets: Schema.Array(Schema.String)
});
export type OntologyAuthorTiers = Schema.Schema.Type<typeof OntologyAuthorTiers>;

export const OntologyAnomaly = Schema.Struct({
  code: Schema.String,
  message: Schema.String
});
export type OntologyAnomaly = Schema.Schema.Type<typeof OntologyAnomaly>;

export const OntologySnapshot = Schema.Struct({
  ontologyVersion: Schema.String,
  snapshotVersion: Schema.String,
  generatedAt: Schema.String,
  sourceDigest: Schema.String,
  canonicalTopics: Schema.Array(OntologyTopic),
  concepts: Schema.Array(OntologyConcept),
  signalCatalog: OntologySignalCatalog,
  authorTiers: OntologyAuthorTiers,
  anomalies: Schema.Array(OntologyAnomaly)
});
export type OntologySnapshot = Schema.Schema.Type<typeof OntologySnapshot>;

export const MatchedTopic = Schema.Struct({
  topicSlug: TopicSlug,
  matchedTerm: Schema.String,
  matchSignal: MatchSignal,
  matchValue: Schema.String,
  matchScore: Schema.Number,
  ontologyVersion: Schema.String,
  matcherVersion: Schema.String
});
export type MatchedTopic = Schema.Schema.Type<typeof MatchedTopic>;

export const LinkRecord = Schema.Struct({
  url: Schema.String,
  title: Schema.NullOr(Schema.String),
  description: Schema.NullOr(Schema.String),
  imageUrl: Schema.NullOr(HttpsUrl),
  domain: Schema.NullOr(Schema.String),
  extractedAt: Schema.Number
});
export type LinkRecord = Schema.Schema.Type<typeof LinkRecord>;

export const KnowledgePost = Schema.Struct({
  uri: PostUri,
  did: Did,
  cid: Schema.NullOr(Schema.String),
  text: Schema.String,
  createdAt: Schema.Number,
  indexedAt: Schema.Number,
  hasLinks: Schema.Boolean,
  status: Schema.Literals(["active", "deleted"]),
  ingestId: Schema.String,
  embedType: Schema.NullOr(EmbedKind),
  topics: Schema.Array(MatchedTopic),
  links: Schema.Array(LinkRecord)
});
export type KnowledgePost = Schema.Schema.Type<typeof KnowledgePost>;

export const DeletedKnowledgePost = Schema.Struct({
  uri: PostUri,
  did: Did,
  cid: Schema.NullOr(Schema.String),
  createdAt: Schema.Number,
  indexedAt: Schema.Number,
  ingestId: Schema.String
});
export type DeletedKnowledgePost = Schema.Schema.Type<typeof DeletedKnowledgePost>;

export const SearchPostsInput = Schema.Struct({
  query: Schema.String.annotate({ description: "Full-text search query" }),
  topic: Schema.optionalKey(Schema.String.annotate({ description: "Topic slug to filter by, e.g. 'solar' or 'hydrogen'" })),
  since: Schema.optionalKey(FlexibleNumber.annotate({ description: "Filter posts created after this Unix epoch timestamp (milliseconds)" })),
  until: Schema.optionalKey(FlexibleNumber.annotate({ description: "Filter posts created before this Unix epoch timestamp (milliseconds)" })),
  limit: Schema.optionalKey(FlexibleNumber.annotate({ description: "Maximum number of results to return" }))
});
export type SearchPostsInput = Schema.Schema.Type<typeof SearchPostsInput>;

export const KnowledgePostCursor = Schema.Struct({
  createdAt: Schema.Number,
  uri: PostUri
});
export type KnowledgePostCursor = Schema.Schema.Type<typeof KnowledgePostCursor>;

export const GetRecentPostsInput = Schema.Struct({
  topic: Schema.optionalKey(Schema.String.annotate({ description: "Topic slug to filter by, e.g. 'solar' or 'hydrogen'" })),
  expertDid: Schema.optionalKey(Did),
  since: Schema.optionalKey(FlexibleNumber.annotate({ description: "Filter posts created after this Unix epoch timestamp (milliseconds)" })),
  until: Schema.optionalKey(FlexibleNumber.annotate({ description: "Filter posts created before this Unix epoch timestamp (milliseconds)" })),
  cursor: Schema.optionalKey(KnowledgePostCursor),
  limit: Schema.optionalKey(FlexibleNumber.annotate({ description: "Maximum number of results to return" }))
});
export type GetRecentPostsInput = Schema.Schema.Type<typeof GetRecentPostsInput>;

export const KnowledgeLinkCursor = Schema.Struct({
  createdAt: Schema.Number,
  postUri: PostUri,
  url: Schema.String
});
export type KnowledgeLinkCursor = Schema.Schema.Type<typeof KnowledgeLinkCursor>;

export const GetPostLinksInput = Schema.Struct({
  domain: Schema.optionalKey(Schema.String.annotate({ description: "Link hostname to filter by, e.g. 'reuters.com'" })),
  topic: Schema.optionalKey(Schema.String.annotate({ description: "Topic slug to filter by, e.g. 'solar' or 'hydrogen'" })),
  since: Schema.optionalKey(FlexibleNumber.annotate({ description: "Filter posts created after this Unix epoch timestamp (milliseconds)" })),
  until: Schema.optionalKey(FlexibleNumber.annotate({ description: "Filter posts created before this Unix epoch timestamp (milliseconds)" })),
  cursor: Schema.optionalKey(KnowledgeLinkCursor),
  limit: Schema.optionalKey(FlexibleNumber.annotate({ description: "Maximum number of results to return" }))
});
export type GetPostLinksInput = Schema.Schema.Type<typeof GetPostLinksInput>;

export const SearchPostsQueryInput = Schema.Struct({
  query: Schema.String,
  topicSlugs: Schema.optionalKey(Schema.Array(TopicSlug)),
  since: Schema.optionalKey(Schema.Number),
  until: Schema.optionalKey(Schema.Number),
  limit: Schema.optionalKey(Schema.Number)
});
export type SearchPostsQueryInput = Schema.Schema.Type<typeof SearchPostsQueryInput>;

export const GetRecentPostsQueryInput = Schema.Struct({
  topicSlugs: Schema.optionalKey(Schema.Array(TopicSlug)),
  expertDid: Schema.optionalKey(Did),
  since: Schema.optionalKey(Schema.Number),
  until: Schema.optionalKey(Schema.Number),
  cursor: Schema.optionalKey(KnowledgePostCursor),
  limit: Schema.optionalKey(Schema.Number)
});
export type GetRecentPostsQueryInput = Schema.Schema.Type<typeof GetRecentPostsQueryInput>;

export const GetPostLinksQueryInput = Schema.Struct({
  domain: Schema.optionalKey(Schema.String),
  topicSlugs: Schema.optionalKey(Schema.Array(TopicSlug)),
  since: Schema.optionalKey(Schema.Number),
  until: Schema.optionalKey(Schema.Number),
  cursor: Schema.optionalKey(KnowledgeLinkCursor),
  limit: Schema.optionalKey(Schema.Number)
});
export type GetPostLinksQueryInput = Schema.Schema.Type<typeof GetPostLinksQueryInput>;

export const ListExpertsInput = Schema.Struct({
  domain: Schema.optionalKey(Schema.String.annotate({ description: "Knowledge domain, e.g. 'energy'" })),
  active: Schema.optionalKey(Schema.Boolean.annotate({ description: "Filter by active status" })),
  limit: Schema.optionalKey(FlexibleNumber.annotate({ description: "Maximum number of results to return" }))
});
export type ListExpertsInput = Schema.Schema.Type<typeof ListExpertsInput>;

export const AddExpertInput = Schema.Struct({
  didOrHandle: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  domain: Schema.optionalKey(Schema.String),
  active: Schema.optionalKey(Schema.Boolean)
});
export type AddExpertInput = Schema.Schema.Type<typeof AddExpertInput>;

export const SetExpertActiveInput = Schema.Struct({
  active: Schema.Boolean
});
export type SetExpertActiveInput = Schema.Schema.Type<typeof SetExpertActiveInput>;

export const ThreadEmbedType = EmbedKind;
export type ThreadEmbedType = Schema.Schema.Type<typeof ThreadEmbedType>;

export const KnowledgePostHydration = Schema.Struct({
  replyCount: Schema.NullOr(Schema.Number),
  embedType: Schema.NullOr(ThreadEmbedType),
  embedContent: Schema.NullOr(EmbedPayload)
});
export type KnowledgePostHydration = Schema.Schema.Type<typeof KnowledgePostHydration>;

export const emptyKnowledgePostHydration = (): KnowledgePostHydration => ({
  replyCount: null,
  embedType: null,
  embedContent: null
});

export const KnowledgePostResult = Schema.Struct({
  uri: PostUri,
  did: Did,
  handle: Schema.NullOr(Schema.String),
  avatar: Schema.NullOr(HttpsUrl),
  text: Schema.String,
  createdAt: Schema.Number,
  topics: Schema.Array(Schema.String),
  snippet: Schema.optionalKey(Schema.NullOr(Schema.String)),
  tier: ExpertTier.pipe(Schema.withDecodingDefaultKey(() => "independent" as const)),
  ...KnowledgePostHydration.fields
});
export type KnowledgePostResult = typeof KnowledgePostResult.Type;

export const KnowledgeLinkResult = Schema.Struct({
  postUri: PostUri,
  url: Schema.String,
  domain: Schema.NullOr(Schema.String),
  title: Schema.NullOr(Schema.String),
  description: Schema.NullOr(Schema.String),
  imageUrl: Schema.NullOr(HttpsUrl),
  createdAt: Schema.Number
});
export type KnowledgeLinkResult = Schema.Schema.Type<typeof KnowledgeLinkResult>;

export const KnowledgePostsOutput = Schema.Struct({
  items: Schema.Array(KnowledgePostResult)
});
export type KnowledgePostsOutput = Schema.Schema.Type<typeof KnowledgePostsOutput>;

export const KnowledgeLinksOutput = Schema.Struct({
  items: Schema.Array(KnowledgeLinkResult)
});
export type KnowledgeLinksOutput = Schema.Schema.Type<typeof KnowledgeLinksOutput>;

export const OntologyTopicView = Schema.Literals(["facets", "concepts"]);
export type OntologyTopicView = Schema.Schema.Type<typeof OntologyTopicView>;

export const OntologyExpandMode = Schema.Literals(["exact", "descendants", "ancestors"]);
export type OntologyExpandMode = Schema.Schema.Type<typeof OntologyExpandMode>;

export const OntologyNodeKind = Schema.Literals(["canonical-topic", "concept"]);
export type OntologyNodeKind = Schema.Schema.Type<typeof OntologyNodeKind>;

export const OntologyListTopic = Schema.Struct({
  slug: Schema.String,
  kind: OntologyNodeKind,
  label: Schema.String,
  description: Schema.NullOr(Schema.String),
  canonicalTopicSlug: Schema.NullOr(TopicSlug),
  topConcept: Schema.Boolean,
  conceptSlugs: Schema.Array(Schema.String),
  parentSlugs: Schema.Array(Schema.String),
  childSlugs: Schema.Array(Schema.String),
  terms: Schema.Array(Schema.String),
  hashtags: Schema.Array(Schema.String),
  domains: Schema.Array(Schema.String)
});
export type OntologyListTopic = Schema.Schema.Type<typeof OntologyListTopic>;

export const ListTopicsInput = Schema.Struct({
  view: Schema.optionalKey(OntologyTopicView.annotate({ description: "Topic view: 'facets' for high-level categories, 'concepts' for fine-grained ontology nodes" }))
});
export type ListTopicsInput = Schema.Schema.Type<typeof ListTopicsInput>;

export const GetTopicInput = Schema.Struct({
  slug: Schema.String.pipe(Schema.check(Schema.isMinLength(1))).annotate({ description: "Topic slug to look up" })
});
export type GetTopicInput = Schema.Schema.Type<typeof GetTopicInput>;

export const ExpandTopicsInput = Schema.Struct({
  slugs: Schema.Array(Schema.String.pipe(Schema.check(Schema.isMinLength(1)))).annotate({ description: "Topic slugs to expand" }),
  mode: Schema.optionalKey(OntologyExpandMode.annotate({ description: "Expansion mode: 'exact' for direct matches, 'descendants' for narrower sub-topics, 'ancestors' for broader parent topics" }))
});
export type ExpandTopicsInput = Schema.Schema.Type<typeof ExpandTopicsInput>;

export const ExplainPostTopicsInput = Schema.Struct({
  postUri: PostUri.annotate({ description: "Post URI of the post to explain topic matches for" })
});
export type ExplainPostTopicsInput = Schema.Schema.Type<typeof ExplainPostTopicsInput>;

export const OntologyTopicsOutput = Schema.Struct({
  view: OntologyTopicView,
  items: Schema.Array(OntologyListTopic)
});
export type OntologyTopicsOutput = Schema.Schema.Type<typeof OntologyTopicsOutput>;

export const OntologyTopicOutput = Schema.Struct({
  item: Schema.NullOr(OntologyListTopic)
});
export type OntologyTopicOutput = Schema.Schema.Type<typeof OntologyTopicOutput>;

export const ExpandedTopicsOutput = Schema.Struct({
  mode: OntologyExpandMode,
  inputSlugs: Schema.Array(Schema.String),
  resolvedSlugs: Schema.Array(Schema.String),
  canonicalTopicSlugs: Schema.Array(TopicSlug),
  items: Schema.Array(OntologyListTopic)
});
export type ExpandedTopicsOutput = Schema.Schema.Type<typeof ExpandedTopicsOutput>;

export const StoredTopicMatch = Schema.Struct({
  postUri: PostUri,
  topicSlug: TopicSlug,
  matchedTerm: Schema.NullOr(Schema.String),
  matchSignal: MatchSignal,
  matchValue: Schema.NullOr(Schema.String),
  matchScore: Schema.NullOr(Schema.Number),
  ontologyVersion: Schema.String,
  matcherVersion: Schema.String
});
export type StoredTopicMatch = Schema.Schema.Type<typeof StoredTopicMatch>;

export const ExplainedPostTopic = Schema.Struct({
  postUri: PostUri,
  topicSlug: TopicSlug,
  topicLabel: Schema.String,
  conceptSlugs: Schema.Array(OntologyConceptSlug),
  matchedTerm: Schema.NullOr(Schema.String),
  matchSignal: MatchSignal,
  matchValue: Schema.NullOr(Schema.String),
  matchScore: Schema.NullOr(Schema.Number),
  ontologyVersion: Schema.String,
  matcherVersion: Schema.String
});
export type ExplainedPostTopic = Schema.Schema.Type<typeof ExplainedPostTopic>;

export const ExplainPostTopicsOutput = Schema.Struct({
  postUri: PostUri,
  items: Schema.Array(ExplainedPostTopic)
});
export type ExplainPostTopicsOutput = Schema.Schema.Type<typeof ExplainPostTopicsOutput>;

export const ExpertListOutput = Schema.Struct({
  items: Schema.Array(ExpertListItem)
});
export type ExpertListOutput = Schema.Schema.Type<typeof ExpertListOutput>;

export const AdminExpertResult = Schema.Struct({
  did: Did,
  handle: Schema.NullOr(Schema.String),
  displayName: Schema.NullOr(Schema.String),
  avatar: Schema.NullOr(HttpsUrl),
  domain: Schema.String,
  shard: Schema.Number,
  active: Schema.Boolean,
  source: ExpertSource,
  tier: ExpertTier.pipe(Schema.withDecodingDefaultKey(() => "independent" as const))
});
export type AdminExpertResult = Schema.Schema.Type<typeof AdminExpertResult>;

export const SetExpertActiveResult = Schema.Struct({
  did: Did,
  active: Schema.Boolean,
  shard: Schema.Number
});
export type SetExpertActiveResult = Schema.Schema.Type<typeof SetExpertActiveResult>;

export const BootstrapExpertsResult = Schema.Struct({
  domain: Schema.String,
  count: Schema.Number
});
export type BootstrapExpertsResult = Schema.Schema.Type<typeof BootstrapExpertsResult>;

export const LoadSmokeFixtureResult = Schema.Struct({
  posts: Schema.Number,
  links: Schema.Number,
  topics: Schema.Number
});
export type LoadSmokeFixtureResult = Schema.Schema.Type<typeof LoadSmokeFixtureResult>;

export const RefreshProfilesResult = Schema.Struct({
  updated: Schema.Number,
  failed: Schema.Number
});
export type RefreshProfilesResult = Schema.Schema.Type<typeof RefreshProfilesResult>;

export const RankedKnowledgePostResult = Schema.Struct({
  ...KnowledgePostResult.fields,
  rank: Schema.Number
});
export type RankedKnowledgePostResult = typeof RankedKnowledgePostResult.Type;

export class ExpertNotFoundError extends Schema.TaggedErrorClass<ExpertNotFoundError>()(
  "ExpertNotFoundError",
  {
    did: Did
  }
) {}

export class HandleResolutionError extends Schema.TaggedErrorClass<HandleResolutionError>()(
  "HandleResolutionError",
  {
    didOrHandle: Schema.String,
    message: Schema.String
  }
) {}

export class ProfileLookupError extends Schema.TaggedErrorClass<ProfileLookupError>()(
  "ProfileLookupError",
  {
    didOrHandle: Schema.String,
    message: Schema.String
  }
) {}

export class McpToolQueryError extends Schema.TaggedErrorClass<McpToolQueryError>()(
  "McpToolQueryError",
  {
    tool: Schema.String,
    message: Schema.String,
    error: Schema.Defect
  }
) {}

// ---------------------------------------------------------------------------
// Publications & Expert Tiers (Phase A — Foundation)
// ---------------------------------------------------------------------------

export const PublicationTier = Schema.Literals(["energy-focused", "general-outlet", "unknown"]);
export type PublicationTier = Schema.Schema.Type<typeof PublicationTier>;

export const PublicationSource = Schema.Literals(["seed", "discovered"]);
export type PublicationSource = Schema.Schema.Type<typeof PublicationSource>;

export const PublicationMedium = Schema.Literals(["text", "podcast"]);
export type PublicationMedium = Schema.Schema.Type<typeof PublicationMedium>;

const PublicationHostname = Schema.NullOr(Schema.String).pipe(
  Schema.withDecodingDefaultKey(() => null)
);

const PublicationShowSlug = Schema.NullOr(
  Schema.String.pipe(Schema.check(Schema.isMinLength(1)))
).pipe(
  Schema.withDecodingDefaultKey(() => null)
);

const PublicationFeedUrl = Schema.NullOr(Schema.String).pipe(
  Schema.withDecodingDefaultKey(() => null)
);

const PublicationExternalId = Schema.NullOr(
  Schema.NonEmptyString
).pipe(
  Schema.withDecodingDefaultKey(() => null)
);

const validatePublicationIdentity = (value: {
  readonly medium: PublicationMedium;
  readonly hostname: string | null;
  readonly showSlug: string | null;
  readonly feedUrl: string | null;
  readonly appleId: string | null;
  readonly spotifyId: string | null;
}) => {
  if (value.medium === "text") {
    if (value.hostname === null) {
      return "text publications require a hostname";
    }
    if (value.showSlug !== null) {
      return "text publications cannot define a show slug";
    }
    if (
      value.feedUrl !== null ||
      value.appleId !== null ||
      value.spotifyId !== null
    ) {
      return "text publications cannot define podcast metadata";
    }
    return undefined;
  }

  if (value.hostname !== null) {
    return "podcast publications cannot define a hostname";
  }
  if (value.showSlug === null) {
    return "podcast publications require a show slug";
  }

  return undefined;
};

const PublicationIdentityFields = {
  medium: PublicationMedium,
  hostname: PublicationHostname,
  showSlug: PublicationShowSlug,
  feedUrl: PublicationFeedUrl,
  appleId: PublicationExternalId,
  spotifyId: PublicationExternalId
} as const;

const PublicationSeedIdentityFields = {
  ...PublicationIdentityFields,
  medium: PublicationMedium.pipe(
    Schema.withDecodingDefaultKey(() => "text" as const)
  )
} as const;

export const PublicationSeed = Schema.Struct({
  ...PublicationSeedIdentityFields,
  tier: PublicationTier
}).pipe(
  Schema.check(Schema.makeFilter(validatePublicationIdentity))
);
export type PublicationSeed = Schema.Schema.Type<typeof PublicationSeed>;

export const PublicationSeedManifest = Schema.Struct({
  ontologyVersion: Schema.String,
  snapshotVersion: Schema.String,
  publications: Schema.Array(PublicationSeed)
});
export type PublicationSeedManifest = Schema.Schema.Type<typeof PublicationSeedManifest>;

export const PublicationRecord = Schema.Struct({
  publicationId: PublicationId,
  ...PublicationIdentityFields,
  tier: PublicationTier,
  source: PublicationSource,
  firstSeenAt: Schema.Number,
  lastSeenAt: Schema.Number
}).pipe(
  Schema.check(Schema.makeFilter(validatePublicationIdentity))
);
export type PublicationRecord = Schema.Schema.Type<typeof PublicationRecord>;

export const PublicationListItem = Schema.Struct({
  publicationId: PublicationId,
  ...PublicationIdentityFields,
  tier: PublicationTier,
  source: PublicationSource,
  postCount: Schema.Number,
  latestPostAt: Schema.NullOr(Schema.Number)
}).pipe(
  Schema.check(Schema.makeFilter(validatePublicationIdentity))
);
export type PublicationListItem = Schema.Schema.Type<typeof PublicationListItem>;

export const ListPublicationsInput = Schema.Struct({
  tier: Schema.optionalKey(PublicationTier),
  source: Schema.optionalKey(PublicationSource),
  limit: Schema.optionalKey(Schema.Number)
});
export type ListPublicationsInput = Schema.Schema.Type<typeof ListPublicationsInput>;

export const PublicationListOutput = Schema.Struct({
  items: Schema.Array(PublicationListItem)
});
export type PublicationListOutput = Schema.Schema.Type<typeof PublicationListOutput>;

export const SeedPublicationsResult = Schema.Struct({
  seeded: Schema.Number,
  snapshotVersion: Schema.String
});
export type SeedPublicationsResult = Schema.Schema.Type<typeof SeedPublicationsResult>;

// --- Thread expansion ---

export const GetPostThreadInput = Schema.Struct({
  postUri: AtUri.annotate({
    description: "AT Protocol URI of the post to get thread context for"
  }),
  depth: Schema.optionalKey(
    FlexibleNumber.pipe(Schema.check(Schema.isInt()), Schema.check(Schema.isBetween({ minimum: 0, maximum: 10 }))).annotate({
      description: "Reply depth levels to include (0-10, default 3)"
    })
  ),
  parentHeight: Schema.optionalKey(
    FlexibleNumber.pipe(Schema.check(Schema.isInt()), Schema.check(Schema.isBetween({ minimum: 0, maximum: 10 }))).annotate({
      description: "Parent context levels to include (0-10, default 3)"
    })
  )
});
export type GetPostThreadInput = Schema.Schema.Type<typeof GetPostThreadInput>;

export const ThreadPostPosition = Schema.Literals(["ancestor", "focus", "reply"]);
export type ThreadPostPosition = Schema.Schema.Type<typeof ThreadPostPosition>;

export const ThreadPostResult = Schema.Struct({
  uri: AtUri,
  did: Did,
  handle: Schema.NullOr(Schema.String),
  displayName: Schema.NullOr(Schema.String),
  text: Schema.String,
  createdAt: Schema.String,
  replyCount: Schema.NullOr(Schema.Number),
  repostCount: Schema.NullOr(Schema.Number),
  likeCount: Schema.NullOr(Schema.Number),
  quoteCount: Schema.NullOr(Schema.Number),
  position: ThreadPostPosition,
  depth: Schema.Number,
  parentUri: Schema.NullOr(AtUri),
  embedType: Schema.NullOr(ThreadEmbedType),
  embedContent: Schema.NullOr(EmbedPayload)
});
export type ThreadPostResult = Schema.Schema.Type<typeof ThreadPostResult>;

export const PostThreadOutput = Schema.Struct({
  focusUri: AtUri,
  ancestors: Schema.Array(ThreadPostResult),
  focus: ThreadPostResult,
  replies: Schema.Array(ThreadPostResult)
});
export type PostThreadOutput = Schema.Schema.Type<typeof PostThreadOutput>;

// --- Thread document (printer) ---

export const GetThreadDocumentInput = Schema.Struct({
  postUri: AtUri.annotate({
    description: "AT Protocol URI of the post to render as a document"
  }),
  depth: Schema.optionalKey(
    FlexibleNumber.pipe(Schema.check(Schema.isInt()), Schema.check(Schema.isBetween({ minimum: 0, maximum: 10 }))).annotate({
      description: "Reply depth levels to fetch from Bluesky API (0-10, default 3)"
    })
  ),
  parentHeight: Schema.optionalKey(
    FlexibleNumber.pipe(Schema.check(Schema.isInt()), Schema.check(Schema.isBetween({ minimum: 0, maximum: 10 }))).annotate({
      description: "Parent context levels to fetch (0-10, default 3)"
    })
  ),
  maxDepth: Schema.optionalKey(
    FlexibleNumber.pipe(Schema.check(Schema.isInt()), Schema.check(Schema.isBetween({ minimum: 1, maximum: 10 }))).annotate({
      description: "Max reply nesting depth to include in document (1-10)"
    })
  ),
  minLikes: Schema.optionalKey(
    FlexibleNumber.pipe(Schema.check(Schema.isInt()), Schema.check(Schema.isGreaterThanOrEqualTo(0))).annotate({
      description: "Minimum likes for a reply to be included"
    })
  ),
  topN: Schema.optionalKey(
    FlexibleNumber.pipe(Schema.check(Schema.isInt()), Schema.check(Schema.isBetween({ minimum: 1, maximum: 50 }))).annotate({
      description: "Keep only the N highest-engagement replies (1-50)"
    })
  )
});
export type GetThreadDocumentInput = Schema.Schema.Type<typeof GetThreadDocumentInput>;

export const ThreadDocumentOutput = Schema.Struct({
  title: Schema.String,
  postCount: Schema.Number,
  replyCount: Schema.Number,
  totalReplies: Schema.Number,
  body: Schema.String
});
export type ThreadDocumentOutput = Schema.Schema.Type<typeof ThreadDocumentOutput>;
