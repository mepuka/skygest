/**
 * SKY-362 — generate-emit-spec.ts
 *
 * Build-time codegen for `packages/ontology-store/generated/emit-spec.json`.
 *
 * Reads the runtime Effect Schemas for the 9 DCAT domain classes and walks
 * their ASTs to produce the forward side of the EmitSpec mechanically.
 * Merges hand-authored reverse-side overrides from REVERSE_POLICY so distill
 * decisions (SubjectIri, Default, PredicateWithPrecedence) are explicit
 * policy, not mechanical inversion of emit.
 *
 * Run: `bun run gen:emit-spec`
 *
 * The script is NOT typechecked by any tsconfig — it runs via Bun directly.
 * It imports runtime Schemas from src/domain/data-layer/* and the output
 * schemas from packages/ontology-store/src/Domain/EmitSpec.ts for type
 * guidance only.
 */

import * as fs from "node:fs";
import * as nodePath from "node:path";
import { Schema, SchemaAST } from "effect";

import {
  Agent,
  Catalog,
  CatalogRecord,
  DataService,
  Dataset,
  DatasetSeries,
  Distribution
} from "../src/domain/data-layer/catalog";
import { Series, Variable } from "../src/domain/data-layer/variable";
import {
  DcatClass,
  DcatProperty,
  SchemaOrgType,
  WebUrlMarker,
  XsdDatatype as XsdDatatypeMarker
} from "../src/domain/data-layer/annotations";

import type {
  Cardinality,
  ClassEmitSpec,
  DistillFrom,
  EmitSpec as EmitSpecType,
  ForwardField,
  ReverseField,
  ValueKind
} from "../packages/ontology-store/src/Domain/EmitSpec";
import { EmitSpec } from "../packages/ontology-store/src/Domain/EmitSpec";

// ---------------------------------------------------------------------------
// IRI brand allowlist
//
// Any branded-string type whose value is a URI at runtime is emitted as an
// RDF IRI (NamedNode object). Everything else with a brand is a literal.
// ---------------------------------------------------------------------------

const IRI_BRAND_NAMES: ReadonlySet<string> = new Set([
  "AgentId",
  "CatalogId",
  "CatalogRecordId",
  "DataServiceId",
  "DatasetId",
  "DatasetSeriesId",
  "DistributionId",
  "SeriesId",
  "VariableId",
  "WebUrl",
  "IRI"
]);

// ---------------------------------------------------------------------------
// Class registry — the 9 DCAT domain classes in stable order.
// ---------------------------------------------------------------------------

const SCHEMAS = {
  Agent,
  Catalog,
  CatalogRecord,
  DataService,
  Dataset,
  DatasetSeries,
  Distribution,
  Variable,
  Series
} as const;

const CLASS_ORDER: ReadonlyArray<keyof typeof SCHEMAS> = [
  "Agent",
  "Catalog",
  "CatalogRecord",
  "DataService",
  "Dataset",
  "DatasetSeries",
  "Distribution",
  "Variable",
  "Series"
];

type ClassName = keyof typeof SCHEMAS;

/**
 * PRIMARY_CLASS_IRI_FALLBACK — Variable and Series are not DCAT classes
 * (the DCAT spec has no StatisticalVariable or SDMX Series concept). They
 * do not carry a `DcatClass` annotation in the runtime schemas, but the
 * data-layer-spine manifest pins their sevocab IRIs for RDF projection.
 * The generator uses this override when a class has no DcatClass.
 *
 * Introducing a separate `SevocabClass` annotation symbol would fragment
 * the annotation space; hardcoding here keeps the runtime schemas clean
 * and surfaces the override as an explicit generator decision.
 *
 * **Decision on open question #1 (skygest-internal governance):** for
 * milestone 1, sevocab-native classes (Variable, Series) use `sevocab:`
 * IRIs directly — `https://skygest.dev/vocab/energy/{EnergyVariable,
 * Series}`. We reserve `skygest-internal:` minting authority for a
 * future class that has no natural sevocab IRI and no clean external
 * IRI; re-open open question #1 at that point. See
 * `docs/plans/2026-04-15-sky-362-ontology-store-design.md`
 * §"Open questions" for the full rationale.
 */
