import { Schema } from "effect";

import { IRI } from "./Rdf";

/**
 * The EmitSpec is the application-profile graph seam contract: a
 * versioned, explicitly-authored mapping from the 9 DCAT domain classes
 * to their RDF projection and back. Two sections per class:
 *
 * - `forward` — how a runtime instance becomes N3 Quads
 * - `reverse` — how those Quads become a runtime instance again
 *
 * Distill is NOT mechanical inversion of emit. Subject selection,
 * collision resolution, default injection, and id reconstruction from
 * the subject IRI are policy decisions declared here per-class.
 *
 * This file defines the schemas. `scripts/generate-emit-spec.ts` produces
 * the committed `packages/ontology-store/generated/emit-spec.json` file,
 * which `mapping/forward.ts` and `mapping/reverse.ts` decode at runtime.
 */

// ---------------------------------------------------------------------------
// ValueKind — how a runtime field value is encoded into the RDF graph.
//
// The tag drives per-field value encoding in `mapping/forward.ts`. Every
// field that has a non-null forward predicate has exactly one ValueKind.
// ---------------------------------------------------------------------------

export const LiteralPrimitive = Schema.Literals(["string", "number", "boolean"]);
export type LiteralPrimitive = Schema.Schema.Type<typeof LiteralPrimitive>;

/**
 * XSD datatypes the forward mapper may attach to RDF literals. The set is
 * intentionally narrow — expand it when a new runtime type (e.g. an
 * xsd:duration branded string) needs to round-trip.
 */
export const XsdDatatype = Schema.Literals([
  "xsd:string",
  "xsd:dateTime",
  "xsd:date",
  "xsd:integer",
  "xsd:decimal",
  "xsd:boolean"
]);
export type XsdDatatype = Schema.Schema.Type<typeof XsdDatatype>;

export const ValueKind = Schema.Union([
  /**
   * Plain literal value (string, number, boolean) serialized as an
   * xsd-typed RDF literal. The `xsdDatatype` field names the specific
   * `xsd:*` URI the forward mapper attaches to the N3 literal object
   * and the SHACL `sh:datatype` constraint reads back.
   */
  Schema.Struct({
    _tag: Schema.Literal("Literal"),
    primitive: LiteralPrimitive,
    xsdDatatype: XsdDatatype
  }),
  /**
   * IRI value. The runtime field holds a URL or a branded-ID URI; it is
   * emitted as a NamedNode object.
   */
  Schema.Struct({
    _tag: Schema.Literal("Iri")
  }),
  /**
   * Closed enum serialized as an xsd:string literal for now. Milestone 2
   * may extend this to `EnumMapping` with a per-value-to-IRI table; for
   * now the generator flags value-to-IRI policy as deferred.
   */
  Schema.Struct({
    _tag: Schema.Literal("EnumLiteral"),
    values: Schema.Array(Schema.String)
  })
]);
export type ValueKind = Schema.Schema.Type<typeof ValueKind>;

// ---------------------------------------------------------------------------
// Cardinality — single / many / single-optional.
//
// Drives forward emission (how many triples to produce per entity) and
// reverse distill (how to aggregate quads back into a runtime value).
// ---------------------------------------------------------------------------

export const Cardinality = Schema.Literals([
  "single",
  "single-optional",
  "many"
]);
export type Cardinality = Schema.Schema.Type<typeof Cardinality>;

// ---------------------------------------------------------------------------
// ForwardField — per-field forward policy.
//
// Fields without a `predicate` (or with `skipEmit: true`) are dropped
// during forward emission. Runtime-local fields (`_tag`, `id`, closed
// enums not owned by an ontology property) fall into that bucket.
// ---------------------------------------------------------------------------

export const ForwardField = Schema.Struct({
  runtimeName: Schema.String,
  predicate: Schema.NullOr(IRI),
  valueKind: Schema.optionalKey(ValueKind),
  cardinality: Cardinality,
  skipEmit: Schema.optionalKey(Schema.Boolean),
  /**
   * Lossy marker for fields where value-to-IRI resolution is deferred
   * (e.g. open-string facets like `Dataset.themes` — emitted as literals
   * with a policy note that they should become IRIs in a later milestone).
   */
  lossy: Schema.optionalKey(
    Schema.Literals(["deferred-to-iri", "derived-from-series"])
  )
});
export type ForwardField = Schema.Schema.Type<typeof ForwardField>;

// ---------------------------------------------------------------------------
// DistillFrom — per-field reverse policy.
//
// Every runtime-local field that is lost during forward emit must be
// reconstructed with a default on distill. Every field that is derived
// from a different entity (like Dataset.variableIds from Series edges)
// needs an explicit policy. The reverse section is hand-authored where
// it diverges from the default "pull by predicate."
// ---------------------------------------------------------------------------

