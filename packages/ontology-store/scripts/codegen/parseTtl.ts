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
 * Equivalent-class restrictions of the BFO role-bearer shape
 * (`Foo ≡ Person ⊓ ∃bfo:bearerOf.Role`) are captured per class so Task 8 can
 * fold them into generated Effect schemas without re-parsing the n3 Store.
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
const RDF_FIRST = "http://www.w3.org/1999/02/22-rdf-syntax-ns#first";
const RDF_REST = "http://www.w3.org/1999/02/22-rdf-syntax-ns#rest";
const RDF_NIL = "http://www.w3.org/1999/02/22-rdf-syntax-ns#nil";
const OWL_CLASS = "http://www.w3.org/2002/07/owl#Class";
const OWL_RESTRICTION = "http://www.w3.org/2002/07/owl#Restriction";
const OWL_DATATYPE_PROPERTY = "http://www.w3.org/2002/07/owl#DatatypeProperty";
const OWL_OBJECT_PROPERTY = "http://www.w3.org/2002/07/owl#ObjectProperty";
const OWL_DISJOINT = "http://www.w3.org/2002/07/owl#disjointWith";
const OWL_EQUIVALENT_CLASS = "http://www.w3.org/2002/07/owl#equivalentClass";
const OWL_INTERSECTION_OF = "http://www.w3.org/2002/07/owl#intersectionOf";
const OWL_ON_PROPERTY = "http://www.w3.org/2002/07/owl#onProperty";
const OWL_SOME_VALUES_FROM = "http://www.w3.org/2002/07/owl#someValuesFrom";
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

export const EquivalentClassRestriction = Schema.Struct({
  onProperty: Schema.String,
  someValuesFrom: Schema.String
});
export type EquivalentClassRestriction =
  typeof EquivalentClassRestriction.Type;

export const ClassRecord = Schema.Struct({
  iri: Schema.String,
  label: Schema.String,
  definition: Schema.optionalKey(Schema.String),
  superClasses: Schema.Array(Schema.String),
  disjointWith: Schema.Array(Schema.String),
  equivalentClassRestrictions: Schema.Array(EquivalentClassRestriction),
  properties: Schema.Array(ClassProperty)
});
export type ClassRecord = typeof ClassRecord.Type;

