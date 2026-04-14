import { Schema } from "effect";
import {
  AliasScheme,
  ExternalIdentifier
} from "./data-layer/alias";
import {
  AgentId,
  DatasetId,
  DistributionId,
  SeriesId,
  VariableId
} from "./data-layer/ids";

const NonEmptyText = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1))
);

export const SearchLimit = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(1))
).annotate({
  description: "Maximum number of ranked entity-search rows to return"
});
export type SearchLimit = Schema.Schema.Type<typeof SearchLimit>;

export const EntitySearchEntityType = Schema.Literals([
  "Agent",
  "Dataset",
  "Distribution",
  "Series",
  "Variable"
]).annotate({
  description: "Typed entity families exposed by the phase-1 entity-search corpus"
});
export type EntitySearchEntityType = Schema.Schema.Type<
  typeof EntitySearchEntityType
>;

export const EntitySearchEntityId = Schema.Union([
  AgentId,
  DatasetId,
  DistributionId,
  SeriesId,
  VariableId
]).annotate({
  description: "Canonical Skygest URI accepted by the typed entity-search index"
});
export type EntitySearchEntityId = Schema.Schema.Type<
  typeof EntitySearchEntityId
>;

export const EntitySearchUrl = NonEmptyText.annotate({
  description: "Canonical or source URL kept on a search document for exact URL probes"
});
export type EntitySearchUrl = Schema.Schema.Type<typeof EntitySearchUrl>;

export const EntitySearchHostname = NonEmptyText.annotate({
  description: "Normalized hostname used for exact and prefix URL probing"
});
export type EntitySearchHostname = Schema.Schema.Type<
  typeof EntitySearchHostname
>;

export const EntitySearchAlias = ExternalIdentifier.annotate({
  description:
    "Typed alias surfaced into the search projection for exact-match and lexical recall"
});
export type EntitySearchAlias = Schema.Schema.Type<typeof EntitySearchAlias>;

export const EntitySearchAliasScheme = AliasScheme;
export type EntitySearchAliasScheme = Schema.Schema.Type<
  typeof EntitySearchAliasScheme
>;

const entitySearchScopeFields = {
  publisherAgentId: Schema.optionalKey(AgentId),
  agentId: Schema.optionalKey(AgentId),
  datasetId: Schema.optionalKey(DatasetId),
  variableId: Schema.optionalKey(VariableId),
  seriesId: Schema.optionalKey(SeriesId),
  measuredProperty: Schema.optionalKey(NonEmptyText),
  domainObject: Schema.optionalKey(NonEmptyText),
  technologyOrFuel: Schema.optionalKey(NonEmptyText),
  statisticType: Schema.optionalKey(NonEmptyText),
  aggregation: Schema.optionalKey(NonEmptyText),
  unitFamily: Schema.optionalKey(NonEmptyText),
  policyInstrument: Schema.optionalKey(NonEmptyText),
  frequency: Schema.optionalKey(NonEmptyText),
  place: Schema.optionalKey(NonEmptyText),
  market: Schema.optionalKey(NonEmptyText),
  homepageHostname: Schema.optionalKey(EntitySearchHostname),
  landingPageHostname: Schema.optionalKey(EntitySearchHostname),
  accessHostname: Schema.optionalKey(EntitySearchHostname),
  downloadHostname: Schema.optionalKey(EntitySearchHostname)
} as const;

export const EntitySearchScope = Schema.Struct({
  ...entitySearchScopeFields
}).annotate({
  description:
    "Structured scope filters that narrow ranked retrieval without changing the underlying search corpus"
});
export type EntitySearchScope = Schema.Schema.Type<typeof EntitySearchScope>;

export const EntitySearchDocument = Schema.Struct({
  entityId: EntitySearchEntityId,
  entityType: EntitySearchEntityType,
  primaryLabel: NonEmptyText,
  secondaryLabel: Schema.optionalKey(NonEmptyText),
  aliases: Schema.Array(EntitySearchAlias),
  ...entitySearchScopeFields,
  canonicalUrls: Schema.Array(EntitySearchUrl),
  payloadJson: NonEmptyText,
  primaryText: NonEmptyText,
  aliasText: NonEmptyText,
  lineageText: NonEmptyText,
  urlText: NonEmptyText,
  ontologyText: NonEmptyText,
  semanticText: NonEmptyText,
  updatedAt: NonEmptyText
}).annotate({
  description:
    "Unified denormalized search document projected from one typed data-layer entity"
});
export type EntitySearchDocument = Schema.Schema.Type<
  typeof EntitySearchDocument
>;

export const EntitySearchQueryInput = Schema.Struct({
  query: Schema.optionalKey(NonEmptyText),
  entityTypes: Schema.optionalKey(Schema.Array(EntitySearchEntityType)),
  scope: Schema.optionalKey(EntitySearchScope),
  exactCanonicalUrls: Schema.optionalKey(Schema.Array(EntitySearchUrl)),
  exactHostnames: Schema.optionalKey(Schema.Array(EntitySearchHostname)),
  limit: Schema.optionalKey(SearchLimit)
}).annotate({
  description:
    "Generic typed entity-search query input supporting exact URL probes, hostname probes, and weighted lexical text"
});
export type EntitySearchQueryInput = Schema.Schema.Type<
  typeof EntitySearchQueryInput
