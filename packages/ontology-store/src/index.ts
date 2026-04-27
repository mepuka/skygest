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
export { RdfMappingError } from "./Domain/Errors";

// Per-entity ontology module contract. Every Expert/Organization/etc.
// module satisfies this structurally.
export type { OntologyEntityModule } from "./Domain/OntologyEntity";

// Generated branded IRI brands for the agent module. Keep this list
// conservative — only re-export what consumers reach for.
export {
  DataProviderRoleIri,
  EnergyExpertRoleIri,
  ExpertIri,
  OrganizationIri,
  PublisherRoleIri
} from "./generated/agent";

// Namespace constants used for triple construction outside the package.
export { BFO, EI, FOAF, OWL, RDF, RDFS, SKOS, XSD } from "./iris";

// Canonical Expert agent module. Phase E (Alchemy) and Phase F (services)
// reach through this surface rather than the private file path.
export {
  EXPERT_METADATA_KEYS,
  Expert,
  ExpertModule,
  ExpertProjection,
  expertFromLegacyRow,
  expertFromTriples,
  expertToTriples
} from "./agent/expert";
export type {
  ExpertMetadata,
  ExpertMetadataKey,
  LegacyExpertRow
} from "./agent/expert";