const PRIMARY_CLASS_IRI_FALLBACK: Partial<Record<ClassName, string>> = {
  Variable: "https://skygest.dev/vocab/energy/EnergyVariable",
  Series: "https://skygest.dev/vocab/energy/Series"
};

/**
 * WebUrl detection — WebUrl is a `Schema.String` with a pattern filter,
 * NOT a branded type (see src/domain/types.ts). We identify it via the
 * `WebUrlMarker` annotation placed on the filter in types.ts. The marker
 * survives `.pipe(Schema.check(...))` compositions because it lives on
 * the filter itself, not on run-function identity.
 *
 * The walk inspects every check's annotations — not just the last —
 * so the marker is still detected when a field adds additional checks
 * via `WebUrl.pipe(Schema.check(...))` (not currently done, but robust).
 */
const isWebUrlAst = (ast: SchemaAST.AST): boolean => {
  if (ast._tag !== "String") return false;
  if (!ast.checks || ast.checks.length === 0) return false;
  for (const check of ast.checks) {
    const annotations = check.annotations as
      | Record<string | symbol, unknown>
      | undefined;
    if (annotations && annotations[WebUrlMarker] === true) {
      return true;
    }
  }
  return false;
};

// ---------------------------------------------------------------------------
// Field-level forward overrides
//
// Fields where the runtime Schema type is not enough to classify the RDF
// projection correctly. Two buckets:
//
//  - `forceValueKind`: coerce valueKind. Used for fields whose runtime
//    type is a plain string but whose value is an IRI at runtime (e.g.
//    CatalogRecord.primaryTopicId, which is a DatasetId or DataServiceId
//    URI but typed as Schema.String because the kind is disambiguated by
//    the sibling `primaryTopicType` discriminant).
//
//  - `forceLossy`: mark the field as lossy. Used for concept-valued
//    open-string facets (themes, measuredProperty, domainObject,
//    technologyOrFuel, policyInstrument) that ought to emit as IRIs from
//    a concept scheme but currently emit as string literals pending a
//    value-to-IRI policy decision. The lossy marker makes the deferred
//    policy visible to downstream consumers and to the round-trip test.
// ---------------------------------------------------------------------------

type FieldForwardOverride = {
  readonly forceValueKind?: ValueKind;
  readonly forceLossy?: "deferred-to-iri" | "derived-from-series";
};

type FieldForwardOverrides = {
  readonly [C in ClassName]?: Record<string, FieldForwardOverride>;
};

const deferredToIri: FieldForwardOverride = { forceLossy: "deferred-to-iri" };

const FIELD_FORWARD_OVERRIDES: FieldForwardOverrides = {
  CatalogRecord: {
    primaryTopicId: { forceValueKind: { _tag: "Iri" } }
  },
  Dataset: {
    themes: deferredToIri
    // NOTE: `variableIds` is NOT listed here. The field is denormalized
    // on Dataset but the source of truth is Series.datasetId + variableId,
    // so the lossy marker lives on the REVERSE side (see REVERSE_POLICY)
    // where the projection-parity comparator reads its ignore list from.
    // A forward-side `lossy: derived-from-series` would be dead annotation
    // surface — no consumer reads it.
  },
  DatasetSeries: {
    cadence: deferredToIri
  },
  Variable: {
    measuredProperty: deferredToIri,
    domainObject: deferredToIri,
    technologyOrFuel: deferredToIri,
    statisticType: deferredToIri,
    aggregation: deferredToIri,
    unitFamily: deferredToIri,
    policyInstrument: deferredToIri
  }
};

