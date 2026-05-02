/**
 * Parse ontology_skill SKOS concept-scheme TTLs into a small typed table.
 *
 * This is deliberately separate from parseTtlToClassTable: OWL classes become
 * Effect Schema classes, while SKOS concepts are ontology individuals that
 * feed classification, filtering, and graph edges.
 */
import { Effect, Schema } from "effect";
import { DataFactory, Parser, Store, type NamedNode, type Quad_Subject } from "n3";

const { namedNode } = DataFactory;

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const OWL_NAMED_INDIVIDUAL = "http://www.w3.org/2002/07/owl#NamedIndividual";
const RDFS_LABEL = "http://www.w3.org/2000/01/rdf-schema#label";
const SKOS_ALT_LABEL = "http://www.w3.org/2004/02/skos/core#altLabel";
const SKOS_BROADER = "http://www.w3.org/2004/02/skos/core#broader";
const SKOS_CONCEPT = "http://www.w3.org/2004/02/skos/core#Concept";
const SKOS_CONCEPT_SCHEME =
  "http://www.w3.org/2004/02/skos/core#ConceptScheme";
const SKOS_DEFINITION = "http://www.w3.org/2004/02/skos/core#definition";
const SKOS_HAS_TOP_CONCEPT =
  "http://www.w3.org/2004/02/skos/core#hasTopConcept";
const SKOS_IN_SCHEME = "http://www.w3.org/2004/02/skos/core#inScheme";
const SKOS_NARROWER = "http://www.w3.org/2004/02/skos/core#narrower";
const SKOS_PREF_LABEL = "http://www.w3.org/2004/02/skos/core#prefLabel";
const SKOS_TOP_CONCEPT_OF =
  "http://www.w3.org/2004/02/skos/core#topConceptOf";

export const SkosConceptRecord = Schema.Struct({
  iri: Schema.String,
  slug: Schema.String,
  label: Schema.String,
  altLabels: Schema.Array(Schema.String),
  definition: Schema.optionalKey(Schema.String),
  inScheme: Schema.optionalKey(Schema.String),
  topConcept: Schema.Boolean,
  broader: Schema.Array(Schema.String),
  narrower: Schema.Array(Schema.String)
});
export type SkosConceptRecord = typeof SkosConceptRecord.Type;

export const SkosConceptSchemeRecord = Schema.Struct({
  iri: Schema.String,
  slug: Schema.String,
  label: Schema.String,
  definition: Schema.optionalKey(Schema.String),
  topConcepts: Schema.Array(Schema.String)
});
export type SkosConceptSchemeRecord = typeof SkosConceptSchemeRecord.Type;

export const ConceptSchemeTable = Schema.Struct({
  concepts: Schema.Array(SkosConceptRecord),
  schemes: Schema.Array(SkosConceptSchemeRecord)
});
export type ConceptSchemeTable = typeof ConceptSchemeTable.Type;

export class ConceptSchemeParseError extends Schema.TaggedErrorClass<ConceptSchemeParseError>()(
  "ConceptSchemeParseError",
  {
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Unknown)
  }
) {}

const namedNodeOf = (iri: string): NamedNode => namedNode(iri);

const slugFromIri = (iri: string): string => {
  const hashIdx = iri.lastIndexOf("#");
  const tail =
    hashIdx >= 0 ? iri.slice(hashIdx + 1) : iri.slice(iri.lastIndexOf("/") + 1);
  return tail.length === 0 ? iri : tail;
};

const compareByIri = <T extends { readonly iri: string }>(left: T, right: T) =>
  left.iri.localeCompare(right.iri);

const uniqueSorted = (values: Iterable<string>): ReadonlyArray<string> =>
  Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));

const hasType = (store: Store, subject: Quad_Subject, typeIri: string): boolean =>
  store.getQuads(subject, namedNodeOf(RDF_TYPE), namedNodeOf(typeIri), null)
    .length > 0;

const literalValues = (
  store: Store,
  subject: Quad_Subject,
  predicate: string
): ReadonlyArray<string> =>
  store
    .getQuads(subject, namedNodeOf(predicate), null, null)
    .map((q) => q.object)
    .filter((o) => o.termType === "Literal")
    .map((o) => o.value);

