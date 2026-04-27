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
 *   internals. Cycles raise `CodegenAstError` rather than degrading silently.
 * - No file IO; that lives in Task 9's `writeOntologyClasses.ts`.
 *
 * Branded IRI scheme: every class gets a regex anchored to
 * `^https://w3id\.org/energy-intel/<lower>/[A-Za-z0-9_-]+$` (where `<lower>`
 * is the class local name with first character lowercased), matching the
 * upstream IRI minting convention. Properties whose `range` is another class
 * pick up that target class's brand in Task 9. Class IRIs outside the
 * energy-intel namespace raise `CodegenAstError(kind: "UnknownNamespace")`
 * rather than emitting a permissive pattern.
 */
import { Effect, JsonSchema, Schema, SchemaRepresentation } from "effect";
import type { ClassTable, EquivalentClassRestriction } from "./parseTtl.ts";
import type { JsonSchemaDocument } from "./buildJsonSchema.ts";

/**
 * Tagged error surfaced from post-processing failures. Replaces the prior
 * silent fallbacks for two load-bearing invariants:
 *
 * - `DependencyCycle` — `topoSortClasses` discovered a cycle in the class
 *   `range` graph. The architecture doc treats topological emit order as a
 *   correctness guarantee for Task 9 (dependents must appear after their
 *   dependencies); silently swallowing a cycle would let malformed input
 *   produce wrong-but-plausible TS source. `cyclePath` carries the IRIs that
 *   form the cycle, in DFS-discovery order.
 *
 * - `UnknownNamespace` — `iriPatternForClass` was asked to brand a class IRI
 *   outside the energy-intel namespace. The slice ontology is pure
 *   `ei:* + foaf:* + bfo:*`, so this only fires on malformed input; emitting
 *   a permissive `^.+$` would defeat the brand and ship corrupt regex.
 */
export class CodegenAstError extends Schema.TaggedErrorClass<CodegenAstError>()(
  "CodegenAstError",
  {
    kind: Schema.Literals(["DependencyCycle", "UnknownNamespace"]),
    cyclePath: Schema.optionalKey(Schema.Array(Schema.String)),
    classIri: Schema.optionalKey(Schema.String),
    message: Schema.String
  }
) {}

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
 * Class IRIs outside the energy-intel namespace raise
 * `CodegenAstError(kind: "UnknownNamespace")`. The slice ontology is pure
 * `ei:* + foaf:* + bfo:*` and only `ei:*` becomes a `Schema.Class`, so this
 * never fires in practice; if it does, the generator should not silently emit
 * a permissive `^.+$` brand and ship corrupt regex.
 */
const iriPatternForClass = (
  classIri: string
): Effect.Effect<string, CodegenAstError> =>
  Effect.gen(function* () {
    if (!classIri.startsWith(ENERGY_INTEL_NS)) {
      return yield* new CodegenAstError({
        kind: "UnknownNamespace",
        classIri,
        message: `Class IRI ${classIri} is not in the energy-intel namespace ${ENERGY_INTEL_NS}; refusing permissive pattern.`
      });
    }
    const local = localName(classIri);
    // TODO(IRI-convention): Confirm naming policy for multi-word class
    // names with the energy-intel ontology owners. The current rule
    // (lowercase first char of last segment) produces "energyExpertRole"
    // for EnergyExpertRole, but the slice's example fixtures use
    // "/role/EnergyExpertRole/<id>" (a different convention). For the
    // Expert vertical slice we only mint Expert IRIs ("expert"), so this
    // is dormant — but Task 11's fixtures need an explicit decision.
    const lower = local.charAt(0).toLowerCase() + local.slice(1);
    return `^https://w3id\\.org/energy-intel/${lower}/[A-Za-z0-9_-]+$`;
  });

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
 *
 * Cycles raise `CodegenAstError(kind: "DependencyCycle")` rather than falling
 * back to insertion order: Task 9 relies on dependents appearing after their
 * dependencies, and silently degrading on malformed input would produce
 * wrong-but-plausible TS source. `cyclePath` is the DFS path captured at
 * detection time, including the re-visited IRI as the closing element so
 * readers can see the loop (`A → B → C → A`).
 */