// ---------------------------------------------------------------------------
// AST annotation accessor
//
// Effect 4's `SchemaAST.resolve(ast)` returns annotations from the last
// check when checks are present, or from `ast.annotations` (Base)
// otherwise. All runtime schemas in this codebase are authored so that any
// `.annotate({...})` call that supplies DcatClass / DcatProperty /
// SchemaOrgType runs AFTER any `.pipe(Schema.check(...))` chain — so the
// annotation always lands where `resolve()` expects it.
//
// `Schema.Annotations.Annotations` is typed as `{[x: string]: unknown}` —
// the TypeScript signature doesn't permit symbol indexing, but at runtime
// the object is a plain JS record and symbol keys are legal. We cast
// through `AnyAnnotations` to reach the symbol-keyed DCAT annotations.
// ---------------------------------------------------------------------------

type AnyAnnotations = Record<string | symbol, unknown>;

const getAnnotations = (ast: SchemaAST.AST): AnyAnnotations =>
  (SchemaAST.resolve(ast) ?? {}) as AnyAnnotations;

const getAnnotationString = (
  ast: SchemaAST.AST,
  key: symbol
): string | undefined => {
  const value = getAnnotations(ast)[key];
  return typeof value === "string" ? value : undefined;
};

const getClassIri = (ast: SchemaAST.AST): string | undefined =>
  getAnnotationString(ast, DcatClass);

const getSchemaOrgType = (ast: SchemaAST.AST): string | undefined =>
  getAnnotationString(ast, SchemaOrgType);

const getDcatProperty = (ast: SchemaAST.AST): string | undefined =>
  getAnnotationString(ast, DcatProperty);

// SdmxConcept / DesignDecision — intentionally NOT read.
//
// The five annotation symbols on src/domain/data-layer/annotations.ts are:
//
//   PROJECTED to RDF by this generator:
//     - DcatClass           → primaryClassIri                (above)
//     - DcatProperty        → forward.fields[].predicate     (above)
//     - SchemaOrgType       → additionalClassIris[]          (above)
//     - XsdDatatype (below) → valueKind.xsdDatatype
//
//   NOT PROJECTED (non-projected in milestone 1):
//     - SdmxConcept    — SDMX lacks a single canonical IRI namespace for
//                        its information model (Concept, SeriesKey, etc.).
//                        Minting sevocab-local URIs for these now would
//                        pollute the neuro-symbolic alignment target
//                        (see project_neuro_symbolic_loop.md). The
//                        annotation stays on runtime Schemas so a future
//                        milestone can turn it on once the policy is locked.
//     - DesignDecision — documentation-only, traces runtime types back to
//                        the design-decision registry. No RDF meaning.
//
// If you need SDMX class membership to land in the graph, introduce a
// dedicated SDMX namespace policy (open question, deferred) rather than
// scattering sevocab-local SDMX IRIs here.

const getBrandNames = (ast: SchemaAST.AST): ReadonlyArray<string> => {
  const value = getAnnotations(ast)["brands"];
  return Array.isArray(value) ? (value as ReadonlyArray<string>) : [];
};

/**
 * Read the `XsdDatatype` marker from an AST node's annotations (set by
 * `src/domain/types.ts` on `DateLike` and `IsoTimestamp`).
 */
type XsdDatatypeLiteral =
  | "xsd:string"
  | "xsd:dateTime"
  | "xsd:date"
  | "xsd:integer"
  | "xsd:decimal"
  | "xsd:boolean";

const XSD_DATATYPE_VALUES: ReadonlySet<XsdDatatypeLiteral> = new Set([
  "xsd:string",
  "xsd:dateTime",
  "xsd:date",
  "xsd:integer",
  "xsd:decimal",
  "xsd:boolean"
]);

const getXsdDatatype = (ast: SchemaAST.AST): XsdDatatypeLiteral | undefined => {
  const value = getAnnotations(ast)[XsdDatatypeMarker];
  return typeof value === "string" && XSD_DATATYPE_VALUES.has(value as XsdDatatypeLiteral)
    ? (value as XsdDatatypeLiteral)
    : undefined;
};

