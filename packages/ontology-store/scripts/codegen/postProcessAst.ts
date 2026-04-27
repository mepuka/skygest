/**
 * AST post-processor: JSON Schema document → Effect SchemaRepresentation
 * MultiDocument plus per-class branded-IRI metadata.
 *
 * Stage 3 of the TTL → Effect Schema codegen pipeline. Consumes the
 * `JsonSchemaDocument` from Task 7 + the original `ClassTable` from Task 6 and
 * lifts both into a `SchemaRepresentation.MultiDocument` (so Task 9 has a
 * canonical Effect-native AST to walk) plus a sidecar `brandedIris` array
 * describing each class's IRI brand (name, regex, equivalent-class
 * documentation).
 *
 * Scope discipline (per Task 8 spec):
 * - Deep AST rewrite of `iri` field representations to use `Schema.brand` is
 *   deferred. The plan explicitly endorses metadata-pass-through: Task 9's TS
 *   source emitter string-substitutes the brands at write time using
 *   `brandedIris`. Equally correct, much simpler.
 * - `owl:equivalentClass` restrictions are surfaced as human-readable
 *   `equivalentClassDoc` strings (e.g. `ei:Expert ≡ foaf:Person ⊓ ∃bfo:bearerOf.EnergyExpertRole`)
 *   so Task 9 can render them as JSDoc comments above each `Schema.Class`.
 *   Encoding the BFO inherence reasoning at the type level is a future task.
 * - Topological sort runs over our own `ClassTable` (cross-class `range`
 *   references), so dependents (`Expert.roles`) emit after dependencies
 *   (`EnergyExpertRole`). `SchemaRepresentation.topologicalSort` is
 *   `@internal` and operates on `References` keyed by sanitised `$ref` —
 *   computing it ourselves keeps the surface stable and avoids reaching into
 *   internals.
 * - No file IO; that lives in Task 9's `writeOntologyClasses.ts`.
 *
 * Branded IRI scheme: every class gets a regex anchored to
 * `^https://w3id\.org/energy-intel/<lower>/[A-Za-z0-9_-]+$` (where `<lower>`
 * is the class local name with first character lowercased), matching the
 * upstream IRI minting convention. Properties whose `range` is another class
 * pick up that target class's brand in Task 9.
 */
import { Effect, JsonSchema, SchemaRepresentation } from "effect";
import type { ClassTable, EquivalentClassRestriction } from "./parseTtl.ts";
import type { JsonSchemaDocument } from "./buildJsonSchema.ts";

/**
 * Per-class brand metadata. Task 9's TS-source writer substitutes `brandName`
 * + `pattern` into the generated `Schema.String.pipe(Schema.pattern(...),
 * Schema.brand(...))` for each class's `iri` field, and uses
 * `equivalentClassDoc` to render JSDoc above the class definition.
 */
export interface BrandedIriMetadata {
  /** Local name (last URL segment) of the class. e.g. `Expert`. */
  readonly className: string;
  /** Full IRI of the class. e.g. `https://w3id.org/energy-intel/Expert`. */
  readonly classIri: string;
  /** Brand identifier used in the generated TS source. e.g. `ExpertIri`. */
  readonly brandName: string;
  /** Anchored regex matching minted IRIs for this class. */
  readonly pattern: string;
  /**
   * Human-readable doc lines describing each `owl:equivalentClass` restriction
   * on this class. Empty if no restrictions. Task 9 renders as JSDoc.
   */
  readonly equivalentClassDoc: ReadonlyArray<string>;
}

export interface ProcessedAst {
  readonly multiDocument: SchemaRepresentation.MultiDocument;
  readonly brandedIris: ReadonlyArray<BrandedIriMetadata>;
  /**
   * Class IRIs in topological order (dependencies before dependents). Drives
   * Task 9's emit order so `Schema.Class<EnergyExpertRole>` appears before
   * `Schema.Class<Expert>` (which references it via `bfo:bearerOf`).
   */
  readonly emitOrder: ReadonlyArray<string>;
}

const ENERGY_INTEL_NS = "https://w3id.org/energy-intel/";

/**
 * Last URL path segment / fragment of an IRI. Mirrors `buildJsonSchema.ts`'s
 * helper so brand names and `$defs` keys stay aligned.
 */
const localName = (iri: string): string => {
  const hashIdx = iri.lastIndexOf("#");
  const tail =
    hashIdx >= 0 ? iri.slice(hashIdx + 1) : iri.slice(iri.lastIndexOf("/") + 1);
  const sanitized = tail.replace(/[^A-Za-z0-9_]+/g, "_");
  return sanitized.length === 0 ? "_" : sanitized;
};

/**
 * Energy-intel IRI scheme for a given class. Patterns are anchored and use
 * the class's lowercased local name as the path prefix.
 *
 *   Expert            -> ^https://w3id\.org/energy-intel/expert/[A-Za-z0-9_-]+$
 *   EnergyExpertRole  -> ^https://w3id\.org/energy-intel/energyExpertRole/[A-Za-z0-9_-]+$
 *
 * For non-energy-intel classes we still emit a brand but use a generic
 * `^.+$` permissive pattern; the generator should never see these in
 * practice (the slice ontology is pure ei:* + foaf:* + bfo:*), but this
 * keeps the function total.
 */
const irlPatternForClass = (classIri: string): string => {
  if (!classIri.startsWith(ENERGY_INTEL_NS)) {
    return `^.+$`;
  }
  const local = localName(classIri);
  const lower = local.charAt(0).toLowerCase() + local.slice(1);
  return `^https://w3id\\.org/energy-intel/${lower}/[A-Za-z0-9_-]+$`;
};

