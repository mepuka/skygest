import { Schema } from "effect";
import { AtUri, Did } from "./types";

export const TopicSlug = Schema.String.pipe(
  Schema.minLength(1),
  Schema.brand("TopicSlug")
);
export type TopicSlug = Schema.Schema.Type<typeof TopicSlug>;

export const OntologyConceptSlug = Schema.String.pipe(
  Schema.minLength(1),
  Schema.brand("OntologyConceptSlug")
);
export type OntologyConceptSlug = Schema.Schema.Type<typeof OntologyConceptSlug>;

export const ExpertSource = Schema.Literal("manual", "starter_pack", "list", "network");
export type ExpertSource = Schema.Schema.Type<typeof ExpertSource>;

export const ExpertSeed = Schema.Struct({
  did: Did,
  handle: Schema.optional(Schema.String),
  displayName: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  source: ExpertSource,
  sourceRef: Schema.optional(Schema.String),
  active: Schema.optionalWith(Schema.Boolean, { default: () => true })
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
  domain: Schema.String,
  source: ExpertSource,
  sourceRef: Schema.NullOr(Schema.String),
  shard: Schema.Number,
  active: Schema.Boolean,
  addedAt: Schema.Number,
  lastSyncedAt: Schema.NullOr(Schema.Number)
});
export type ExpertRecord = Schema.Schema.Type<typeof ExpertRecord>;

export const ExpertListItem = Schema.Struct({
  did: Did,
  handle: Schema.NullOr(Schema.String),
  displayName: Schema.NullOr(Schema.String),
  domain: Schema.String,
  source: ExpertSource,
  active: Schema.Boolean
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
  description: Schema.NullOr(Schema.String)
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

export const MatchSignal = Schema.Literal("term", "hashtag", "domain");
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
  domain: Schema.NullOr(Schema.String),
  extractedAt: Schema.Number
});
export type LinkRecord = Schema.Schema.Type<typeof LinkRecord>;

export const KnowledgePost = Schema.Struct({
  uri: AtUri,
  did: Did,
  cid: Schema.NullOr(Schema.String),
  text: Schema.String,
  createdAt: Schema.Number,
  indexedAt: Schema.Number,
  hasLinks: Schema.Boolean,
  status: Schema.Literal("active", "deleted"),
  ingestId: Schema.String,
  topics: Schema.Array(MatchedTopic),
  links: Schema.Array(LinkRecord)
});
export type KnowledgePost = Schema.Schema.Type<typeof KnowledgePost>;

export const DeletedKnowledgePost = Schema.Struct({
  uri: AtUri,
  did: Did,
  cid: Schema.NullOr(Schema.String),
  createdAt: Schema.Number,
  indexedAt: Schema.Number,
  ingestId: Schema.String
});
export type DeletedKnowledgePost = Schema.Schema.Type<typeof DeletedKnowledgePost>;

export const SearchPostsInput = Schema.Struct({
  query: Schema.String,
  topic: Schema.optional(Schema.String),
  since: Schema.optional(Schema.Number),
  limit: Schema.optional(Schema.Number)
});
export type SearchPostsInput = Schema.Schema.Type<typeof SearchPostsInput>;

export const GetRecentPostsInput = Schema.Struct({
  topic: Schema.optional(Schema.String),
  expertDid: Schema.optional(Did),
  since: Schema.optional(Schema.Number),
  limit: Schema.optional(Schema.Number)
});
export type GetRecentPostsInput = Schema.Schema.Type<typeof GetRecentPostsInput>;

export const GetPostLinksInput = Schema.Struct({
  domain: Schema.optional(Schema.String),
  topic: Schema.optional(Schema.String),
  since: Schema.optional(Schema.Number),
  limit: Schema.optional(Schema.Number)
});
export type GetPostLinksInput = Schema.Schema.Type<typeof GetPostLinksInput>;

export const SearchPostsQueryInput = Schema.Struct({
  query: Schema.String,
  topicSlugs: Schema.optional(Schema.Array(TopicSlug)),
  since: Schema.optional(Schema.Number),
  limit: Schema.optional(Schema.Number)
});
export type SearchPostsQueryInput = Schema.Schema.Type<typeof SearchPostsQueryInput>;