// ---------------------------------------------------------------------------
// classifyField — walk a property-signature type AST and return its value
// kind + cardinality for the EmitSpec.
//
// Array detection: Schema.Array(X) compiles to an Arrays AST with
// elements=[] and rest=[X.ast]. Recurse into rest[0] for the element type.
//
// Brand detection: branded-string types store their brand name on the last
// check's `brands` annotation array. If any brand is in IRI_BRAND_NAMES
// we emit as IRI; otherwise as a plain literal.
//
// Union-of-Literal detection: Schema.Literals(["a","b"]) compiles to a
// Union whose members are all Literal AST nodes.
// ---------------------------------------------------------------------------

type ClassifiedField = {
  readonly valueKind: ValueKind;
  readonly cardinality: Cardinality;
};

/**
 * Field context string threaded into `classifyField` errors so they
 * point at the specific `Class.field` that failed. Unset only at the
 * top of the generator before we know which class we're in.
 */
type FieldContext = `${ClassName}.${string}` | "<unknown>";

const classifyField = (
  type: SchemaAST.AST,
  context: FieldContext
): ClassifiedField => {
  const optional = SchemaAST.isOptional(type);

  // Arrays — recurse into rest[0] for the element type.
  if (SchemaAST.isArrays(type)) {
    if (type.elements.length !== 0 || type.rest.length !== 1) {
      throw new Error(
        `classifyField(${context}): unsupported Arrays shape ` +
          `(elements=${type.elements.length}, rest=${type.rest.length})`
      );
    }
    const element = type.rest[0];
    if (!element) {
      throw new Error(`classifyField(${context}): Arrays.rest[0] is undefined`);
    }
    const classified = classifyField(element, context);
    return { valueKind: classified.valueKind, cardinality: "many" };
  }

  const cardinality: Cardinality = optional ? "single-optional" : "single";

  // Union of Literal — treat as closed enum.
  if (SchemaAST.isUnion(type)) {
    const allLiterals = type.types.every((member) => SchemaAST.isLiteral(member));
    if (!allLiterals) {
      throw new Error(
        `classifyField(${context}): Union with non-Literal members ` +
          `(got ${type.types.map((m) => m._tag).join(",")})`
      );
    }
    const values = type.types.map((member) => {
      const literal = member as SchemaAST.Literal;
      return String(literal.literal);
    });
    return {
      valueKind: { _tag: "EnumLiteral", values },
      cardinality
    };
  }

  // Literal (single literal value, e.g. Schema.Literal("Agent")) — treat as
  // a one-element enum. This shows up for _tag discriminants.
  if (SchemaAST.isLiteral(type)) {
    return {
      valueKind: { _tag: "EnumLiteral", values: [String(type.literal)] },
      cardinality
    };
  }

  // String — possibly branded as an IRI or carrying the WebUrl pattern.
  if (SchemaAST.isString(type)) {
    const brands = getBrandNames(type);
    if (brands.some((brand) => IRI_BRAND_NAMES.has(brand))) {
      return { valueKind: { _tag: "Iri" }, cardinality };
    }
    if (isWebUrlAst(type)) {
      return { valueKind: { _tag: "Iri" }, cardinality };
    }
    // Date-like filters carry an explicit XsdDatatype marker
    // (DateLike → xsd:date, IsoTimestamp → xsd:dateTime). Plain strings
    // default to xsd:string.
    const xsdDatatype = getXsdDatatype(type) ?? "xsd:string";
    return {
      valueKind: { _tag: "Literal", primitive: "string", xsdDatatype },
      cardinality
    };
  }

  if (SchemaAST.isNumber(type)) {
    // xsd:decimal is the broadest numeric xsd type — covers both
    // integer and decimal at the RDF level. Milestone 2 may split on
    // a marker when we need to distinguish integer from decimal for
    // per-field SHACL datatype constraints.
    const xsdDatatype = getXsdDatatype(type) ?? "xsd:decimal";
    return {
      valueKind: { _tag: "Literal", primitive: "number", xsdDatatype },
      cardinality
    };
  }

  if (SchemaAST.isBoolean(type)) {
    const xsdDatatype = getXsdDatatype(type) ?? "xsd:boolean";
    return {
      valueKind: { _tag: "Literal", primitive: "boolean", xsdDatatype },
      cardinality
    };
  }

  throw new Error(
    `classifyField(${context}): unsupported AST kind '${type._tag}'`
  );
};