export const DistillFrom = Schema.Union([
  /**
   * The runtime field value is the subject IRI of the distilled entity
   * itself. Used for `id` fields. Non-lossy.
   */
  Schema.Struct({
    _tag: Schema.Literal("SubjectIri")
  }),
  /**
   * Pull all objects of this predicate for the subject. Default policy
   * for most ontology-owned fields.
   */
  Schema.Struct({
    _tag: Schema.Literal("Predicate"),
    predicate: IRI
  }),
  /**
   * Pull objects of a predicate that multiple forward fields may have
   * written. `precedence` names which forward field wins attribution.
   * Used for `alternateNames` vs `display-alias` collisions on
   * skos:altLabel.
   */
  Schema.Struct({
    _tag: Schema.Literal("PredicateWithPrecedence"),
    predicate: IRI,
    precedence: Schema.String,
    conflictResolution: Schema.String
  }),
  /**
   * Reconstruct this field by walking the INVERSE direction of a forward
   * edge emitted by a different class. Used for relationships whose
   * canonical DCAT predicate lives on the other side of the edge:
   *
   * - `Distribution.datasetId` — walk `dcat:distribution` triples whose
   *   object is this Distribution and take the subject (Dataset).
   * - `Dataset.dataServiceIds` — walk `dcat:servesDataset` triples whose
   *   object is this Dataset and take every subject (DataService).
   *
   * The reverse mapping queries the RdfStore for triples matching
   * `(?s, forwardPredicate, currentSubject)` and assigns the subjects
   * of those triples to the field. The `forwardOwnerClassIri` names the
   * class whose forward section emits the predicate; the reverse mapper
   * uses it to type-filter the subjects (`?s rdf:type forwardOwnerClassIri`)
   * when the store contains mixed data. Non-lossy.
   */
  Schema.Struct({
    _tag: Schema.Literal("InverseEdge"),
    forwardOwnerClassIri: IRI,
    forwardPredicate: IRI
  }),
  /**
   * The field has no predicate to pull from; inject a default on distill.
   * Used for runtime-local fields (`createdAt`, `updatedAt`, `accessRights`)
   * and for fields derived from other entities (`Dataset.variableIds`
   * derived from Series.datasetId + Series.variableId).
   *
   * Use `null` as the `defaultValue` for optional fields; an empty array
   * for set-valued fields; a sentinel `<inject>` literal for fields where
   * the reverse mapping layer must compute the value at distill time.
   */
  Schema.Struct({
    _tag: Schema.Literal("Default"),
    defaultValue: Schema.Unknown
  })
]);
export type DistillFrom = Schema.Schema.Type<typeof DistillFrom>;

// ---------------------------------------------------------------------------
// ReverseField — per-field reverse policy entry.
//
// The projection-parity comparator in the round-trip test reads its
// ignore list from this file's `lossy` markers — not from a hardcoded
// allow-list in the test. That keeps the lossy boundary visible.
// ---------------------------------------------------------------------------

export const ReverseField = Schema.Struct({
  runtimeName: Schema.String,
  distillFrom: DistillFrom,
  cardinality: Cardinality,
  lossy: Schema.optionalKey(
    Schema.Literals(["runtime-local", "set-order", "derived-from-series"])
  )
});
export type ReverseField = Schema.Schema.Type<typeof ReverseField>;

// ---------------------------------------------------------------------------
// SubjectSelector — how the reverse mapping finds instance roots in the
// RDF store. Milestone 1 uses the class IRI as the only selection rule:
// every subject with `rdf:type <primaryClassIri>` is projected back into
// an instance of the class.
// ---------------------------------------------------------------------------

export const SubjectSelector = Schema.Struct({
  _tag: Schema.Literal("TypedSubject"),
  classIri: IRI
});
export type SubjectSelector = Schema.Schema.Type<typeof SubjectSelector>;

// ---------------------------------------------------------------------------
// ClassEmitSpec — the per-class contract with explicit forward + reverse.
// ---------------------------------------------------------------------------

export const ClassEmitSpec = Schema.Struct({
  primaryClassIri: IRI,
  additionalClassIris: Schema.Array(IRI),
  forward: Schema.Struct({
    fields: Schema.Array(ForwardField)
  }),
  reverse: Schema.Struct({
    subjectSelector: SubjectSelector,
    fields: Schema.Array(ReverseField)
  })
});
export type ClassEmitSpec = Schema.Schema.Type<typeof ClassEmitSpec>;

// ---------------------------------------------------------------------------
// EmitSpec — top-level committed artifact. Produced by
// `scripts/generate-emit-spec.ts`, consumed by `mapping/forward.ts` and
// `mapping/reverse.ts`. The round-trip test also decodes this file to
// source the lossy-field ignore list.
//
// The `classes` field is an explicit 9-key Struct rather than an open
// Record. The generator produces exactly these 9 DCAT domain classes
// today and any schema drift — an added or removed class — should fail
// loudly at decode time instead of silently flowing through the pipeline.
// ---------------------------------------------------------------------------

export const EmitSpecClassKey = Schema.Literals([
  "Agent",
  "Catalog",
  "CatalogRecord",
  "DataService",
  "Dataset",
  "DatasetSeries",
  "Distribution",
  "Variable",
  "Series"
]);
export type EmitSpecClassKey = Schema.Schema.Type<typeof EmitSpecClassKey>;

export const EmitSpec = Schema.Struct({
  version: Schema.String,
  generatedFrom: Schema.String,
  classes: Schema.Struct({
    Agent: ClassEmitSpec,
    Catalog: ClassEmitSpec,
    CatalogRecord: ClassEmitSpec,
    DataService: ClassEmitSpec,
    Dataset: ClassEmitSpec,
    DatasetSeries: ClassEmitSpec,
    Distribution: ClassEmitSpec,
    Variable: ClassEmitSpec,
    Series: ClassEmitSpec
  })
});
export type EmitSpec = Schema.Schema.Type<typeof EmitSpec>;