export const GetRecentPostsQueryInput = Schema.Struct({
  topicSlugs: Schema.optional(Schema.Array(TopicSlug)),
  expertDid: Schema.optional(Did),
  since: Schema.optional(Schema.Number),
  limit: Schema.optional(Schema.Number)
});
export type GetRecentPostsQueryInput = Schema.Schema.Type<typeof GetRecentPostsQueryInput>;

export const GetPostLinksQueryInput = Schema.Struct({
  domain: Schema.optional(Schema.String),
  topicSlugs: Schema.optional(Schema.Array(TopicSlug)),
  since: Schema.optional(Schema.Number),
  limit: Schema.optional(Schema.Number)
});
export type GetPostLinksQueryInput = Schema.Schema.Type<typeof GetPostLinksQueryInput>;

export const ListExpertsInput = Schema.Struct({
  domain: Schema.optional(Schema.String),
  active: Schema.optional(Schema.Boolean),
  limit: Schema.optional(Schema.Number)
});
export type ListExpertsInput = Schema.Schema.Type<typeof ListExpertsInput>;

export const AddExpertInput = Schema.Struct({
  didOrHandle: Schema.String.pipe(Schema.minLength(1)),
  domain: Schema.optional(Schema.String),
  active: Schema.optional(Schema.Boolean)
});
export type AddExpertInput = Schema.Schema.Type<typeof AddExpertInput>;

export const SetExpertActiveInput = Schema.Struct({
  active: Schema.Boolean
});
export type SetExpertActiveInput = Schema.Schema.Type<typeof SetExpertActiveInput>;

export const KnowledgePostResult = Schema.Struct({
  uri: AtUri,
  did: Did,
  handle: Schema.NullOr(Schema.String),
  text: Schema.String,
  createdAt: Schema.Number,
  topics: Schema.Array(Schema.String)
});
export type KnowledgePostResult = Schema.Schema.Type<typeof KnowledgePostResult>;

export const KnowledgeLinkResult = Schema.Struct({
  postUri: AtUri,
  url: Schema.String,
  domain: Schema.NullOr(Schema.String),
  title: Schema.NullOr(Schema.String),
  description: Schema.NullOr(Schema.String),
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

export const OntologyTopicView = Schema.Literal("facets", "concepts");
export type OntologyTopicView = Schema.Schema.Type<typeof OntologyTopicView>;

export const OntologyExpandMode = Schema.Literal("exact", "descendants", "ancestors");
export type OntologyExpandMode = Schema.Schema.Type<typeof OntologyExpandMode>;

export const OntologyNodeKind = Schema.Literal("canonical-topic", "concept");
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
  view: Schema.optional(OntologyTopicView)
});
export type ListTopicsInput = Schema.Schema.Type<typeof ListTopicsInput>;

export const GetTopicInput = Schema.Struct({
  slug: Schema.String.pipe(Schema.minLength(1))
});
export type GetTopicInput = Schema.Schema.Type<typeof GetTopicInput>;

export const ExpandTopicsInput = Schema.Struct({
  slugs: Schema.Array(Schema.String.pipe(Schema.minLength(1))),
  mode: Schema.optional(OntologyExpandMode)
});
export type ExpandTopicsInput = Schema.Schema.Type<typeof ExpandTopicsInput>;

export const ExplainPostTopicsInput = Schema.Struct({
  postUri: AtUri
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
  postUri: AtUri,
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
  postUri: AtUri,
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
  postUri: AtUri,
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
  domain: Schema.String,
  shard: Schema.Number,
  active: Schema.Boolean,
  source: ExpertSource
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

export class ExpertNotFoundError extends Schema.TaggedError<ExpertNotFoundError>()(
  "ExpertNotFoundError",
  {
    did: Did
  }
) {}

export class HandleResolutionError extends Schema.TaggedError<HandleResolutionError>()(
  "HandleResolutionError",
  {
    didOrHandle: Schema.String,
    message: Schema.String
  }
) {}

export class ProfileLookupError extends Schema.TaggedError<ProfileLookupError>()(
  "ProfileLookupError",
  {
    didOrHandle: Schema.String,
    message: Schema.String
  }
) {}

export class McpToolQueryError extends Schema.TaggedError<McpToolQueryError>()(
  "McpToolQueryError",
  {
    tool: Schema.String,
    message: Schema.String,
    error: Schema.Defect
  }
) {}
