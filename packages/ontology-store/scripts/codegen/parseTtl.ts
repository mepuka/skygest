/**
 * TTL → in-memory ClassTable parser.
 *
 * Stage 1 of the TTL → JSON Schema → Effect Schema codegen pipeline. Parses an
 * energy-intel TTL module into a typed table of classes, properties, and
 * prefix bindings. Downstream codegen stages (Task 7+) consume this table and
 * never touch the n3 Store directly.
 *
 * The parser deliberately defers cardinality / `owl:Restriction` parsing —
 * Task 7's JSON Schema builder defaults every property to optional + single,
 * which matches the slice scope. Cross-class object-property references are
 * left as raw IRIs (`range` is a string); resolution happens during JSON
 * Schema construction.
 *
 * Always uses explicit `format: "Turtle"` per project memory (n3.js' default
 * picks N3-superset and accepts non-Turtle constructs).
 */
import { Effect, Schema } from "effect";
import {
  DataFactory,
  Parser,
  Store,
  type NamedNode,
  type Quad_Subject,
  type Term
} from "n3";

const { namedNode } = DataFactory;

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const OWL_CLASS = "http://www.w3.org/2002/07/owl#Class";
const OWL_DATATYPE_PROPERTY = "http://www.w3.org/2002/07/owl#DatatypeProperty";
const OWL_OBJECT_PROPERTY = "http://www.w3.org/2002/07/owl#ObjectProperty";
const OWL_DISJOINT = "http://www.w3.org/2002/07/owl#disjointWith";
const RDFS_LABEL = "http://www.w3.org/2000/01/rdf-schema#label";
const RDFS_SUBCLASS = "http://www.w3.org/2000/01/rdf-schema#subClassOf";
const RDFS_DOMAIN = "http://www.w3.org/2000/01/rdf-schema#domain";
const RDFS_RANGE = "http://www.w3.org/2000/01/rdf-schema#range";
const SKOS_DEF = "http://www.w3.org/2004/02/skos/core#definition";

export const ClassProperty = Schema.Struct({
  iri: Schema.String,
  label: Schema.optionalKey(Schema.String),
  range: Schema.optionalKey(Schema.String),
  optional: Schema.Boolean,
  list: Schema.Boolean
});
export type ClassProperty = typeof ClassProperty.Type;

export const ClassRecord = Schema.Struct({
  iri: Schema.String,
  label: Schema.String,
  definition: Schema.optionalKey(Schema.String),
  superClasses: Schema.Array(Schema.String),
  disjointWith: Schema.Array(Schema.String),
  properties: Schema.Array(ClassProperty)
});
export type ClassRecord = typeof ClassRecord.Type;

export const ClassTable = Schema.Struct({
  classes: Schema.Array(ClassRecord),
  prefixes: Schema.Record(Schema.String, Schema.String)
});
export type ClassTable = typeof ClassTable.Type;

export class TtlParseError extends Schema.TaggedErrorClass<TtlParseError>()(
  "TtlParseError",
  {
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Unknown)
  }
) {}

const namedNodeOf = (iri: string): NamedNode => namedNode(iri);

const firstObjectValue = (
  store: Store,
  subject: Quad_Subject,
  predicate: string
): string | undefined => {
  const quads = store.getQuads(subject, namedNodeOf(predicate), null, null);
  return quads[0]?.object.value;
};

const objectValuesNamed = (
  store: Store,
  subject: Quad_Subject,
  predicate: string
): ReadonlyArray<string> =>
  store
    .getQuads(subject, namedNodeOf(predicate), null, null)
    .map((q) => q.object)
    .filter((o): o is NamedNode => o.termType === "NamedNode")
    .map((o) => o.value);

const isNamedSubject = (term: Term): term is NamedNode =>
  term.termType === "NamedNode";

interface MutableClassRecord {
  iri: string;
  label: string;
  definition: string | undefined;
  superClasses: ReadonlyArray<string>;
  disjointWith: ReadonlyArray<string>;
  properties: Array<ClassProperty>;
}

const finalizeClass = (cls: MutableClassRecord): ClassRecord =>
  cls.definition === undefined
    ? {
        iri: cls.iri,
        label: cls.label,
        superClasses: cls.superClasses,
        disjointWith: cls.disjointWith,
        properties: cls.properties
      }
    : {
        iri: cls.iri,
        label: cls.label,
        definition: cls.definition,
        superClasses: cls.superClasses,
        disjointWith: cls.disjointWith,
        properties: cls.properties
      };

export const parseTtlToClassTable = (
  ttl: string
): Effect.Effect<ClassTable, TtlParseError> =>
  Effect.try({
    try: (): ClassTable => {
      const prefixes: Record<string, string> = {};
      const parser = new Parser({ format: "Turtle" });
      const quads = parser.parse(ttl, null, (prefix, iri) => {
        prefixes[prefix] = iri.value;
      });
      const store = new Store(quads);

      // Stage A: collect named owl:Class subjects (skip blank-node restrictions).
      const mutable: Array<MutableClassRecord> = [];
      const classQuads = store.getQuads(
        null,
        namedNodeOf(RDF_TYPE),
        namedNodeOf(OWL_CLASS),
        null
      );
      for (const quad of classQuads) {
        const subj = quad.subject;
        if (!isNamedSubject(subj)) continue;
        const iri = subj.value;
        if (mutable.some((c) => c.iri === iri)) continue;
        const label = firstObjectValue(store, subj, RDFS_LABEL) ?? iri;
        const definition = firstObjectValue(store, subj, SKOS_DEF);
        const superClasses = objectValuesNamed(store, subj, RDFS_SUBCLASS);
        const disjointWith = objectValuesNamed(store, subj, OWL_DISJOINT);
        mutable.push({
          iri,
          label,
          definition,
          superClasses,
          disjointWith,
          properties: []
        });
      }

      // Stage B: walk owl:DatatypeProperty + owl:ObjectProperty subjects and
      // attach them to their declared rdfs:domain class. Cardinality is left
      // at the slice default (optional + single); Task 7 may revisit.
      for (const propType of [OWL_DATATYPE_PROPERTY, OWL_OBJECT_PROPERTY]) {
        const propQuads = store.getQuads(
          null,
          namedNodeOf(RDF_TYPE),
          namedNodeOf(propType),
          null
        );
        for (const propQuad of propQuads) {
          const propSubj = propQuad.subject;
          if (!isNamedSubject(propSubj)) continue;
          const propIri = propSubj.value;
          const label = firstObjectValue(store, propSubj, RDFS_LABEL);
          const range = firstObjectValue(store, propSubj, RDFS_RANGE);
          const domains = objectValuesNamed(store, propSubj, RDFS_DOMAIN);
          for (const domainIri of domains) {
            const domainClass = mutable.find((c) => c.iri === domainIri);
            if (!domainClass) continue;
            const property: ClassProperty =
              label === undefined
                ? range === undefined
                  ? { iri: propIri, optional: true, list: false }
                  : { iri: propIri, range, optional: true, list: false }
                : range === undefined
                  ? { iri: propIri, label, optional: true, list: false }
                  : { iri: propIri, label, range, optional: true, list: false };
            domainClass.properties.push(property);
          }
        }
      }

      return {
        classes: mutable.map(finalizeClass),
        prefixes
      };
    },
    catch: (cause) =>
      new TtlParseError({
        message: `TTL parse failed: ${String(cause)}`,
        cause
      })
  });