>;

export const SearchAgentsInput = EntitySearchQueryInput.annotate({
  description: "Ranked search input for Agent retrieval"
});
export type SearchAgentsInput = Schema.Schema.Type<typeof SearchAgentsInput>;

export const SearchDatasetsInput = EntitySearchQueryInput.annotate({
  description: "Ranked search input for Dataset retrieval"
});
export type SearchDatasetsInput = Schema.Schema.Type<typeof SearchDatasetsInput>;

export const SearchDistributionsInput = EntitySearchQueryInput.annotate({
  description: "Ranked search input for Distribution retrieval"
});
export type SearchDistributionsInput = Schema.Schema.Type<
  typeof SearchDistributionsInput
>;

export const SearchSeriesInput = EntitySearchQueryInput.annotate({
  description: "Ranked search input for Series retrieval"
});
export type SearchSeriesInput = Schema.Schema.Type<typeof SearchSeriesInput>;

export const SearchVariablesInput = EntitySearchQueryInput.annotate({
  description: "Ranked search input for Variable retrieval"
});
export type SearchVariablesInput = Schema.Schema.Type<typeof SearchVariablesInput>;

export const EntitySearchMatchKind = Schema.Literals([
  "lexical",
  "exact-url",
  "exact-hostname",
  "semantic",
  "hybrid"
]).annotate({
  description:
    "How a ranked hit entered the candidate set before any downstream resolver validation"
});
export type EntitySearchMatchKind = Schema.Schema.Type<
  typeof EntitySearchMatchKind
>;

export const EntitySearchHit = Schema.Struct({
  document: EntitySearchDocument,
  score: Schema.Number,
  rank: SearchLimit,
  matchKind: EntitySearchMatchKind,
  snippet: Schema.NullOr(Schema.String)
}).annotate({
  description: "Ranked entity-search row returned by the lexical or hybrid candidate stage"
});
export type EntitySearchHit = Schema.Schema.Type<typeof EntitySearchHit>;

export const EntitySearchHits = Schema.Array(EntitySearchHit).annotate({
  description: "Ordered candidate list returned by one entity-search stage"
});
export type EntitySearchHits = Schema.Schema.Type<typeof EntitySearchHits>;

export const EntitySearchSemanticRecallInput = Schema.Struct({
  text: NonEmptyText,
  entityTypes: Schema.optionalKey(Schema.Array(EntitySearchEntityType)),
  scope: Schema.optionalKey(EntitySearchScope),
  limit: Schema.optionalKey(SearchLimit)
}).annotate({
  description:
    "Optional future semantic-recall request shape kept separate from lexical retrieval"
});
export type EntitySearchSemanticRecallInput = Schema.Schema.Type<
  typeof EntitySearchSemanticRecallInput
>;

export const EntitySearchSemanticRecallHit = Schema.Struct({
  entityId: EntitySearchEntityId,
  entityType: EntitySearchEntityType,
  score: Schema.Number
}).annotate({
  description:
    "Optional future semantic-recall hit shape that can be fused with lexical candidates"
});
export type EntitySearchSemanticRecallHit = Schema.Schema.Type<
  typeof EntitySearchSemanticRecallHit
>;

export const EntitySearchBundlePlan = Schema.Struct({
  exactCanonicalUrls: Schema.Array(EntitySearchUrl),
  exactHostnames: Schema.Array(EntitySearchHostname),
  publisherAgentId: Schema.optionalKey(AgentId),
  datasetId: Schema.optionalKey(DatasetId),
  variableId: Schema.optionalKey(VariableId),
  agentText: Schema.Array(NonEmptyText),
  datasetText: Schema.Array(NonEmptyText),
  distributionText: Schema.Array(NonEmptyText),
  seriesText: Schema.Array(NonEmptyText),
  variableText: Schema.Array(NonEmptyText)
}).annotate({
  description:
    "Bundle-derived search plan that turns post, URL, and chart evidence into typed entity-search requests"
});
export type EntitySearchBundlePlan = Schema.Schema.Type<
  typeof EntitySearchBundlePlan
>;

export const EntitySearchBundleCandidates = Schema.Struct({
  plan: EntitySearchBundlePlan,
  agents: EntitySearchHits,
  datasets: EntitySearchHits,
  distributions: EntitySearchHits,
  series: EntitySearchHits,
  variables: EntitySearchHits
}).annotate({
  description:
    "Typed grouped candidates produced from one evidence bundle after Stage 1 exact lookup has narrowed but not finished the resolution path"
});
export type EntitySearchBundleCandidates = Schema.Schema.Type<
  typeof EntitySearchBundleCandidates
>;
