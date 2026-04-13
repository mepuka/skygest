import { Schema } from "effect";
import { IsoTimestamp } from "./types";

// ---------------------------------------------------------------------------
// SKY-321 — DataLayerSpineManifest contract
//
// This schema is the load-bearing input contract for the ontology-driven
// structural code generator introduced in SKY-320. Its job is to describe
// the ontology-owned spine of the runtime data-layer classes (Agent,
// Dataset, Variable, Series) in a form the runtime repo can consume
// without parsing Turtle directly.
//
// Locked design choices (SKY-321):
// - The runtime repo consumes JSON manifests, not raw Turtle.
// - The generated/runtime boundary is fragment composition: each class
//   contributes an `*OntologyFields` fragment that hand-authored wrappers
//   compose, rather than a fully generated end-to-end struct.
// - Runtime field names stay exactly as they are today (camelCase) — the
//   manifest records them verbatim and tests lock drift.
// - Series.datasetId is explicitly optional in manifest v1 — SKY-317 will
//   backfill it and a later ticket will tighten it to required after the
//   runtime registry migration settles.
// - Derived relationships (like sevocab:hasVariable) may be described in
//   the manifest, but their resolution is not a runtime reasoning
//   concern: SPARQL consumers traverse hasSeries + implementsVariable
//   explicitly, and the runtime consumes the manifest's structural
//   fragments directly.
// ---------------------------------------------------------------------------

const NonEmptyString = Schema.String.pipe(Schema.check(Schema.isMinLength(1)));

/**
 * IRI reference (full URI). Typed as NonEmptyString at the manifest layer —
 * the generator is responsible for producing well-formed IRIs.
 */
const IriString = NonEmptyString;

// ---------------------------------------------------------------------------
// Branded-ID reference — names a concrete branded ID schema from
// src/domain/data-layer/ids.ts that the generator should emit.
// ---------------------------------------------------------------------------

export const SpineBrandedIdRef = Schema.Literals([
  "AgentId",
  "CatalogId",
  "CatalogRecordId",
  "DataServiceId",
  "DatasetId",
  "DatasetSeriesId",
  "DistributionId",
  "SeriesId",
  "VariableId"
]);
export type SpineBrandedIdRef = Schema.Schema.Type<typeof SpineBrandedIdRef>;

// ---------------------------------------------------------------------------
// Scalar literal kinds — everything that maps onto a primitive JS value in
// the emitted Schema.Struct.
// ---------------------------------------------------------------------------

export const SpineLiteralKind = Schema.Literals([
  "string",
  "number",
  "boolean"
]);
export type SpineLiteralKind = Schema.Schema.Type<typeof SpineLiteralKind>;

// ---------------------------------------------------------------------------
// Field type — discriminated on _tag. The generator consumes these to
// produce the matching Schema.* call in the generated fragment.
//
// Kinds:
// - brandedId / brandedIdArray: references into ids.ts
// - literal / literalArray:     primitive scalars
// - closedEnum / closedEnumArray: Schema.Literals enums defined elsewhere
//   in the runtime (e.g. AgentKind, Cadence)
// - struct: references a named runtime struct schema (e.g. FixedDims)
// - webUrl / dateLike / isoTimestamp: the three branded refinements
//   defined in src/domain/types.ts and re-exported through data-layer/base
// ---------------------------------------------------------------------------

export const SpineFieldType = Schema.TaggedUnion({
  brandedId: { ref: SpineBrandedIdRef },
  brandedIdArray: { ref: SpineBrandedIdRef },
  literal: { literalKind: SpineLiteralKind },
  literalArray: { literalKind: SpineLiteralKind },
  closedEnum: { enumName: NonEmptyString },
  closedEnumArray: { enumName: NonEmptyString },
  struct: { structName: NonEmptyString },
  webUrl: {},
  dateLike: {},
  isoTimestamp: {}
});
export type SpineFieldType = Schema.Schema.Type<typeof SpineFieldType>;

// ---------------------------------------------------------------------------
// Generation mode — which side of the fragment/wrapper boundary owns the
// field. `generated` fields live in the ontology-owned fragment produced
// by the SKY-320 generator; `handWritten` fields stay in the hand-authored
// runtime file and are recorded here for boundary clarity only.
// ---------------------------------------------------------------------------