export const ClassTable = Schema.Struct({
  classes: Schema.Array(ClassRecord),
  declaredProperties: Schema.optionalKey(Schema.Array(Schema.String)),
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

const subjectFromTerm = (term: Term): Quad_Subject | undefined =>
  term.termType === "NamedNode" || term.termType === "BlankNode"
    ? (term as Quad_Subject)
    : undefined;

/**
 * Walk an `owl:equivalentClass` chain and surface any
 * `owl:Restriction` nodes inside its `owl:intersectionOf` rdf:List.
 *
 * Targets the BFO role-bearer pattern used in agent.ttl:
 *   Foo ≡ Person ⊓ ∃bfo:bearerOf.Role
 * Non-restriction list members (e.g. `foaf:Person`) and malformed structures
 * are skipped silently — Task 8 only needs the restrictions, and the codegen
 * pipeline must not crash on TTL we don't recognise.
 */
const extractEquivalentRestrictions = (
  store: Store,
  namedSubject: NamedNode
): ReadonlyArray<EquivalentClassRestriction> => {
  const out: Array<EquivalentClassRestriction> = [];
  const equivQuads = store.getQuads(
    namedSubject,
    namedNodeOf(OWL_EQUIVALENT_CLASS),
    null,
    null
  );

  for (const equivQuad of equivQuads) {
    const equivSubject = subjectFromTerm(equivQuad.object);
    if (equivSubject === undefined) continue;

    const intersectionQuads = store.getQuads(
      equivSubject,
      namedNodeOf(OWL_INTERSECTION_OF),
      null,
      null
    );

    for (const intersectionQuad of intersectionQuads) {
      let listHead = subjectFromTerm(intersectionQuad.object);
      // Walk the rdf:List: rdf:first holds the member, rdf:rest the next cell
      // (terminated by rdf:nil). Cap iterations defensively to avoid a cycle
      // on malformed input.
      let safety = 0;
      while (
        listHead !== undefined &&
        listHead.termType === "BlankNode" &&
        safety < 1024
      ) {
        safety++;
        const firstQuads = store.getQuads(
          listHead,
          namedNodeOf(RDF_FIRST),
          null,
          null
        );
        const memberTerm = firstQuads[0]?.object;
        const member =
          memberTerm === undefined ? undefined : subjectFromTerm(memberTerm);
        if (member !== undefined) {
          const memberTypes = store
            .getQuads(member, namedNodeOf(RDF_TYPE), null, null)
            .map((q) => q.object)
            .filter((o): o is NamedNode => o.termType === "NamedNode")
            .map((o) => o.value);
          if (memberTypes.includes(OWL_RESTRICTION)) {
            const onProperty = firstObjectValue(
              store,
              member,
              OWL_ON_PROPERTY
            );
            const someValuesFrom = firstObjectValue(
              store,
              member,
              OWL_SOME_VALUES_FROM
            );
            if (onProperty !== undefined && someValuesFrom !== undefined) {
              out.push({ onProperty, someValuesFrom });
            }
          }
          // Non-restriction members (e.g. foaf:Person) are skipped silently.
        }

        const restQuads = store.getQuads(
          listHead,
          namedNodeOf(RDF_REST),
          null,
          null
        );
        const restTerm = restQuads[0]?.object;
        if (
          restTerm === undefined ||
          (restTerm.termType === "NamedNode" && restTerm.value === RDF_NIL)
        ) {
          listHead = undefined;
        } else {
          listHead = subjectFromTerm(restTerm);
        }
      }
    }
  }

  return out;
};

interface MutableClassRecord {
  iri: string;
  label: string;
  definition: string | undefined;
  superClasses: ReadonlyArray<string>;
  disjointWith: ReadonlyArray<string>;
  equivalentClassRestrictions: ReadonlyArray<EquivalentClassRestriction>;
  properties: Array<ClassProperty>;
}

const finalizeClass = (cls: MutableClassRecord): ClassRecord =>
  cls.definition === undefined
    ? {
        iri: cls.iri,
        label: cls.label,
        superClasses: cls.superClasses,
        disjointWith: cls.disjointWith,
        equivalentClassRestrictions: cls.equivalentClassRestrictions,
        properties: cls.properties
      }
    : {
        iri: cls.iri,
        label: cls.label,
        definition: cls.definition,
        superClasses: cls.superClasses,
        disjointWith: cls.disjointWith,
        equivalentClassRestrictions: cls.equivalentClassRestrictions,
        properties: cls.properties
      };

/**
 * Concatenate `classes` arrays and union `prefixes` records across
 * multiple ClassTables. Used by the codegen entrypoint to feed
 * `emitIrisModule` the union of every vendored TTL — running codegen
 * against `media` then must not drop `EI.Expert` from `iris.ts`.
 *
 * Duplicates by IRI inside `classes` are de-duped (first-seen wins
 * to keep the merge stable across module ordering); for `prefixes`,
 * later tables override earlier ones (later TTLs are assumed to ship
 * the latest prefix mappings, though in practice the vendored TTLs
 * use the same prefix set so this is rarely visible).
 *
 * Stable: iterating an empty input or a single-table input returns
 * a structurally-equivalent ClassTable so the codegen pipeline keeps
 * working when only one TTL is vendored.
 */
export const mergeClassTables = (
  tables: ReadonlyArray<ClassTable>
): ClassTable => {
  const classByIri = new Map<string, ClassRecord>();
  const declaredProperties = new Set<string>();
  const prefixes: Record<string, string> = {};
  for (const table of tables) {
    for (const cls of table.classes) {
      if (!classByIri.has(cls.iri)) classByIri.set(cls.iri, cls);
    }
    for (const property of table.declaredProperties ?? []) {
      declaredProperties.add(property);
    }
    for (const [prefix, iri] of Object.entries(table.prefixes)) {
      prefixes[prefix] = iri;
    }
  }
  return {
    classes: Array.from(classByIri.values()),
    declaredProperties: Array.from(declaredProperties).sort(),
    prefixes
  };
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
      // Map keyed by IRI gives O(1) dedup + O(1) lookup during property
      // attachment — the parser scales to ~300 classes for the full energy-intel
      // ontology.
      const classByIri = new Map<string, MutableClassRecord>();
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
        if (classByIri.has(iri)) continue;
        const label = firstObjectValue(store, subj, RDFS_LABEL) ?? iri;
        const definition = firstObjectValue(store, subj, SKOS_DEF);
        const superClasses = objectValuesNamed(store, subj, RDFS_SUBCLASS);
        const disjointWith = objectValuesNamed(store, subj, OWL_DISJOINT);
        const equivalentClassRestrictions = extractEquivalentRestrictions(
          store,
          subj
        );
        classByIri.set(iri, {
          iri,
          label,
          definition,
          superClasses,
          disjointWith,
          equivalentClassRestrictions,
          properties: []
        });
      }

      // Stage B: walk owl:DatatypeProperty + owl:ObjectProperty subjects and
      // attach them to their declared rdfs:domain class. Cardinality is left
      // at the slice default (optional + single); Task 7 may revisit.
      const declaredProperties = new Set<string>();
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
          declaredProperties.add(propIri);
          const label = firstObjectValue(store, propSubj, RDFS_LABEL);
          const range = firstObjectValue(store, propSubj, RDFS_RANGE);
          const domains = objectValuesNamed(store, propSubj, RDFS_DOMAIN);
          for (const domainIri of domains) {
            const domainClass = classByIri.get(domainIri);
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
        classes: Array.from(classByIri.values()).map(finalizeClass),
        declaredProperties: Array.from(declaredProperties).sort(),
        prefixes
      };
    },
    catch: (cause) =>
      new TtlParseError({
        message: `TTL parse failed: ${String(cause)}`,
        cause
      })
  });
