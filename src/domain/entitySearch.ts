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
  Schema.check(Schema.isGreaterThanOrEqualTo(1)),
  Schema.check(Schema.isLessThanOrEqualTo(50))
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

export const SearchEntitiesRequestedEntityType = Schema.Literals([
  "Agent",
  "Dataset",
  "Distribution",
  "Series",
  "Variable",
  "Catalog",
  "CatalogRecord",
  "DatasetSeries",
  "DataService"
]).annotate({
  description:
    "Entity families accepted by search_entities. Deferred families fail closed until projection and hydration exist."
});
export type SearchEntitiesRequestedEntityType = Schema.Schema.Type<
  typeof SearchEntitiesRequestedEntityType
>;

export const EntitySearchAliasProbe = Schema.Struct({
  scheme: AliasScheme,
  value: NonEmptyText
}).annotate({
  description: "Structured alias probe for exact search_entities lookup"
});
export type EntitySearchAliasProbe = Schema.Schema.Type<
  typeof EntitySearchAliasProbe
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
  "exact-iri",
  "exact-url",
  "exact-hostname",
  "exact-alias",
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

export const SearchEntityEvidenceKind = Schema.Literals([
  "iri",
  "url",
  "hostname",
  "alias",
  "label",
  "snippet",
  "semantic-chunk"
]).annotate({
  description:
    "Read-side evidence explanation for search_entities results; not graph-edge provenance"
});
export type SearchEntityEvidenceKind = Schema.Schema.Type<
  typeof SearchEntityEvidenceKind
>;

export const SearchEntityEvidenceText = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.check(Schema.isMaxLength(240))
).annotate({
  description: "Bounded evidence text returned by search_entities"
});
export type SearchEntityEvidenceText = Schema.Schema.Type<
  typeof SearchEntityEvidenceText
>;

export const SearchEntityEvidence = Schema.Struct({
  kind: SearchEntityEvidenceKind,
  text: SearchEntityEvidenceText,
  source: Schema.optionalKey(
    Schema.Union([
      EntitySearchEntityId,
      EntitySearchUrl,
      EntitySearchHostname
    ])
  )
}).annotate({
  description: "Bounded read-side evidence for one canonical entity hit"
});
export type SearchEntityEvidence = Schema.Schema.Type<
  typeof SearchEntityEvidence
>;

export const SearchEntityProbe = Schema.Struct({
  iris: Schema.optionalKey(Schema.Array(EntitySearchEntityId)),
  urls: Schema.optionalKey(Schema.Array(EntitySearchUrl)),
  hostnames: Schema.optionalKey(Schema.Array(EntitySearchHostname)),
  aliases: Schema.optionalKey(Schema.Array(EntitySearchAliasProbe))
}).annotate({
  description: "Structured exact probes accepted by search_entities"
});
export type SearchEntityProbe = Schema.Schema.Type<typeof SearchEntityProbe>;

export const SearchEntityMatchReason = Schema.Literals([
  "exact-iri",
  "exact-url",
  "exact-hostname",
  "exact-alias",
  "keyword",
  "semantic",
  "hybrid"
]).annotate({
  description: "Public search_entities match explanation"
});
export type SearchEntityMatchReason = Schema.Schema.Type<
  typeof SearchEntityMatchReason
>;

const hasProbeValues = (probe: SearchEntityProbe | undefined) =>
  probe !== undefined &&
  ((probe.iris?.length ?? 0) > 0 ||
    (probe.urls?.length ?? 0) > 0 ||
    (probe.hostnames?.length ?? 0) > 0 ||
    (probe.aliases?.length ?? 0) > 0);

export const SearchEntitiesInput = Schema.Struct({
  query: Schema.optionalKey(NonEmptyText),
  entityTypes: Schema.optionalKey(Schema.Array(SearchEntitiesRequestedEntityType)),
  scope: Schema.optionalKey(EntitySearchScope),
  probes: Schema.optionalKey(SearchEntityProbe),
  limit: Schema.optionalKey(SearchLimit)
}).pipe(
  Schema.check(
    Schema.makeFilter((input) =>
      input.query === undefined && !hasProbeValues(input.probes)
        ? "at least one of query or probes must be present"
        : undefined
    )
  )
).annotate({
  description:
    "Operator/internal canonical entity search request with exact probes and optional recall query"
});
export type SearchEntitiesInput = Schema.Schema.Type<
  typeof SearchEntitiesInput
>;

export const SearchEntitiesWarning = Schema.Struct({
  entityType: SearchEntitiesRequestedEntityType,
  reason: Schema.Literal("not-yet-enabled")
}).annotate({
  description: "Fail-closed warning for deferred entity families"
});
export type SearchEntitiesWarning = Schema.Schema.Type<
  typeof SearchEntitiesWarning
>;

export const SearchEntityHit = Schema.Struct({
  entityType: EntitySearchEntityType,
  iri: EntitySearchEntityId,
  label: NonEmptyText,
  summary: Schema.optionalKey(NonEmptyText),
  rank: SearchLimit,
  score: Schema.Number,
  matchReason: SearchEntityMatchReason,
  evidence: Schema.Array(SearchEntityEvidence).pipe(
    Schema.check(Schema.isMaxLength(3))
  )
}).annotate({
  description: "Canonical hydrated entity hit returned by search_entities"
});
export type SearchEntityHit = Schema.Schema.Type<typeof SearchEntityHit>;

export const SearchEntitiesResult = Schema.Struct({
  hits: Schema.Array(SearchEntityHit),
  warnings: Schema.optionalKey(Schema.Array(SearchEntitiesWarning))
}).annotate({
  description: "Canonical search_entities response"
});
export type SearchEntitiesResult = Schema.Schema.Type<
  typeof SearchEntitiesResult
>;

export class EntitySearchIndexError extends Schema.TaggedErrorClass<EntitySearchIndexError>()(
  "EntitySearchIndexError",
  {
    message: Schema.String,
    operation: Schema.String
  }
) {}

export class EntityTypeNotEnabledError extends Schema.TaggedErrorClass<EntityTypeNotEnabledError>()(
  "EntityTypeNotEnabledError",
  {
    entityType: SearchEntitiesRequestedEntityType
  }
) {}

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