// ---------------------------------------------------------------------------
// Reverse policy — hand-authored per-class overrides.
//
// Every field must land in one of three buckets at distill time:
//
//  1. Derive from a predicate the forward side emitted → `Predicate` or
//     `PredicateWithPrecedence`. The generator applies this DEFAULT when a
//     field has a DcatProperty annotation and no override in this policy.
//
//  2. Derive from the subject IRI itself → `SubjectIri`. Used for `id`
//     fields.
//
//  3. Inject a default on distill (runtime-local fields with no ontology
//     representation, or fields derived from other entities) → `Default`.
//
// Fields without a DcatProperty annotation and without an entry here will
// fail the generator — the failure surfaces schema drift.
// ---------------------------------------------------------------------------

type ReversePolicyEntry = {
  readonly distillFrom: DistillFrom;
  readonly lossy?: "runtime-local" | "set-order" | "derived-from-series";
};

type ReversePolicy = {
  readonly [C in ClassName]: Record<string, ReversePolicyEntry>;
};

const runtimeLocal = (
  defaultValue: unknown
): ReversePolicyEntry => ({
  distillFrom: { _tag: "Default", defaultValue },
  lossy: "runtime-local"
});

const subjectIri: ReversePolicyEntry = {
  distillFrom: { _tag: "SubjectIri" }
};

const tagLiteral = (tag: string): ReversePolicyEntry =>
  runtimeLocal(tag);

/**
 * Common "timestamped / aliased" runtime-local fields that live on every
 * class via `...TimestampedAliasedFields` spread (see
 * src/domain/data-layer/base.ts). These fields cannot be distilled from
 * RDF — they are reconstructed via injection at distill time.
 */
const timestampedAliasedPolicy: Record<string, ReversePolicyEntry> = {
  createdAt: runtimeLocal("<inject>"),
  updatedAt: runtimeLocal("<inject>"),
  aliases: runtimeLocal([])
};

const inverseEdge = (
  forwardOwnerClassIri: string,
  forwardPredicate: string
): ReversePolicyEntry => ({
  distillFrom: {
    _tag: "InverseEdge",
    forwardOwnerClassIri: forwardOwnerClassIri as DistillFrom extends {
      forwardOwnerClassIri: infer O;
    }
      ? O
      : never,
    forwardPredicate: forwardPredicate as DistillFrom extends {
      forwardPredicate: infer P;
    }
      ? P
      : never
  }
});