/**
 * Render an `owl:equivalentClass` restriction as a human-readable doc line.
 * The output uses the existential ⊓ / ∃ unicode notation matching the plan's
 * comment style:
 *
 *   ei:Expert ≡ foaf:Person ⊓ ∃bfo:bearerOf.EnergyExpertRole
 */
const renderEquivalentClassDoc = (
  classIri: string,
  restriction: EquivalentClassRestriction
): string => {
  const classLocal = localName(classIri);
  const propLocal = localName(restriction.onProperty);
  const targetLocal = localName(restriction.someValuesFrom);
  return `${classLocal} ≡ ∃${propLocal}.${targetLocal}`;
};

/**
 * Topological sort of class IRIs by `range`-edge dependencies. A class is
 * emitted after every class IRI it references through any property's `range`.
 * Cycles fall back to insertion order — Task 9 doesn't depend on a strict
 * topo guarantee for cyclic graphs (the slice ontology has none), and we'd
 * rather degrade gracefully than throw on malformed input.
 */
const topoSortClasses = (table: ClassTable): ReadonlyArray<string> => {
  const known = new Set(table.classes.map((c) => c.iri));
  const dependsOn = new Map<string, ReadonlyArray<string>>();
  for (const cls of table.classes) {
    const deps = new Set<string>();
    for (const prop of cls.properties) {
      if (prop.range !== undefined && known.has(prop.range)) {
        deps.add(prop.range);
      }
    }
    dependsOn.set(cls.iri, [...deps]);
  }

  const sorted: Array<string> = [];
  const visited = new Set<string>();
  const onStack = new Set<string>();

  const visit = (iri: string): void => {
    if (visited.has(iri)) return;
    if (onStack.has(iri)) {
      // Cycle: bail on this branch; remaining classes append in original order.
      return;
    }
    onStack.add(iri);
    for (const dep of dependsOn.get(iri) ?? []) {
      visit(dep);
    }
    onStack.delete(iri);
    visited.add(iri);
    sorted.push(iri);
  };

  for (const cls of table.classes) {
    visit(cls.iri);
  }
  return sorted;
};

/**
 * Adapt `JsonSchemaDocument` (the lightweight `{ $schema, $defs }` shape from
 * `buildJsonSchema.ts`) to `JsonSchema.Document<"draft-2020-12">` for
 * `SchemaRepresentation.fromJsonSchemaDocument`. Picks the first `$defs`
 * entry as the root schema and keeps the rest as `definitions`; downstream
 * consumers walk `references`, not the root, so the choice of root is
 * structurally irrelevant.
 */
const toEffectDocument = (
  document: JsonSchemaDocument,
  emitOrder: ReadonlyArray<string>,
  classDefKeys: ReadonlyMap<string, string>
): JsonSchema.Document<"draft-2020-12"> => {
  // `JsonSchema.Definitions` is `Record<string, JsonSchema>` where
  // `JsonSchema` is the open `{ [x: string]: unknown }` shape; our
  // `JsonSchemaObject` is structurally compatible (every key is JSON) but
  // doesn't carry the open index signature, so we coerce through `unknown`
  // to satisfy the index-signature constraint.
  const definitions = { ...document.$defs } as unknown as JsonSchema.Definitions;
  // Pick the topologically-last class (the most-dependent one) as the root.
  // Any choice works; this keeps `references` populated with every other
  // class.
  const rootIri = emitOrder[emitOrder.length - 1];
  const rootKey =
    rootIri !== undefined ? classDefKeys.get(rootIri) : undefined;
  const rootSchema: JsonSchema.JsonSchema =
    rootKey !== undefined ? { $ref: `#/$defs/${rootKey}` } : {};
  return {
    dialect: "draft-2020-12",
    schema: rootSchema,
    definitions
  };
};

export const postProcessAst = (
  jsonSchema: JsonSchemaDocument,
  table: ClassTable
): Effect.Effect<ProcessedAst, Error> =>
  Effect.try({
    try: (): ProcessedAst => {
      // Pre-build IRI → $defs key map so root selection mirrors
      // buildJsonSchema's localName logic exactly.
      const classDefKeys = new Map<string, string>();
      for (const cls of table.classes) {
        classDefKeys.set(cls.iri, localName(cls.iri));
      }

      const emitOrder = topoSortClasses(table);

      // Build per-class brand metadata. Task 9 strings-substitutes these into
      // the generated `Schema.String.pipe(Schema.pattern(...), Schema.brand(...))`
      // for each class's `iri` field plus emits the equivalent-class JSDoc.
      const brandedIris: Array<BrandedIriMetadata> = table.classes.map(
        (cls): BrandedIriMetadata => ({
          className: localName(cls.iri),
          classIri: cls.iri,
          brandName: `${localName(cls.iri)}Iri`,
          pattern: irlPatternForClass(cls.iri),
          equivalentClassDoc: cls.equivalentClassRestrictions.map((r) =>
            renderEquivalentClassDoc(cls.iri, r)
          )
        })
      );

      // Lift the JSON Schema document into Effect's representation system.
      // We go through the `MultiDocument` form because `buildJsonSchema`
      // produces a `$defs`-only document — every class is a definition, none
      // are root. `toMultiDocument` keeps `references` populated with the
      // full graph.
      const document = SchemaRepresentation.fromJsonSchemaDocument(
        toEffectDocument(jsonSchema, emitOrder, classDefKeys)
      );
      const multiDocument = SchemaRepresentation.toMultiDocument(document);

      return { multiDocument, brandedIris, emitOrder };
    },
    catch: (cause) =>
      cause instanceof Error
        ? cause
        : new Error(`AST post-process failed: ${String(cause)}`)
  });