const namedObjectValues = (
  store: Store,
  subject: Quad_Subject,
  predicate: string
): ReadonlyArray<string> =>
  store
    .getQuads(subject, namedNodeOf(predicate), null, null)
    .map((q) => q.object)
    .filter((o): o is NamedNode => o.termType === "NamedNode")
    .map((o) => o.value);

const firstLiteral = (
  store: Store,
  subject: Quad_Subject,
  predicates: ReadonlyArray<string>
): string | undefined => {
  for (const predicate of predicates) {
    const value = literalValues(store, subject, predicate)[0];
    if (value !== undefined) return value;
  }
  return undefined;
};

const namedSubjects = (store: Store): ReadonlyArray<NamedNode> =>
  uniqueSorted(
    store
      .getQuads(null, null, null, null)
      .map((q) => q.subject)
      .filter((subject): subject is NamedNode => subject.termType === "NamedNode")
      .map((subject) => subject.value)
  ).map(namedNodeOf);

export const parseConceptSchemeTtl = (
  ttl: string
): Effect.Effect<ConceptSchemeTable, ConceptSchemeParseError> =>
  Effect.try({
    try: () => {
      const parser = new Parser({ format: "Turtle" });
      const store = new Store(parser.parse(ttl));
      const concepts: Array<SkosConceptRecord> = [];
      const schemes: Array<SkosConceptSchemeRecord> = [];

      for (const subject of namedSubjects(store)) {
        if (hasType(store, subject, SKOS_CONCEPT)) {
          const label = firstLiteral(store, subject, [
            SKOS_PREF_LABEL,
            RDFS_LABEL
          ]);
          if (label === undefined) continue;
          const definition = firstLiteral(store, subject, [SKOS_DEFINITION]);
          const inScheme = namedObjectValues(store, subject, SKOS_IN_SCHEME)[0];
          concepts.push({
            iri: subject.value,
            slug: slugFromIri(subject.value),
            label,
            altLabels: uniqueSorted(literalValues(store, subject, SKOS_ALT_LABEL)),
            ...(definition === undefined ? {} : { definition }),
            ...(inScheme === undefined ? {} : { inScheme }),
            topConcept:
              namedObjectValues(store, subject, SKOS_TOP_CONCEPT_OF).length > 0,
            broader: uniqueSorted(namedObjectValues(store, subject, SKOS_BROADER)),
            narrower: uniqueSorted(namedObjectValues(store, subject, SKOS_NARROWER))
          });
        }

        if (
          hasType(store, subject, SKOS_CONCEPT_SCHEME) ||
          (hasType(store, subject, OWL_NAMED_INDIVIDUAL) &&
            namedObjectValues(store, subject, SKOS_HAS_TOP_CONCEPT).length > 0)
        ) {
          const label = firstLiteral(store, subject, [
            SKOS_PREF_LABEL,
            RDFS_LABEL
          ]);
          if (label === undefined) continue;
          const definition = firstLiteral(store, subject, [SKOS_DEFINITION]);
          schemes.push({
            iri: subject.value,
            slug: slugFromIri(subject.value),
            label,
            ...(definition === undefined ? {} : { definition }),
            topConcepts: uniqueSorted(
              namedObjectValues(store, subject, SKOS_HAS_TOP_CONCEPT)
            )
          });
        }
      }

      return {
        concepts: concepts.sort(compareByIri),
        schemes: schemes.sort(compareByIri)
      };
    },
    catch: (cause) =>
      new ConceptSchemeParseError({
        message: "Failed to parse SKOS concept-scheme Turtle",
        cause
      })
  });

export const mergeConceptSchemeTables = (
  tables: ReadonlyArray<ConceptSchemeTable>
): ConceptSchemeTable => {
  const concepts = new Map<string, SkosConceptRecord>();
  const schemes = new Map<string, SkosConceptSchemeRecord>();

  for (const table of tables) {
    for (const concept of table.concepts) {
      if (!concepts.has(concept.iri)) concepts.set(concept.iri, concept);
    }
    for (const scheme of table.schemes) {
      if (!schemes.has(scheme.iri)) schemes.set(scheme.iri, scheme);
    }
  }

  return {
    concepts: Array.from(concepts.values()).sort(compareByIri),
    schemes: Array.from(schemes.values()).sort(compareByIri)
  };
};
