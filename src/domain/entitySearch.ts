import { ENTITY_RUNTIME_CATALOG, EntityIri } from "@skygest/ontology-store";
import { Schema } from "effect";

const NonEmptyText = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1))
);

const runtimeEntityTypes = new Set<string>(ENTITY_RUNTIME_CATALOG.tags);

export const ONTOLOGY_ENTITY_TYPES = ENTITY_RUNTIME_CATALOG.tags;

export const SearchLimit = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(1)),
  Schema.check(Schema.isLessThanOrEqualTo(50))
).annotate({
  description: "Maximum number of ontology search hits to return"
});
export type SearchLimit = Schema.Schema.Type<typeof SearchLimit>;

export const OntologyEntityType = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value) =>
      runtimeEntityTypes.has(value)
        ? undefined
        : `unsupported ontology entity type: ${value}`
    )
  ),
  Schema.brand("OntologyEntityType")
).annotate({
  description: "Ontology runtime entity tag accepted by search_entities"
});
export type OntologyEntityType = Schema.Schema.Type<typeof OntologyEntityType>;

export const OntologyEntityIri = EntityIri.annotate({
  description: "Canonical ontology entity IRI"
});
export type OntologyEntityIri = EntityIri;

export const SearchEntityEvidenceKind = Schema.Literals([
  "iri",
  "chunk"
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
  source: Schema.optionalKey(OntologyEntityIri)
}).annotate({
  description: "Bounded read-side evidence for one canonical ontology entity hit"
});
export type SearchEntityEvidence = Schema.Schema.Type<
  typeof SearchEntityEvidence
>;

export const SearchEntityMatchReason = Schema.Literals([
  "exact-iri",
  "match"
]).annotate({
  description: "Public search_entities match explanation"
});
export type SearchEntityMatchReason = Schema.Schema.Type<
  typeof SearchEntityMatchReason
>;

export const SearchEntitiesInput = Schema.Struct({
  query: Schema.optionalKey(NonEmptyText),
  iri: Schema.optionalKey(OntologyEntityIri),
  entityTypes: Schema.optionalKey(Schema.Array(OntologyEntityType)),
  limit: Schema.optionalKey(SearchLimit),
  probes: Schema.optionalKey(Schema.Never),
  scope: Schema.optionalKey(Schema.Never),
  exactCanonicalUrls: Schema.optionalKey(Schema.Never),
  exactHostnames: Schema.optionalKey(Schema.Never),
  aliases: Schema.optionalKey(Schema.Never),
  urls: Schema.optionalKey(Schema.Never),
  hostnames: Schema.optionalKey(Schema.Never)
}).pipe(
  Schema.check(
    Schema.makeFilter((input) => {
      const hasQuery = input.query !== undefined;
      const hasIri = input.iri !== undefined;
      return hasQuery !== hasIri
        ? undefined
        : "exactly one of query or iri must be present";
    })
  )
).annotate({
  description:
    "Ontology search request. Query uses Cloudflare AI Search; exact IRI hydrates directly."
});
export type SearchEntitiesInput = Schema.Schema.Type<
  typeof SearchEntitiesInput
>;

export const SearchEntityHit = Schema.Struct({
  entityType: OntologyEntityType,
  iri: OntologyEntityIri,
  label: NonEmptyText,
  summary: Schema.optionalKey(NonEmptyText),
  rank: SearchLimit,
  score: Schema.Number,
  matchReason: SearchEntityMatchReason,
  evidence: Schema.Array(SearchEntityEvidence).pipe(
    Schema.check(Schema.isMaxLength(3))
  )
}).annotate({
  description: "Canonical hydrated ontology entity hit returned by search_entities"
});
export type SearchEntityHit = Schema.Schema.Type<typeof SearchEntityHit>;

export const SearchEntitiesResult = Schema.Struct({
  hits: Schema.Array(SearchEntityHit)
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