const REVERSE_POLICY: ReversePolicy = {
  Agent: {
    _tag: tagLiteral("Agent"),
    id: subjectIri,
    kind: runtimeLocal(null),
    parentAgentId: runtimeLocal(null),
    // `alternateNames` and `display-alias` may both produce skos:altLabel
    // literals on emit. The reverse attributes them to `alternateNames`
    // first and falls back to aliases for the `display-alias` form.
    alternateNames: {
      distillFrom: {
        _tag: "PredicateWithPrecedence",
        predicate: "http://www.w3.org/2004/02/skos/core#altLabel",
        precedence: "alternateNames-before-display-alias",
        conflictResolution: "preferFirst"
      }
    },
    ...timestampedAliasedPolicy
  },
  Catalog: {
    _tag: tagLiteral("Catalog"),
    id: subjectIri,
    ...timestampedAliasedPolicy
  },
  CatalogRecord: {
    _tag: tagLiteral("CatalogRecord"),
    id: subjectIri,
    // `catalogId` is now a plain forward predicate on CatalogRecord itself
    // (annotated with dcterms:isPartOf in src/domain/data-layer/catalog.ts).
    // The reverse side falls through to the default `Predicate` policy, so
    // no explicit entry is needed here.
    //
    // primaryTopicType is the string discriminant; it is NOT emitted and
    // must be reconstructed by the reverse mapping from the resolved
    // target entity's rdf:type.
    primaryTopicType: runtimeLocal("<derive-from-primary-topic-class>"),
    sourceRecordId: runtimeLocal(null),
    harvestedFrom: runtimeLocal(null),
    sourceModified: runtimeLocal(null),
    isAuthoritative: runtimeLocal(null),
    duplicateOf: runtimeLocal(null)
  },
  DataService: {
    _tag: tagLiteral("DataService"),
    id: subjectIri,
    accessRights: runtimeLocal(null),
    ...timestampedAliasedPolicy
  },
  Dataset: {
    _tag: tagLiteral("Dataset"),
    id: subjectIri,
    accessRights: runtimeLocal(null),
    // `dataServiceIds` has no forward predicate on Dataset — the canonical
    // DCAT edge runs DataService → Dataset via dcat:servesDataset. The
    // reverse walks that inverse direction: find every DataService whose
    // servesDataset includes this Dataset.
    dataServiceIds: inverseEdge(
      "http://www.w3.org/ns/dcat#DataService",
      "http://www.w3.org/ns/dcat#servesDataset"
    ),
    // variableIds is denormalized on forward but the source of truth for
    // Dataset→Variable membership is Series.datasetId + Series.variableId.
    // The reverse rebuilds it by walking Series edges at distill time.
    variableIds: {
      distillFrom: {
        _tag: "Default",
        defaultValue: "<derive-from-series>"
      },
      lossy: "derived-from-series"
    },
    ...timestampedAliasedPolicy
  },
  DatasetSeries: {
    _tag: tagLiteral("DatasetSeries"),
    id: subjectIri,
    ...timestampedAliasedPolicy
  },
  Distribution: {
    _tag: tagLiteral("Distribution"),
    id: subjectIri,
    // `datasetId` has no forward predicate on Distribution — the canonical
    // DCAT edge runs Dataset → Distribution via dcat:distribution. The
    // reverse walks the inverse direction: find the Dataset whose
    // distribution set includes this Distribution.
    datasetId: inverseEdge(
      "http://www.w3.org/ns/dcat#Dataset",
      "http://www.w3.org/ns/dcat#distribution"
    ),
    kind: runtimeLocal(null),
    accessRights: runtimeLocal(null),
    ...timestampedAliasedPolicy
  },
  Variable: {
    _tag: tagLiteral("Variable"),
    id: subjectIri,
    ...timestampedAliasedPolicy
  },
  Series: {
    _tag: tagLiteral("Series"),
    id: subjectIri,
    fixedDims: runtimeLocal({}),
    ...timestampedAliasedPolicy
  }
};

// ---------------------------------------------------------------------------
// Per-class generation
// ---------------------------------------------------------------------------