const topoSortClasses = (
  table: ClassTable
): Effect.Effect<ReadonlyArray<string>, CodegenAstError> =>
  Effect.gen(function* () {
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
    const stackPath: Array<string> = [];

    // DFS with explicit cycle detection. Returns the cycle path (closed
    // loop, dependency-first ordering) the moment a back-edge is seen.
    const visit = (iri: string): ReadonlyArray<string> | undefined => {
      if (visited.has(iri)) return undefined;
      if (onStack.has(iri)) {
        const cycleStart = stackPath.indexOf(iri);
        return cycleStart >= 0
          ? [...stackPath.slice(cycleStart), iri]
          : [iri, iri];
      }
      onStack.add(iri);
      stackPath.push(iri);
      for (const dep of dependsOn.get(iri) ?? []) {
        const cycle = visit(dep);
        if (cycle !== undefined) return cycle;
      }
      stackPath.pop();
      onStack.delete(iri);
      visited.add(iri);
      sorted.push(iri);
      return undefined;
    };

    for (const cls of table.classes) {
      const cycle = visit(cls.iri);
      if (cycle !== undefined) {
        return yield* new CodegenAstError({
          kind: "DependencyCycle",
          cyclePath: cycle,
          message: `Topological sort cannot proceed: dependency cycle ${cycle.join(" -> ")}.`
        });
      }
    }
    return sorted;
  });

export const postProcessAst = (
  jsonSchema: JsonSchemaDocument,
  table: ClassTable
): Effect.Effect<ProcessedAst, CodegenAstError | Error> =>
  Effect.gen(function* () {
    const emitOrder = yield* topoSortClasses(table);

    // Build per-class brand metadata. Task 9 strings-substitutes these into
    // the generated `Schema.String.pipe(Schema.pattern(...), Schema.brand(...))`
    // for each class's `iri` field plus emits the equivalent-class JSDoc.
    const brandedIris: Array<BrandedIriMetadata> = [];
    for (const cls of table.classes) {
      const pattern = yield* iriPatternForClass(cls.iri);
      brandedIris.push({
        className: localName(cls.iri),
        classIri: cls.iri,
        brandName: `${localName(cls.iri)}Iri`,
        pattern,
        equivalentClassDoc: cls.equivalentClassRestrictions.map((r) =>
          renderEquivalentClassDoc(cls.iri, r)
        )
      });
    }

    // Lift the JSON Schema document into Effect's representation system.
    // `JsonSchema.fromSchemaDraft2020_12` accepts the open
    // `{ $defs, ...rest }` shape directly: it strips `$defs` into the
    // canonical `definitions` field and keeps the rest as the root `schema`.
    // `buildJsonSchema` emits a `$defs`-only document (no root keys), so the
    // resulting `schema` is effectively empty — but `toMultiDocument` still
    // populates `references` with every class, which is what Task 9 walks.
    const multiDocument = yield* Effect.try({
      try: () => {
        // `JsonSchemaDocument` is structurally an open JSON Schema (every
        // value is JSON-encodable) but TS lacks an index signature on the
        // closed interface; widen via `unknown` to satisfy the
        // `[x: string]: unknown` shape `fromSchemaDraft2020_12` expects.
        const raw = jsonSchema as unknown as JsonSchema.JsonSchema;
        const document = SchemaRepresentation.fromJsonSchemaDocument(
          JsonSchema.fromSchemaDraft2020_12(raw)
        );
        return SchemaRepresentation.toMultiDocument(document);
      },
      catch: (cause): Error =>
        cause instanceof Error
          ? cause
          : new Error(`AST post-process failed: ${String(cause)}`)
    });

    return { multiDocument, brandedIris, emitOrder };
  });