export const SpineFieldGenerationMode = Schema.Literals([
  "generated",
  "handWritten"
]);
export type SpineFieldGenerationMode = Schema.Schema.Type<
  typeof SpineFieldGenerationMode
>;

// ---------------------------------------------------------------------------
// Per-field specification.
// ---------------------------------------------------------------------------

export const SpineFieldSpec = Schema.Struct({
  /** Exact runtime camelCase field name. Locked to current runtime by tests. */
  runtimeName: NonEmptyString,
  /** Source ontology IRI, or null for runtime-local fields (e.g. `_tag`). */
  ontologyIri: Schema.NullOr(IriString),
  /** Discriminated type description — drives generator output. */
  type: SpineFieldType,
  /** Whether the field is `Schema.optionalKey(...)` in the emitted struct. */
  optional: Schema.Boolean,
  /** Whether the field lives in the generated fragment or hand-written wrapper. */
  generation: SpineFieldGenerationMode,
  /** Optional human-readable description surfaced in generator docs. */
  description: Schema.optionalKey(NonEmptyString),
  /**
   * When a field is intentionally looser than its long-run contract (e.g.
   * `Series.datasetId` starts optional in v1 and will tighten to required
   * after SKY-317's runtime migration), record the tightening plan here.
   * Purely informational — not consumed by the generator.
   */
  deferredTightening: Schema.optionalKey(NonEmptyString)
});
export type SpineFieldSpec = Schema.Schema.Type<typeof SpineFieldSpec>;

// ---------------------------------------------------------------------------
// Spine class key — the four classes this manifest is scoped to. Adding a
// new spine class is a deliberate manifest version bump.
// ---------------------------------------------------------------------------

export const SpineClassKey = Schema.Literals([
  "Agent",
  "Dataset",
  "Variable",
  "Series"
]);
export type SpineClassKey = Schema.Schema.Type<typeof SpineClassKey>;

// ---------------------------------------------------------------------------
// Per-class specification.
// ---------------------------------------------------------------------------

export const SpineClassSpec = Schema.Struct({
  /** Runtime class name. Matches the Effect Schema struct name in src/domain/data-layer. */
  runtimeName: SpineClassKey,
  /** Source ontology IRI for the class (e.g. sevocab:Series). */
  ontologyIri: IriString,
  /** Optional class-level description — generator may surface as a leading comment. */
  classComment: Schema.optionalKey(NonEmptyString),
  /** Ordered field list. Order is part of the contract and is locked by tests. */
  fields: Schema.Array(SpineFieldSpec)
});
export type SpineClassSpec = Schema.Schema.Type<typeof SpineClassSpec>;

// ---------------------------------------------------------------------------
// Derived relationship — ontology views that are computed rather than
// stored on a single class. Recorded here for generator visibility and
// documentation; the runtime does NOT compute them via OWL reasoning.
// ---------------------------------------------------------------------------

export const SpineDerivedRelationship = Schema.Struct({
  /** Source ontology IRI (e.g. sevocab:hasVariable). */
  ontologyIri: IriString,
  /** Informational runtime name for the view (e.g. "hasVariable"). */
  runtimeName: NonEmptyString,
  /** Human-readable description of why the view exists. */
  description: NonEmptyString,
  /** Ontology IRIs of the underlying properties that compose the view. */
  derivedFrom: Schema.Array(IriString)
});
export type SpineDerivedRelationship = Schema.Schema.Type<
  typeof SpineDerivedRelationship
>;

// ---------------------------------------------------------------------------
// Root manifest.
//
// `manifestVersion` is a hard literal — any incompatible contract change
// must bump it and land in a coordinated ontology + runtime update.
// ---------------------------------------------------------------------------

export const DataLayerSpineManifest = Schema.Struct({
  manifestVersion: Schema.Literal(1),
  sourceCommit: NonEmptyString,
  generatedAt: IsoTimestamp,
  inputHash: NonEmptyString,
  ontologyIri: IriString,
  ontologyVersion: NonEmptyString,
  classes: Schema.Struct({
    Agent: SpineClassSpec,
    Dataset: SpineClassSpec,
    Variable: SpineClassSpec,
    Series: SpineClassSpec
  }),
  derivedRelationships: Schema.Array(SpineDerivedRelationship)
});
export type DataLayerSpineManifest = Schema.Schema.Type<
  typeof DataLayerSpineManifest
>;