const generateClass = (name: ClassName): ClassEmitSpec => {
  const schema = SCHEMAS[name] as unknown as Schema.Top;
  const ast = schema.ast;

  if (ast._tag !== "Objects") {
    throw new Error(`${name}: expected Objects AST at top level, got ${ast._tag}`);
  }

  const primaryClassIri =
    getClassIri(ast) ?? PRIMARY_CLASS_IRI_FALLBACK[name];
  if (!primaryClassIri) {
    throw new Error(
      `${name}: missing DcatClass annotation and no PRIMARY_CLASS_IRI_FALLBACK entry`
    );
  }

  const schemaOrgType = getSchemaOrgType(ast);
  const additionalClassIris: ReadonlyArray<string> = schemaOrgType
    ? [schemaOrgType]
    : [];

  const policy = REVERSE_POLICY[name];
  const forwardFields: Array<ForwardField> = [];
  const reverseFields: Array<ReverseField> = [];

  for (const prop of ast.propertySignatures) {
    const fieldName = String(prop.name);
    const fieldType = prop.type;

    const dcatProperty = getDcatProperty(fieldType);
    const policyEntry = policy[fieldName];

    // --- Cardinality ---
    const optional = SchemaAST.isOptional(fieldType);
    const cardinality: Cardinality =
      SchemaAST.isArrays(fieldType) && fieldType.elements.length === 0 && fieldType.rest.length === 1
        ? "many"
        : optional
          ? "single-optional"
          : "single";

    // --- Forward side ---
    const forwardOverride = FIELD_FORWARD_OVERRIDES[name]?.[fieldName];
    if (dcatProperty) {
      const classified = classifyField(fieldType, `${name}.${fieldName}`);
      const valueKind = forwardOverride?.forceValueKind ?? classified.valueKind;
      const forwardField: ForwardField = {
        runtimeName: fieldName,
        predicate: dcatProperty as ForwardField["predicate"],
        valueKind,
        cardinality,
        ...(forwardOverride?.forceLossy
          ? { lossy: forwardOverride.forceLossy }
          : {})
      };
      forwardFields.push(forwardField);
    } else {
      forwardFields.push({
        runtimeName: fieldName,
        predicate: null,
        cardinality,
        skipEmit: true
      });
    }

    // --- Reverse side ---
    if (policyEntry) {
      reverseFields.push({
        runtimeName: fieldName,
        distillFrom: policyEntry.distillFrom,
        cardinality,
        ...(policyEntry.lossy ? { lossy: policyEntry.lossy } : {})
      });
    } else if (dcatProperty) {
      reverseFields.push({
        runtimeName: fieldName,
        distillFrom: {
          _tag: "Predicate",
          predicate: dcatProperty as DistillFrom extends { predicate: infer P } ? P : never
        },
        cardinality
      });
    } else {
      throw new Error(
        `${name}.${fieldName}: no DcatProperty annotation and no REVERSE_POLICY entry. ` +
          `Add it to REVERSE_POLICY or annotate the schema.`
      );
    }
  }

  // --- Generator self-check: no bad Default-null/branded-IRI pairings ---
  //
  // If a reverse field distills to `Default { defaultValue: null }` AND the
  // matching forward side emits it as an Iri-valued field, the phase-5
  // decode would fail because the runtime Schema's required branded ID
  // (AgentId, DatasetId, ...) rejects null. Surface the mistake at
  // generator time instead of letting it silently break the round-trip.
  for (const reverse of reverseFields) {
    if (
      reverse.distillFrom._tag === "Default" &&
      reverse.distillFrom.defaultValue === null
    ) {
      const forward = forwardFields.find(
        (f) => f.runtimeName === reverse.runtimeName
      );
      if (
        forward &&
        forward.predicate !== null &&
        forward.valueKind?._tag === "Iri" &&
        (forward.cardinality === "single" || forward.cardinality === "many")
      ) {
        throw new Error(
          `${name}.${reverse.runtimeName}: reverse distillFrom is Default(null) ` +
            `but forward emits an ${forward.cardinality} IRI. Phase 5 decode will ` +
            `fail because the runtime Schema rejects null. Use InverseEdge or a ` +
            `real forward predicate.`
        );
      }
    }
  }

  return {
    primaryClassIri: primaryClassIri as ClassEmitSpec["primaryClassIri"],
    additionalClassIris: additionalClassIris as ClassEmitSpec["additionalClassIris"],
    forward: { fields: forwardFields },
    reverse: {
      subjectSelector: {
        _tag: "TypedSubject",
        classIri: primaryClassIri as ClassEmitSpec["reverse"]["subjectSelector"]["classIri"]
      },
      fields: reverseFields
    }
  };
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const generateEmitSpec = (): EmitSpecType => {
  const classes: Record<string, ClassEmitSpec> = {};
  for (const name of CLASS_ORDER) {
    classes[name] = generateClass(name);
  }
  const spec: EmitSpecType = {
    version: "0.1.0",
    generatedFrom: "src/domain/data-layer/*.ts Schema ASTs",
    classes
  };

  // Validate the produced spec matches the EmitSpec schema — surfaces any
  // drift between the generator output and the runtime decoders.
  Schema.decodeUnknownSync(EmitSpec)(spec);
  return spec;
};

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const spec = generateEmitSpec();
  const outPath = nodePath.resolve(
    process.cwd(),
    "packages/ontology-store/generated/emit-spec.json"
  );
  fs.mkdirSync(nodePath.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(spec, null, 2)}\n`);
  // eslint-disable-next-line no-console
  console.log(`wrote ${outPath}`);
}
