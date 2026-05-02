// RDF + SHACL primitives.
export { IRI, RdfError } from "./Domain/Rdf";
export type { RdfQuad } from "./Domain/Rdf";
export {
  ShaclValidationReport,
  ShaclViolation
} from "./Domain/Shacl";
export { RdfStoreService } from "./Service/RdfStore";
export { ShaclService } from "./Service/Shacl";

// Cross-package tagged errors (re-exported through Domain/Errors barrel).
export {
  AiSearchError,
  EntityGraphEndpointNotFoundError,
  EntityGraphLinkInvalidError,
  EntityGraphLinkNotFoundError,
  EntityGraphTraversalLimitError,
  EntityGraphTypeMismatchError,
  EntityNotFoundError,
  RdfMappingError
} from "./Domain/Errors";

// Per-entity ontology module contract. Every Expert/Organization/etc.
// module satisfies this structurally.
export {
  PredicateIri,
  asPredicateIri,
  defineEntity
} from "./Domain/EntityDefinition";
export type {
  AgentContextSpec,
  AnyEntityDefinition,
  EntityDefinition,
  EntityFact,
  IdentitySpec,
  OntologySpec,
  RelationDeclaration,
  RelationsSpec,
  RenderSpec,
  StorageAdapter
} from "./Domain/EntityDefinition";
export type { OntologyEntityModule } from "./Domain/OntologyEntity";
export {
  ENTITY_GRAPH_ALL_SCHEMA_STATEMENTS,
  ENTITY_GRAPH_SCHEMA_STATEMENTS,
  ENTITY_SNAPSHOT_SCHEMA_STATEMENTS,
  EntityIri,
  EntityLink,
  EntityRecord,
  EntitySnapshot,
  EntityTag,
  GraphIri,
  LinkEvidence,
  LinkId,
  REINDEX_QUEUE_SCHEMA_STATEMENTS,
  REINDEX_QUEUE_UPSERT_SET_CLAUSE,
  ReindexQueueItem,
  TripleHash,
  asEntityIri,
  asEntityTag
} from "./Domain/EntityGraph";
export type {
  AssertionKind,
  EntityLinkWithEvidence,
  LinkState,
  ReindexCause,
  ReviewState
} from "./Domain/EntityGraph";
export {
  PREDICATES,
  isPredicateTypeAllowed,
  predicateSpec
} from "./Domain/PredicateRegistry";
export type {
  ObjectOf,
  PredicateName,
  PredicateRegistry,
  PredicateSpec,
  SubjectOf,
  TypedLinkInput
} from "./Domain/PredicateRegistry";
export {
  ENTITY_METADATA_FIELDS,
  ProjectionMetadataDriftError,
  ProjectionWriteError,
  UNIFIED_METADATA_KEYS,
  assertNoMetadataDrift
} from "./Domain/Projection";
export type {
  EntityMetadata,
  EntityMetadataKey,
  ProjectionAdapter,
  ProjectionContract,
  ProjectionFixture,
  ProjectionRuntimeAdapter
} from "./Domain/Projection";
export {
  AiSearchClient,
  DEFAULT_ENTITY_SEARCH_INSTANCE,
  EntitySearchResultDecodeError,
  EntitySearchService,
  makeAiSearchAdapter,
  makeAiSearchClient
} from "./Service/AiSearchClient";
export type {
  AiSearchInstanceBinding,
  AiSearchItemInfo,
  AiSearchItemsBinding,
  AiSearchListItemsParams,
  AiSearchListItemsResponse,
  AiSearchMetadata,
  AiSearchMetadataValue,
  AiSearchNamespaceBinding,
  AiSearchSearchRequest,
  AiSearchSearchResponse,
  EntitySearchFilter,
  EntitySearchInput,
  EntitySearchResult
} from "./Service/AiSearchClient";
export {
  EntityContextHydrationError,
  EntityContextService
} from "./Service/EntityContext";
export type {
  EntityContext,
  EntityContextNeighbor,
  EntityContextOptions,
  RenderedEntityContextNode
} from "./Service/EntityContext";
export {
  optionalD1Database,
  runD1Batch,
  type D1DatabaseBinding,
  type D1PreparedStatementBinding
} from "./Service/D1Batch";
export {
  EntityGraphRepo
} from "./Service/EntityGraphRepo";
export { EntityGraphRepoD1 } from "./Service/EntityGraphRepoD1";
export type {
  LinkQueryOptions,
  NewLinkEvidence,
  TraversalPattern,
  TraversalResult
} from "./Service/EntityGraphRepo";
export {
  ENTITY_PROJECTION_DRAIN_DEFAULT_CONCURRENCY,
  ENTITY_PROJECTION_DRAIN_MAX_CONCURRENCY,
  EntityProjectionDrainItemError,
  EntityProjectionDrainService
} from "./Service/EntityProjectionDrain";
export type {
  EntityProjectionDrainOptions,
  EntityProjectionDrainResult
} from "./Service/EntityProjectionDrain";
export {
  EntityProjectionRegistry,
  EntityProjectionRegistryLookupError,
  defineEntityProjection
} from "./Service/EntityProjectionRegistry";
export type {
  EntityProjectionEntry,
  EntityProjectionSnapshotSpec
} from "./Service/EntityProjectionRegistry";
export {
  EntitySnapshotStore,
  EntitySnapshotStoreD1,
  entitySnapshotStorageAdapter,
  makeEntitySnapshotStorageAdapter
} from "./Service/EntitySnapshotStore";
export {
  EntityRegistry,
  EntityRegistryLookupError,
  makeEntityRegistry
} from "./Service/EntityRegistry";
export type { RegisteredEntity } from "./Service/EntityRegistry";
export {
  REINDEX_MAX_PROPAGATION_DEPTH,
  ReindexDepthExceededError,
  ReindexQueueService
} from "./Service/ReindexQueue";
export { ReindexQueueD1 } from "./Service/ReindexQueueD1";
export type { ReindexRequest } from "./Service/ReindexQueue";

