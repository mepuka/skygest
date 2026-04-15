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
import { WebUrl } from "../src/domain/data-layer/base";
import {
  DcatClass,
  DcatProperty,
  SchemaOrgType
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
 */
const PRIMARY_CLASS_IRI_FALLBACK: Partial<Record<ClassName, string>> = {
  Variable: "https://skygest.dev/vocab/energy/EnergyVariable",
  Series: "https://skygest.dev/vocab/energy/Series"
};

/**
 * WebUrl identity check — WebUrl is a `Schema.String` with a pattern
 * filter, NOT a branded type (see src/domain/types.ts). We can't detect
 * it via `brands`. Instead, we capture a reference to its filter's `run`
 * function at generator startup and compare run-function identity when
 * walking field ASTs.
 *
 * Why this works: `Schema.annotate(...)` on a Filter produces a new
 * Filter via `new Filter(this.run, newAnnotations)` — the `run` reference
 * is preserved. So any field annotated from `WebUrl.annotate({...})`
 * keeps the same closure reference in its last check.
 */
const WEB_URL_FILTER_RUN = ((): unknown => {
  const webUrlAst = WebUrl.ast;
  if (!webUrlAst.checks || webUrlAst.checks.length === 0) return undefined;
  const lastCheck = webUrlAst.checks[webUrlAst.checks.length - 1];
  // Filter instances have a `run` property; FilterGroup doesn't.
  return lastCheck && "run" in lastCheck
    ? (lastCheck as { run: unknown }).run
    : undefined;
})();

const isWebUrlAst = (ast: SchemaAST.AST): boolean => {
  if (ast._tag !== "String") return false;
  if (!ast.checks || ast.checks.length === 0) return false;
  if (WEB_URL_FILTER_RUN === undefined) return false;
  for (const check of ast.checks) {
    if (
      "run" in check &&
      (check as { run: unknown }).run === WEB_URL_FILTER_RUN
    ) {
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
    themes: deferredToIri,
    variableIds: { forceLossy: "derived-from-series" }
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
// Effect 4 stores schema annotations in one of two places:
//
//  - On `ast.annotations` (Base annotations), when `.annotate(...)` is
//    called while the AST has no checks (or before any `.pipe(Schema.check
//    (...))` runs).
//
//  - On the last check's annotations, when `.annotate(...)` is called
//    AFTER a check has been added (like Schema.brand on a branded type,
//    which itself stores the brand name under the "brands" key on the
//    last check's annotations).
//
// The runtime schemas in this codebase mix both patterns:
//
//   Agent = Schema.Struct({...}).annotate({[DcatClass]: "..."})
//     → DcatClass lives on Base (no checks on the Struct).
//
//   CatalogRecord = Schema.Struct({...}).annotate({[DcatClass]: "..."})
//                       .pipe(Schema.check(validator))
//     → DcatClass is on Base; the filter check has no annotations.
//       SchemaAST.resolve() would look at the last check and miss
//       DcatClass entirely.
//
//   AgentId = Schema.String.pipe(Schema.check(pattern), Schema.brand("AgentId"))
//   publisherAgentId = AgentId.annotate({[DcatProperty]: "..."})
//     → The pattern check is the last check; `.brand("AgentId")`
//       appends "brands" to its annotations; the subsequent
//       .annotate({DcatProperty: ...}) ALSO appends to the last check.
//       Base is empty.
//
// Correct reader: look at both Base annotations and the last check's
// annotations. Base wins on conflict (matches the "annotations before
// checks" pattern the class-level code uses).
// ---------------------------------------------------------------------------

type AnyAnnotations = Record<string | symbol, unknown>;

const getAllAnnotations = (ast: SchemaAST.AST): AnyAnnotations => {
  const base = (ast.annotations ?? {}) as AnyAnnotations;
  if (!ast.checks || ast.checks.length === 0) {
    return base;
  }
  const lastCheck = ast.checks[ast.checks.length - 1];
  const checkAnnotations = (lastCheck?.annotations ?? {}) as AnyAnnotations;
  return { ...checkAnnotations, ...base };
};

const getAnnotationString = (
  ast: SchemaAST.AST,
  key: symbol
): string | undefined => {
  const value = getAllAnnotations(ast)[key];
  return typeof value === "string" ? value : undefined;
};

const getClassIri = (ast: SchemaAST.AST): string | undefined =>
  getAnnotationString(ast, DcatClass);

const getSchemaOrgType = (ast: SchemaAST.AST): string | undefined =>
  getAnnotationString(ast, SchemaOrgType);

const getDcatProperty = (ast: SchemaAST.AST): string | undefined =>
  getAnnotationString(ast, DcatProperty);

const getBrandNames = (ast: SchemaAST.AST): ReadonlyArray<string> => {
  const value = getAllAnnotations(ast)["brands"];
  return Array.isArray(value) ? (value as ReadonlyArray<string>) : [];
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

const classifyField = (type: SchemaAST.AST): ClassifiedField => {
  const optional = SchemaAST.isOptional(type);

  // Arrays — recurse into rest[0] for the element type.
  if (SchemaAST.isArrays(type)) {
    if (type.elements.length !== 0 || type.rest.length !== 1) {
      throw new Error(
        `classifyField: unsupported Arrays shape (elements=${type.elements.length}, rest=${type.rest.length})`
      );
    }
    const element = type.rest[0];
    if (!element) {
      throw new Error("classifyField: Arrays.rest[0] is undefined");
    }
    const classified = classifyField(element);
    return { valueKind: classified.valueKind, cardinality: "many" };
  }

  const cardinality: Cardinality = optional ? "single-optional" : "single";

  // Union of Literal — treat as closed enum.
  if (SchemaAST.isUnion(type)) {
    const allLiterals = type.types.every((member) => SchemaAST.isLiteral(member));
    if (!allLiterals) {
      throw new Error(
        `classifyField: Union with non-Literal members (got ${type.types.map((m) => m._tag).join(",")})`
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
    return {
      valueKind: { _tag: "Literal", primitive: "string" },
      cardinality
    };
  }

  if (SchemaAST.isNumber(type)) {
    return {
      valueKind: { _tag: "Literal", primitive: "number" },
      cardinality
    };
  }

  if (SchemaAST.isBoolean(type)) {
    return {
      valueKind: { _tag: "Literal", primitive: "boolean" },
      cardinality
    };
  }

  throw new Error(`classifyField: unsupported AST kind '${type._tag}'`);
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
    catalogId: runtimeLocal(null),
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
    dataServiceIds: runtimeLocal([]),
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
    datasetId: runtimeLocal(null),
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
      const classified = classifyField(fieldType);
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