// Generated ontology classes and branded IRI brands.
export {
  DataProviderRole,
  DataProviderRoleIri,
  EnergyExpertRole,
  EnergyExpertRoleIri,
  ExpertIri,
  OrganizationIri,
  PublisherRole,
  PublisherRoleIri
} from "./generated/agent";
export {
  Chart,
  ChartIri,
  Conversation,
  ConversationIri,
  EvidenceSource,
  EvidenceSourceIri,
  Excerpt,
  ExcerptIri,
  GenericImageAttachment,
  GenericImageAttachmentIri,
  MediaAttachment,
  MediaAttachmentIri,
  PodcastEpisode,
  PodcastEpisodeIri,
  PodcastSegment,
  PodcastSegmentIri,
  PostIri,
  Screenshot,
  ScreenshotIri,
  SocialThread,
  SocialThreadIri
} from "./generated/media";
export {
  CanonicalMeasurementClaim,
  CanonicalMeasurementClaimIri,
  ClaimTemporalWindow,
  ClaimTemporalWindowIri,
  Observation,
  ObservationIri,
  Series,
  SeriesIri,
  Variable,
  VariableIri
} from "./generated/measurement";
export {
  ENERGY_INTEL_CONCEPTS,
  ENERGY_INTEL_CONCEPTS_BY_IRI,
  ENERGY_INTEL_CONCEPT_SCHEMES
} from "./generated/concepts";
export type {
  EnergyIntelConcept,
  EnergyIntelConceptScheme
} from "./generated/concepts";

// Namespace constants used for triple construction outside the package.
export { BFO, EI, FOAF, IAO, OWL, RDF, RDFS, SKOS, XSD } from "./iris";

// Canonical Expert agent module. Phase E (Alchemy) and Phase F (services)
// reach through this surface rather than the private file path.
export {
  EXPERT_METADATA_KEYS,
  Expert,
  ExpertEntity,
  ExpertModule,
  ExpertProjection,
  ExpertProjectionFixture,
  ExpertUnifiedProjection,
  expertFromLegacyRow,
  expertFromTriples,
  expertFacts,
  expertToTriples
} from "./agent/expert";
export type {
  ExpertMetadata,
  ExpertMetadataKey,
  LegacyExpertRow
} from "./agent/expert";

export {
  Organization,
  OrganizationEntity,
  OrganizationProjectionFixture,
  OrganizationUnifiedProjection,
  organizationFacts,
  organizationFromTriples,
  organizationToTriples
} from "./agent/organization";

export {
  Post,
  PostEntity,
  PostProjectionFixture,
  PostUnifiedProjection,
  postFacts,
  postFromLegacyRow,
  postFromTriples,
  postIriFromAtUri,
  postTimeBucket,
  postToTriples,
  renderPostMarkdown,
  renderPostSummary
} from "./content/post";
export type { LegacyPostRow } from "./content/post";

export {
  EnergyTopic,
  EnergyTopicEntity,
  EnergyTopicIri,
  EnergyTopicProjectionFixture,
  EnergyTopicUnifiedProjection,
  energyTopicFacts,
  energyTopicFromTriples,
  energyTopicToTriples,
  renderEnergyTopicMarkdown,
  renderEnergyTopicSummary
} from "./concept/energy-topic";

export {
  ENERGY_INTEL_SEARCH_BINDING,
  ENERGY_INTEL_SEARCH_INSTANCE,
  ENERGY_INTEL_SEARCH_NAMESPACE,
  ENTITY_PROJECTION_FIXTURES,
  ENTITY_PROJECTION_SPECS,
  ENTITY_PROVISIONING,
  ENTITY_RUNTIME_CATALOG,
  ENTITY_RUNTIME_MODULES,
  ENTITY_SEARCH_CUSTOM_METADATA,
  ENTITY_SEARCH_PROVISIONING,
  EntityRuntimeCatalogError,
  MAX_AI_SEARCH_CUSTOM_METADATA_FIELDS,
  defineEntityRuntimeCatalog,
  defineEntityRuntimeModule,
  defineEntityProvisioning,
  defineUnifiedEntitySearchProvisioning
} from "./Provisioning";
export type {
  AiSearchCustomMetadataField,
  EntityRuntimeCatalog,
  EntityProvisioningPlan,
  EntityRuntimeModule,
  EntityRelationProvisioning
} from "./Provisioning";
