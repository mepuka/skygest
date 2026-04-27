# Energy-Intel Expert Slice Implementation Plan

> **Implementation status (2026-04-27):** PR #137 ships **Phase A-D only** — the
> ontology-store package consolidation, codegen pipeline, and the canonical
> hand-written Expert agent module + SHACL shape + six-phase round-trip test.
> Phase E (Alchemy migration + AI Search provisioning) and Phase F (coordination
> services + populate script + admin route + cutover) are deferred to separate
> PRs since they touch live Cloudflare infrastructure. The 21-task plan below
> remains the contract for the full target state.

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship the energy-intel ontology vertical slice on `Expert` end-to-end — codegen pipeline producing Effect schemas from `agent.ttl`, Alchemy migration provisioning all infra plus a live AI Search instance for `experts`, a typed `searchExperts` Effect service returning `Expert[]` from the agent worker, and a populated AI Search index seeded from D1.

**Architecture:** Per the companion architecture doc (`docs/plans/2026-04-27-energy-intel-unified-abstraction-architecture.md`): `Schema.Class` generated per ontology module, hand-written `OntologyEntityModule<S, M>` per entity co-locating mapping + projection, three new services (`AiSearchClient`, `OntologyExpertRepo`, `ExpertSearchService`), Effect Layer composition in `src/edge/Layer.ts`. Alchemy provisions all current bindings at parity plus the new AI Search namespace + `experts` instance + AI Gateway binding.

**Tech Stack:** Bun + Effect 4 (`effect@4.0.0-beta.43`), Cloudflare Workers + D1 + KV + R2 + Durable Objects + Workflows + AI Search (formerly AutoRAG) + AI Gateway, Alchemy IaC, n3.js + rdf-validate-shacl, vitest via @effect/vitest.

**Companion docs:**
- Slice design: `docs/plans/2026-04-27-energy-intel-expert-vertical-slice-design.md`
- Architecture: `docs/plans/2026-04-27-energy-intel-unified-abstraction-architecture.md`

**Working directory:** `/Users/pooks/Dev/skygest-cloudflare/.worktrees/energy-intel-expert-slice/`
**Branch:** `energy-intel-expert-slice`
**Test runner:** `bun run test` (vitest). Per CLAUDE.md, never `bun test`.

---

## Plan Phasing

The plan has 21 tasks across 6 phases. Phase A (cleanup) and Phase B (domain interface + errors) prep the package; Phase C builds the codegen pipeline; Phase D runs codegen + lands the Expert agent module; Phase E migrates infra to Alchemy + provisions AI Search; Phase F wires the runtime services + populates + verifies end-to-end.

| Phase | Tasks | Cumulative effort |
|-------|-------|-------------------|
| A. Package consolidation | 1–2 | ~3 hours |
| B. Domain interface & errors | 3–4 | ~3 hours |
| C. Codegen pipeline | 5–9 | ~3 days |
| D. Expert agent module | 10–12 | ~2 days |
| E. Alchemy + AI Search provisioning | 13–16 | ~3 days |
| F. Coordination services + cutover | 17–21 | ~3 days |
| Total | 21 tasks | ~2 weeks |

Each task is an atomic review unit (~2–4 hours). Steps within a task follow a strict TDD cycle: write failing test → run → implement → run → commit.

---

## Phase A — Package Consolidation

Goal: Trim `packages/ontology-store/` to its skeleton and the parts that survive (RDF round-trip pattern, SHACL machinery, N3.js usage, scripts dir, shapes dir, tests dir). Delete DCAT-only `EmitSpec` content and the JSON spec interpreter pattern. Net: negative LOC.

### Task 1: Inventory current package contents

**Files:**
- Read: `packages/ontology-store/package.json`
- Read: `packages/ontology-store/src/index.ts` and all `src/*/*.ts` files

**Step 1: Map current contents**

Run from worktree root:

```bash
find packages/ontology-store/src -type f -name "*.ts" | sort
ls packages/ontology-store/scripts/
ls packages/ontology-store/shapes/
ls packages/ontology-store/tests/
wc -l packages/ontology-store/src/**/*.ts
```

**Step 2: Categorize each file**

For each file, decide one of: `KEEP`, `TRIM`, `REPLACE`, `DELETE`. Annotate the architecture doc (`docs/plans/2026-04-27-energy-intel-unified-abstraction-architecture.md`) with the table at the bottom of this section.

Categories per the design doc:
- **KEEP:** N3.js parsing helpers, RDF round-trip phase test scaffold (six phases), SHACL validation harness, package.json skeleton
- **TRIM:** Anything under `src/Service/` that is no-op (per memory: `Reasoner.ts` already deleted)
- **REPLACE:** `EmitSpec` JSON interpreter, `src/mapping/forward.ts`, `src/mapping/reverse.ts`, `src/loadedEmitSpec.ts`, `src/emit.ts`, `src/distill.ts`, `src/aliasEmitter.ts`, `scripts/generate-emit-spec.ts` — these go away in favor of per-entity hand-written modules + the new TTL codegen
- **DELETE:** `src/types/`, `src/mapping/`, manifest walker, manifest fixtures unrelated to round-trip phase test

**Step 3: Commit the inventory**

Save the categorized inventory as a new file:

```bash
# Manually maintained doc, not generated
# Path: packages/ontology-store/MIGRATION-INVENTORY.md
```

Commit:

```bash
git add packages/ontology-store/MIGRATION-INVENTORY.md
git commit -m "docs(ontology-store): inventory package contents pre-consolidation"
```

### Task 2: Delete DCAT-only EmitSpec content

**Files:**
- Delete: `packages/ontology-store/src/emit.ts`, `packages/ontology-store/src/distill.ts`, `packages/ontology-store/src/aliasEmitter.ts`, `packages/ontology-store/src/loadedEmitSpec.ts`, `packages/ontology-store/scripts/generate-emit-spec.ts`, `packages/ontology-store/src/mapping/`, `packages/ontology-store/src/types/`, `packages/ontology-store/generated/emit-spec.json`
- Modify: `packages/ontology-store/src/index.ts` (remove deleted exports)

**Step 1: Run tests, capture failures**

```bash
bun run test packages/ontology-store/ 2>&1 | tail -50
```

Expected: passing baseline.

**Step 2: Delete the files**

```bash
git rm packages/ontology-store/src/emit.ts \
        packages/ontology-store/src/distill.ts \
        packages/ontology-store/src/aliasEmitter.ts \
        packages/ontology-store/src/loadedEmitSpec.ts \
        packages/ontology-store/scripts/generate-emit-spec.ts \
        packages/ontology-store/generated/emit-spec.json
git rm -r packages/ontology-store/src/mapping/ \
          packages/ontology-store/src/types/
```

**Step 3: Update index.ts to remove deleted exports**

Edit `packages/ontology-store/src/index.ts` and remove every `export *` or named export pointing to deleted files.

**Step 4: Run tests, expect failures**

```bash
bun run test packages/ontology-store/ 2>&1 | tail -30
```

Expected: failures from tests that import deleted modules. List them.

**Step 5: Delete or rewrite tests of deleted code**

For each failing test, decide: was it testing DCAT-specific EmitSpec content? Then delete. Was it testing pattern that survives (RDF round-trip phases, SHACL)? Then keep and update imports.

Likely deletes:
- `tests/emit.test.ts`
- `tests/distill.test.ts`
- `tests/forward.test.ts`
- `tests/reverse.test.ts`
- `tests/loadedEmitSpec.test.ts`

Keep (these survive the consolidation):
- `tests/catalog-round-trip.test.ts` — six-phase pattern, will be repurposed later
- `tests/Domain/Rdf.test.ts` — N3.js helpers
- `tests/shapes/dcat-instances.test.ts` — SHACL harness, may need updating

**Step 6: Run typecheck + tests**

```bash
bun run typecheck && bun run test packages/ontology-store/ 2>&1 | tail -10
```

Expected: green.

**Step 7: Commit**

```bash
git add -A packages/ontology-store/
git commit -m "refactor(ontology-store): remove DCAT-only EmitSpec content

Deletes the JSON spec interpreter and per-direction mapping walkers.
The package retains its skeleton (scripts, shapes, tests, N3.js, SHACL
machinery); content rebases onto the energy-intel ontology in later
tasks.

Companion: docs/plans/2026-04-27-energy-intel-unified-abstraction-architecture.md"
```

---

## Phase B — Domain Interface and Errors

Goal: Land the `OntologyEntityModule` interface and the new tagged errors (`AiSearchError`, `RdfMappingError`) so all subsequent tasks can import from a stable surface.

### Task 3: Add `OntologyEntityModule` interface

**Files:**
- Create: `packages/ontology-store/src/Domain/OntologyEntity.ts`
- Create: `packages/ontology-store/src/Domain/Rdf.ts` (if not already present — check first; the architecture doc references it)

**Step 1: Check current state**

```bash
ls packages/ontology-store/src/Domain/ 2>&1
```

If `OntologyEntity.ts` does not exist, proceed. If `Rdf.ts` exists with `RdfQuad` exported, reference it; otherwise create.

**Step 2: Write the interface**

Create `packages/ontology-store/src/Domain/OntologyEntity.ts`:

```ts
import type { Effect, Schema } from "effect"
import type { RdfQuad } from "./Rdf.js"
import type { RdfMappingError } from "./Errors.js"
import type { ParseError } from "effect/SchemaAST"

/**
 * The contract every per-entity ontology module satisfies structurally.
 *
 * Schema is generated; transforms are hand-written; both live in the
 * same module per energy-intel architecture decisions (2026-04-27).
 */
export interface OntologyEntityModule<
  Self extends Schema.Schema.Any,
  Meta extends Readonly<Record<string, string>>,
> {
  readonly schema: Self
  readonly iriOf: (e: Schema.Schema.Type<Self>) => string
  readonly toTriples: (e: Schema.Schema.Type<Self>) => ReadonlyArray<RdfQuad>
  readonly fromTriples: (
    quads: ReadonlyArray<RdfQuad>,
    subject: string,
  ) => Effect.Effect<Schema.Schema.Type<Self>, RdfMappingError | ParseError>
  readonly toAiSearchKey: (e: Schema.Schema.Type<Self>) => string
  readonly toAiSearchBody: (e: Schema.Schema.Type<Self>) => string
  readonly toAiSearchMetadata: (e: Schema.Schema.Type<Self>) => Meta
}
```

**Step 3: Typecheck (no test yet — interface only)**

```bash
bun run typecheck 2>&1 | tail -10
```

Expected: passes (though `RdfMappingError` doesn't exist yet — temporary `any` import is fine until Task 4).

**Step 4: Commit**

```bash
git add packages/ontology-store/src/Domain/OntologyEntity.ts
git commit -m "feat(ontology-store): add OntologyEntityModule structural interface

Per-entity contract: schema + iriOf + RDF mapping + AI Search projection.
Schema is generated from TTL; transforms are hand-written per entity.

Companion: docs/plans/2026-04-27-energy-intel-unified-abstraction-architecture.md"
```

### Task 4: Add `AiSearchError` and `RdfMappingError` tagged errors

**Files:**
- Modify: `src/domain/errors.ts` (add 2 new tagged error classes)
- Modify: `packages/ontology-store/src/Domain/Errors.ts` (re-export `RdfMappingError` for package consumers — or define here if package is standalone; check first)
- Test: `tests/domain-errors.test.ts` (new test for the new errors)

**Step 1: Read current errors.ts**

```bash
cat src/domain/errors.ts | head -80
```

Note the existing pattern for Schema.TaggedErrorClass. The new errors must follow it.

**Step 2: Write failing test**

Create `tests/domain-errors-energy-intel.test.ts`:

```ts
import { describe, expect, it } from "@effect/vitest"
import { Schema } from "effect"
import { AiSearchError, RdfMappingError } from "../src/domain/errors.js"

describe("AiSearchError", () => {
  it("constructs with required fields and JSON-encodes through Schema", async () => {
    const err = new AiSearchError({
      operation: "upload",
      instance: "experts",
      message: "binding upload failed",
    })
    expect(err._tag).toBe("AiSearchError")
    expect(err.operation).toBe("upload")
    const encoded = Schema.encodeUnknownSync(AiSearchError)(err)
    expect(encoded._tag).toBe("AiSearchError")
  })

  it("accepts optional status and key", async () => {
    const err = new AiSearchError({
      operation: "search",
      instance: "experts",
      message: "rate limited",
      status: 429,
      key: "expert/did:plc:xyz.md",
    })
    expect(err.status).toBe(429)
    expect(err.key).toBe("expert/did:plc:xyz.md")
  })
})

describe("RdfMappingError", () => {
  it("constructs with direction tag and entity name", async () => {
    const err = new RdfMappingError({
      direction: "forward",
      entity: "Expert",
      message: "missing required field",
    })
    expect(err._tag).toBe("RdfMappingError")
    expect(err.direction).toBe("forward")
  })
})
```

**Step 3: Run test, verify fail**

```bash
bun run test tests/domain-errors-energy-intel.test.ts 2>&1 | tail -20
```

Expected: FAIL with module-not-found or undefined-export errors.

**Step 4: Add the errors**

Edit `src/domain/errors.ts`. Append after existing exports:

```ts
export class AiSearchError extends Schema.TaggedErrorClass<AiSearchError>()(
  "AiSearchError",
  {
    operation: Schema.Literal("upload", "search", "get", "delete"),
    instance: Schema.String,
    message: Schema.String,
    status: Schema.optionalKey(Schema.Number),
    key: Schema.optionalKey(Schema.String),
  },
) {}

export class RdfMappingError extends Schema.TaggedErrorClass<RdfMappingError>()(
  "RdfMappingError",
  {
    direction: Schema.Literal("forward", "reverse"),
    entity: Schema.String,
    iri: Schema.optionalKey(Schema.String),
    message: Schema.String,
  },
) {}
```

**Step 5: Run test, verify pass**

```bash
bun run test tests/domain-errors-energy-intel.test.ts 2>&1 | tail -10
```

Expected: PASS.

**Step 6: Update package re-exports**

Edit `packages/ontology-store/src/Domain/Errors.ts` (create if missing) to re-export `RdfMappingError`:

```ts
export { RdfMappingError } from "../../../../src/domain/errors.js"
```

**Step 7: Run typecheck + full test suite**

```bash
bun run typecheck && bun run test 2>&1 | tail -10
```

Expected: green.

**Step 8: Commit**

```bash
git add src/domain/errors.ts \
        packages/ontology-store/src/Domain/Errors.ts \
        tests/domain-errors-energy-intel.test.ts
git commit -m "feat(domain): add AiSearchError and RdfMappingError tagged errors

Per Schema.TaggedErrorClass discipline. AiSearchError covers binding
operations (upload, search, get, delete) with optional status + key;
RdfMappingError covers forward/reverse mapping failures with entity
name + optional IRI.

Companion: docs/plans/2026-04-27-energy-intel-unified-abstraction-architecture.md"
```

---

## Phase C — Codegen Pipeline

Goal: Build the TTL → JSON Schema → Effect AST → TS source pipeline that produces `packages/ontology-store/src/generated/agent.ts` and `packages/ontology-store/src/iris.ts` from `/Users/pooks/Dev/ontology_skill/ontologies/energy-intel/modules/agent.ttl`.

### Task 5: Add n3.js dep + scaffolding for the codegen script

**Files:**
- Modify: `packages/ontology-store/package.json` (add `n3` dep)
- Create: `packages/ontology-store/scripts/generate-from-ttl.ts` (skeleton — `parseArgs`, `main`, error logging)

**Step 1: Add n3 dep**

```bash
cd packages/ontology-store && bun add n3 && bun add -d @types/n3 && cd ../..
```

**Step 2: Create script skeleton**

Create `packages/ontology-store/scripts/generate-from-ttl.ts`:

```ts
#!/usr/bin/env bun
/**
 * Generate Effect Schema source from energy-intel TTL modules.
 *
 * Usage: bun packages/ontology-store/scripts/generate-from-ttl.ts <module>
 * Where <module> is one of: agent, media, measurement, data
 *
 * Pipeline:
 *   TTL → JSON Schema 2020-12 → Effect Schema AST →
 *   AST post-processor (brand IRIs, fold owl:equivalentClass) →
 *   TS source via SchemaRepresentation.toCodeDocument
 */
import { Effect } from "effect"
import { FileSystem, Path } from "@effect/platform"
import { BunContext, BunRuntime } from "@effect/platform-bun"

const MODULES = ["agent", "media", "measurement", "data"] as const
type Module = (typeof MODULES)[number]

const ENERGY_INTEL_ROOT =
  "/Users/pooks/Dev/ontology_skill/ontologies/energy-intel/modules"

const main = Effect.gen(function* () {
  const args = Bun.argv.slice(2)
  const module = args[0] as Module | undefined
  if (!module || !MODULES.includes(module)) {
    yield* Effect.die(`Usage: generate-from-ttl.ts <${MODULES.join("|")}>`)
  }
  yield* Effect.log(`generating from module: ${module}`)
  // implementation lands in tasks 6-9
})

BunRuntime.runMain(main.pipe(Effect.provide(BunContext.layer)))
```

**Step 3: Run skeleton**

```bash
bun packages/ontology-store/scripts/generate-from-ttl.ts agent 2>&1 | tail -5
```

Expected: log line "generating from module: agent" then exit cleanly.

**Step 4: Commit**

```bash
git add packages/ontology-store/package.json \
        packages/ontology-store/scripts/generate-from-ttl.ts
git commit -m "feat(ontology-store): add codegen script scaffolding

Adds n3.js dependency and a Bun + Effect entry point for the TTL → TS
codegen pipeline. Implementation lands in subsequent tasks."
```

### Task 6: TTL parser → in-memory class table

**Files:**
- Create: `packages/ontology-store/scripts/codegen/parseTtl.ts`
- Test: `packages/ontology-store/tests/codegen/parseTtl.test.ts`

The TTL parser converts an n3.js Store of agent.ttl into a typed class table: `{ classIri, label, definition, properties: { iri, label, range, optional, list }[] }`.

**Step 1: Write failing test**

Create `packages/ontology-store/tests/codegen/parseTtl.test.ts`:

```ts
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { parseTtlToClassTable } from "../../scripts/codegen/parseTtl.js"
import { FileSystem } from "@effect/platform"
import { BunContext } from "@effect/platform-bun"
import { layer as TestFs } from "@effect/platform/FileSystem"

describe("parseTtlToClassTable", () => {
  it.effect("emits Expert class with foaf:Person + role-bearer pattern", () =>
    Effect.gen(function* () {
      const ttl = `
        @prefix ei: <https://w3id.org/energy-intel/> .
        @prefix foaf: <http://xmlns.com/foaf/0.1/> .
        @prefix bfo: <http://purl.obolibrary.org/obo/BFO_> .
        @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
        @prefix owl: <http://www.w3.org/2002/07/owl#> .

        ei:Expert a owl:Class ;
          rdfs:label "Expert"@en ;
          owl:disjointWith ei:Organization .

        ei:EnergyExpertRole a owl:Class ;
          rdfs:label "energy expert role"@en ;
          rdfs:subClassOf bfo:0000023 .
      `
      const table = yield* parseTtlToClassTable(ttl)
      expect(table.classes).toContainEqual(
        expect.objectContaining({
          iri: "https://w3id.org/energy-intel/Expert",
          label: "Expert",
        }),
      )
    }).pipe(Effect.provide(BunContext.layer)),
  )
})
```

**Step 2: Run test, verify fail**

```bash
bun run test packages/ontology-store/tests/codegen/parseTtl.test.ts 2>&1 | tail -15
```

Expected: FAIL — module not found.

**Step 3: Implement parser**

Create `packages/ontology-store/scripts/codegen/parseTtl.ts`. Use n3.js `Parser` (explicit `format: "Turtle"` per memory: never trust N3 default). Walk quads, group by subject IRI, identify `owl:Class` types, extract `rdfs:label`, `skos:definition`, `rdfs:subClassOf`, `owl:disjointWith`. Return `{ classes, properties, prefixes }` typed structure.

```ts
import { Effect } from "effect"
import { Parser, Store } from "n3"
import { Schema } from "effect"

export const ClassRecord = Schema.Struct({
  iri: Schema.String,
  label: Schema.String,
  definition: Schema.optional(Schema.String),
  superClasses: Schema.Array(Schema.String),
  disjointWith: Schema.Array(Schema.String),
})
export type ClassRecord = typeof ClassRecord.Type

export const ClassTable = Schema.Struct({
  classes: Schema.Array(ClassRecord),
  prefixes: Schema.Record({ key: Schema.String, value: Schema.String }),
})
export type ClassTable = typeof ClassTable.Type

export const parseTtlToClassTable = (ttl: string) =>
  Effect.try({
    try: () => {
      const parser = new Parser({ format: "Turtle" })
      const store = new Store()
      const prefixes: Record<string, string> = {}
      // n3 Parser sync API
      const quads = parser.parse(ttl, undefined, (prefix, iri) => {
        prefixes[prefix] = String(iri)
      })
      store.addQuads(quads)
      // Walk store: find subjects with rdf:type owl:Class
      const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type"
      const OWL_CLASS = "http://www.w3.org/2002/07/owl#Class"
      const RDFS_LABEL = "http://www.w3.org/2000/01/rdf-schema#label"
      const RDFS_SUBCLASS = "http://www.w3.org/2000/01/rdf-schema#subClassOf"
      const SKOS_DEF = "http://www.w3.org/2004/02/skos/core#definition"
      const OWL_DISJOINT = "http://www.w3.org/2002/07/owl#disjointWith"
      const classes: ClassRecord[] = []
      for (const quad of store.match(null, RDF_TYPE, OWL_CLASS)) {
        const iri = quad.subject.value
        if (iri.startsWith("_:")) continue // skip blank-node restrictions
        const label = store.match(quad.subject, RDFS_LABEL).next().value
          ?.object.value ?? iri
        const def = store.match(quad.subject, SKOS_DEF).next().value?.object.value
        const superClasses = [...store.match(quad.subject, RDFS_SUBCLASS)]
          .map((q) => q.object.value)
          .filter((s) => !s.startsWith("_:"))
        const disjointWith = [...store.match(quad.subject, OWL_DISJOINT)].map(
          (q) => q.object.value,
        )
        classes.push({
          iri,
          label,
          definition: def,
          superClasses,
          disjointWith,
        })
      }
      return { classes, prefixes }
    },
    catch: (cause) => new Error(`TTL parse failed: ${String(cause)}`),
  })
```

**Step 4: Run test, verify pass**

```bash
bun run test packages/ontology-store/tests/codegen/parseTtl.test.ts 2>&1 | tail -10
```

Expected: PASS.

**Step 5: Add property extraction (second test)**

Add to `parseTtl.test.ts`:

```ts
it.effect("extracts data + object properties for a class", () =>
  Effect.gen(function* () {
    const ttl = `... TTL with foaf:name property and ei:bio ...`
    const table = yield* parseTtlToClassTable(ttl)
    // Expect properties on Expert: foaf:name (xsd:string, required),
    // ei:bio (xsd:string, optional), bfo:bearerOf (object, list)
  }),
)
```

Implement property extraction. Walk `rdfs:domain` / `rdfs:range` quads.

**Step 6: Run all tests**

```bash
bun run test packages/ontology-store/tests/codegen/ 2>&1 | tail -10
```

Expected: green.

**Step 7: Commit**

```bash
git add packages/ontology-store/scripts/codegen/parseTtl.ts \
        packages/ontology-store/tests/codegen/parseTtl.test.ts
git commit -m "feat(codegen): TTL → class table parser using n3.js

Parses energy-intel TTL modules into a typed ClassTable structure
(classes + prefixes + properties). Used as the input to JSON Schema
construction. Always uses explicit format: 'Turtle' per n3.js gotcha."
```

### Task 7: Class table → JSON Schema 2020-12

**Files:**
- Create: `packages/ontology-store/scripts/codegen/buildJsonSchema.ts`
- Test: `packages/ontology-store/tests/codegen/buildJsonSchema.test.ts`

The class table → JSON Schema 2020-12 conversion. Each `owl:Class` becomes a `$defs` entry; properties become object fields with `type` derived from `rdfs:range`.

**Step 1: Write failing test**

```ts
import { describe, expect, it } from "@effect/vitest"
import { buildJsonSchema } from "../../scripts/codegen/buildJsonSchema.js"

describe("buildJsonSchema", () => {
  it("emits $defs entry per class", () => {
    const table = {
      classes: [{
        iri: "https://w3id.org/energy-intel/Expert",
        label: "Expert",
        superClasses: [],
        disjointWith: [],
      }],
      prefixes: { ei: "https://w3id.org/energy-intel/" },
    }
    const schema = buildJsonSchema(table)
    expect(schema.$defs.Expert).toBeDefined()
    expect(schema.$defs.Expert.type).toBe("object")
  })
})
```

**Step 2: Run test, verify fail.**

**Step 3: Implement.** Class IRI → safe `$defs` key (last path segment). Properties → object fields. Cross-class refs → `{ "$ref": "#/$defs/<ClassName>" }`. List-valued → `{ "type": "array", "items": ... }`.

**Step 4: Run test, verify pass.**

**Step 5: Add second test for cross-class refs and arrays.**

**Step 6: Commit:**

```bash
git add packages/ontology-store/scripts/codegen/buildJsonSchema.ts \
        packages/ontology-store/tests/codegen/buildJsonSchema.test.ts
git commit -m "feat(codegen): class table → JSON Schema 2020-12 builder"
```

### Task 8: AST post-processor: brand IRIs, fold equivalents, namespace constants

**Files:**
- Create: `packages/ontology-store/scripts/codegen/postProcessAst.ts`
- Create: `packages/ontology-store/scripts/codegen/emitIrisModule.ts`
- Test: `packages/ontology-store/tests/codegen/postProcessAst.test.ts`

**Step 1: Read SchemaRepresentation source**

```bash
cat .reference/effect/packages/effect/src/SchemaRepresentation.ts | head -100
```

Find the `Document`, `MultiDocument`, `Code`, and `Artifact` types. Note `topologicalSort` location. Note the AST node types we need to walk to substitute String → branded refs.

**Step 2: Write failing test for IRI substitution**

```ts
it("substitutes Schema.String to branded IRI for ei:* IRIs", () => {
  // Build a minimal AST manually, run substituteIriBrands,
  // expect the iri field's annotation to reference ExpertIri.
})
```

**Step 3: Implement**

`substituteIriBrands(ast)` walks the AST. For every `String` node whose path indicates a property named `iri`, swap to a reference to a branded type whose name is `<ClassName>Iri`. Use `topologicalSort` from `SchemaRepresentation` to ensure brands are emitted before usages.

`foldOwlEquivalents(ast, classTable)` reads the original class table's `owl:equivalentClass` data and emits a `Schema.declare` or comment annotation for the role-bearer pattern. For the slice, a comment is sufficient — full reasoner integration is deferred.

`emitIrisModule(prefixes, classes)` produces source text for `src/iris.ts`:

```ts
import { DataFactory } from "n3"
const { namedNode } = DataFactory

export const EI = {
  Expert: namedNode("https://w3id.org/energy-intel/Expert"),
  // ...
} as const

export const BFO = {
  inheresIn: namedNode("http://purl.obolibrary.org/obo/BFO_0000052"),
  bearerOf: namedNode("http://purl.obolibrary.org/obo/BFO_0000053"),
  // ...
} as const

export const FOAF = { /* ... */ } as const
export const RDF = { /* ... */ } as const
```

**Step 4: Run tests, verify pass.**

**Step 5: Commit:**

```bash
git add packages/ontology-store/scripts/codegen/postProcessAst.ts \
        packages/ontology-store/scripts/codegen/emitIrisModule.ts \
        packages/ontology-store/tests/codegen/postProcessAst.test.ts
git commit -m "feat(codegen): AST post-processor + iris.ts emitter

Substitutes Schema.String for branded IRI types on entity .iri fields
based on the class table. Emits separate iris.ts with namespaced
n3.js NamedNode constants per energy-intel + BFO + FOAF + RDF prefix."
```

### Task 9: Wire pipeline end-to-end + drift gate

**Files:**
- Modify: `packages/ontology-store/scripts/generate-from-ttl.ts` (call into the modules)
- Create: `packages/ontology-store/tests/codegen/drift.test.ts` (verifies committed `generated/agent.ts` matches script output)

**Step 1: Wire pipeline in `generate-from-ttl.ts`**

```ts
const main = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const args = Bun.argv.slice(2)
  const module = args[0] as Module | undefined
  if (!module || !MODULES.includes(module)) {
    yield* Effect.die(`Usage: generate-from-ttl.ts <${MODULES.join("|")}>`)
  }

  const ttlPath = path.join(ENERGY_INTEL_ROOT, `${module}.ttl`)
  const ttl = yield* fs.readFileString(ttlPath)
  const table = yield* parseTtlToClassTable(ttl)
  const jsonSchema = buildJsonSchema(table)
  const document = SchemaRepresentation.fromJsonSchemaDocument(jsonSchema)
  const multiDocument = SchemaRepresentation.toMultiDocument(document)
  const processed = postProcessAst(multiDocument, table)
  const codeDocument = SchemaRepresentation.toCodeDocument(processed)
  const irisSource = emitIrisModule(table.prefixes, table.classes)

  const generatedDir = path.join(
    "packages/ontology-store/src/generated",
  )
  yield* fs.makeDirectory(generatedDir, { recursive: true })
  yield* fs.writeFileString(
    path.join(generatedDir, `${module}.ts`),
    formatTypeScript(codeDocument.artifacts.map((a) => a.runtime).join("\n\n")),
  )
  yield* fs.writeFileString(
    path.join("packages/ontology-store/src/iris.ts"),
    formatTypeScript(irisSource),
  )

  yield* Effect.log(`generated: ${module}.ts and iris.ts`)
})
```

**Step 2: Run codegen against agent module**

```bash
bun packages/ontology-store/scripts/generate-from-ttl.ts agent
```

Expected: `packages/ontology-store/src/generated/agent.ts` and `packages/ontology-store/src/iris.ts` exist. Inspect them.

**Step 3: Write drift gate test**

Create `packages/ontology-store/tests/codegen/drift.test.ts`:

```ts
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { FileSystem } from "@effect/platform"
import { BunContext } from "@effect/platform-bun"
import { execSync } from "child_process"
import { readFileSync } from "fs"

describe("codegen drift gate", () => {
  it("regenerated agent.ts matches committed agent.ts", () => {
    // Run codegen to a temp dir, diff against committed version
    const committed = readFileSync(
      "packages/ontology-store/src/generated/agent.ts",
      "utf8",
    )
    execSync("bun packages/ontology-store/scripts/generate-from-ttl.ts agent")
    const regenerated = readFileSync(
      "packages/ontology-store/src/generated/agent.ts",
      "utf8",
    )
    expect(regenerated).toBe(committed)
  })
})
```

**Step 4: Run drift test**

```bash
bun run test packages/ontology-store/tests/codegen/drift.test.ts 2>&1 | tail -10
```

Expected: PASS (idempotent regeneration).

**Step 5: Commit generated files + drift gate**

```bash
git add packages/ontology-store/src/generated/agent.ts \
        packages/ontology-store/src/iris.ts \
        packages/ontology-store/scripts/generate-from-ttl.ts \
        packages/ontology-store/tests/codegen/drift.test.ts
git commit -m "feat(codegen): end-to-end TTL → Effect Schema source

Wires parseTtl → buildJsonSchema → fromJsonSchemaDocument → postProcessAst
→ toCodeDocument → file write. Generates agent.ts (Expert + 4 sibling
classes) and iris.ts (EI/BFO/FOAF/RDF namespace constants). Drift gate
ensures committed files match script output."
```

---

## Phase D — Expert Agent Module

Goal: Hand-write `packages/ontology-store/src/agent/expert.ts` (mappings + projection), `shapes/expert.ttl`, and the six-phase round-trip test.

### Task 10: SHACL shape for Expert

**Files:**
- Create: `packages/ontology-store/shapes/expert.ttl`

**Step 1: Reference upstream shape**

```bash
ls /Users/pooks/Dev/ontology_skill/ontologies/energy-intel/shapes/ 2>&1 || echo "no upstream shapes dir"
```

If upstream has an Expert shape, copy. Otherwise write from scratch:

```turtle
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix ei: <https://w3id.org/energy-intel/> .
@prefix foaf: <http://xmlns.com/foaf/0.1/> .
@prefix bfo: <http://purl.obolibrary.org/obo/BFO_> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

ei:ExpertShape a sh:NodeShape ;
  sh:targetClass ei:Expert ;
  sh:nodeKind sh:IRI ;
  sh:pattern "^https://w3id\\.org/energy-intel/expert/[A-Za-z0-9_-]+$" ;
  sh:message "Expert IRI must match the energy-intel pattern" ;
  sh:property [
    sh:path foaf:name ;
    sh:minCount 1 ;
    sh:datatype xsd:string ;
    sh:message "Expert must have a foaf:name" ;
  ] ;
  sh:property [
    sh:path bfo:0000053 ;  # bearerOf
    sh:minCount 1 ;
    sh:qualifiedValueShape [
      sh:class ei:EnergyExpertRole ;
    ] ;
    sh:qualifiedMinCount 1 ;
    sh:message "Expert must bear at least one EnergyExpertRole" ;
  ] .
```

**Step 2: Validate the shape against itself**

```bash
# Use rdf-validate-shacl CLI or pyshacl as a one-off sanity check
bunx rdf-validate-shacl validate --shape packages/ontology-store/shapes/expert.ttl --data packages/ontology-store/shapes/expert.ttl
```

Expected: shape file parses cleanly.

**Step 3: Commit**

```bash
git add packages/ontology-store/shapes/expert.ttl
git commit -m "feat(ontology-store): SHACL shape for Expert

Constraints: IRI pattern, foaf:name minCount 1, at least one
bfo:bearerOf linking to an EnergyExpertRole. sh:Violation severity,
sh:message per constraint."
```

### Task 11: Hand-written Expert agent module

**Files:**
- Create: `packages/ontology-store/src/agent/expert.ts`
- Test: `packages/ontology-store/tests/agent/expert.test.ts`

**Step 1: Write failing tests for each transform**

```ts
import { describe, expect, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { ExpertModule, EXPERT_METADATA_KEYS } from "../../src/agent/expert.js"

describe("ExpertModule", () => {
  const sample = ExpertModule.schema.make({
    iri: "https://w3id.org/energy-intel/expert/MarkZJacobson" as never,
    did: "did:plc:xyz" as never,
    displayName: "Mark Z. Jacobson",
    roles: [
      "https://w3id.org/energy-intel/role/EnergyExpertRole/research" as never,
    ],
    bio: "Energy expert.",
    tier: "top",
    primaryTopic: "renewables-grid",
  })

  it("toAiSearchKey produces expert/{did}.md", () => {
    expect(ExpertModule.toAiSearchKey(sample)).toBe("expert/did:plc:xyz.md")
  })

  it("toAiSearchMetadata returns exactly the 5 declared keys", () => {
    const meta = ExpertModule.toAiSearchMetadata(sample)
    expect(Object.keys(meta).sort()).toEqual([...EXPERT_METADATA_KEYS].sort())
    expect(meta.entity_type).toBe("Expert")
    expect(meta.did).toBe("did:plc:xyz")
  })

  it("toTriples emits BFO inherence for each role", () => {
    const quads = ExpertModule.toTriples(sample)
    const bfoBearerOf = quads.filter(
      (q) => q.predicate.value === "http://purl.obolibrary.org/obo/BFO_0000053",
    )
    expect(bfoBearerOf).toHaveLength(1)
  })

  it.effect("fromTriples round-trips", () =>
    Effect.gen(function* () {
      const quads = ExpertModule.toTriples(sample)
      const round = yield* ExpertModule.fromTriples(quads, sample.iri)
      expect(round.displayName).toBe(sample.displayName)
      expect(round.roles).toEqual(sample.roles)
    }),
  )
})
```

**Step 2: Run tests, verify fail**

```bash
bun run test packages/ontology-store/tests/agent/expert.test.ts 2>&1 | tail -10
```

Expected: FAIL — module not found.

**Step 3: Implement `expert.ts`**

```ts
import { Effect, Schema } from "effect"
import { DataFactory, Store } from "n3"
import { Expert, ExpertIri, EnergyExpertRoleIri, OrganizationIri }
  from "../generated/agent.js"
import { BFO, EI, FOAF, RDF } from "../iris.js"
import type { OntologyEntityModule } from "../Domain/OntologyEntity.js"
import type { RdfQuad } from "../Domain/Rdf.js"
import { RdfMappingError } from "../Domain/Errors.js"

export { Expert, ExpertIri }

export const EXPERT_METADATA_KEYS = [
  "entity_type",
  "did",
  "iri",
  "tier",
  "topic",
] as const
export type ExpertMetadataKey = (typeof EXPERT_METADATA_KEYS)[number]
export type ExpertMetadata = Readonly<Record<ExpertMetadataKey, string>>

const { quad, namedNode, literal } = DataFactory

const iriOf = (e: Expert): ExpertIri => e.iri

const toTriples = (e: Expert): ReadonlyArray<RdfQuad> => {
  const s = namedNode(e.iri)
  const triples: RdfQuad[] = [
    quad(s, RDF.type, EI.Expert),
    quad(s, RDF.type, FOAF.Person),
    quad(s, FOAF.name, literal(e.displayName)),
  ]
  for (const role of e.roles) {
    const r = namedNode(role)
    triples.push(quad(r, RDF.type, EI.EnergyExpertRole))
    triples.push(quad(r, BFO.inheresIn, s))
    triples.push(quad(s, BFO.bearerOf, r))
  }
  if (e.bio) triples.push(quad(s, EI.bio, literal(e.bio)))
  return triples
}

const fromTriples = (
  quads: ReadonlyArray<RdfQuad>,
  subject: string,
): Effect.Effect<Expert, RdfMappingError | Schema.ParseError> =>
  Effect.gen(function* () {
    const store = new Store([...quads])
    const subjectNode = namedNode(subject)
    const nameQuad = store.match(subjectNode, FOAF.name).next().value
    if (!nameQuad)
      yield* new RdfMappingError({
        direction: "reverse",
        entity: "Expert",
        iri: subject,
        message: "missing foaf:name",
      })
    const bioQuad = store.match(subjectNode, EI.bio).next().value
    const roleQuads = [...store.match(subjectNode, BFO.bearerOf)]
    const roles = roleQuads
      .map((q) => q.object.value)
      .filter((iri) => {
        const typedAs = [...store.match(namedNode(iri), RDF.type)]
        return typedAs.some(
          (t) => t.object.value === EI.EnergyExpertRole.value,
        )
      })
    const expert = yield* Schema.decodeUnknown(Expert)({
      iri: subject,
      did: deriveDidFromIri(subject), // small helper
      displayName: nameQuad?.object.value ?? "",
      roles,
      bio: bioQuad?.object.value,
      tier: undefined,
      primaryTopic: undefined,
    })
    return expert
  })

const renderMarkdown = (e: Expert): string => {
  const lines = [
    "---",
    `displayName: ${e.displayName}`,
    `did: ${e.did}`,
    `iri: ${e.iri}`,
    "roles:",
    ...e.roles.map((r) => `  - ${r}`),
  ]
  if (e.affiliations) {
    lines.push("affiliations:")
    e.affiliations.forEach((a) => lines.push(`  - ${a}`))
  }
  if (e.tier) lines.push(`tier: ${e.tier}`)
  if (e.primaryTopic) lines.push(`primary_topic: ${e.primaryTopic}`)
  lines.push("---", "", `# ${e.displayName}`, "")
  if (e.bio) lines.push(e.bio)
  return lines.join("\n")
}

const toAiSearchKey = (e: Expert) => `expert/${e.did}.md`
const toAiSearchBody = renderMarkdown
const toAiSearchMetadata = (e: Expert): ExpertMetadata => ({
  entity_type: "Expert",
  did: e.did,
  iri: e.iri,
  tier: e.tier ?? "unknown",
  topic: e.primaryTopic ?? "unknown",
})

export const ExpertModule: OntologyEntityModule<typeof Expert, ExpertMetadata> = {
  schema: Expert,
  iriOf,
  toTriples,
  fromTriples,
  toAiSearchKey,
  toAiSearchBody,
  toAiSearchMetadata,
}
```

**Step 4: Run tests, verify pass**

```bash
bun run test packages/ontology-store/tests/agent/expert.test.ts 2>&1 | tail -10
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/ontology-store/src/agent/expert.ts \
        packages/ontology-store/tests/agent/expert.test.ts
git commit -m "feat(ontology-store): hand-written ExpertModule

Forward + reverse RDF mapping with BFO inherence (re-expanded on emit,
flattened on distill); markdown projection with 5-key metadata schema
locked at compile time. Satisfies OntologyEntityModule<Expert, ExpertMetadata>."
```

### Task 12: Six-phase round-trip test

**Files:**
- Create: `packages/ontology-store/tests/expert-round-trip.test.ts`
- Add dep: `bun add -d rdf-validate-shacl`

**Step 1: Add dep**

```bash
bun add -d rdf-validate-shacl
```

**Step 2: Write the six-phase test**

```ts
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { Parser, Writer } from "n3"
import { readFileSync } from "fs"
// @ts-expect-error - rdf-validate-shacl has no types
import SHACLValidator from "rdf-validate-shacl"
import { ExpertModule } from "../src/agent/expert.js"
import { fixtureExpert } from "./fixtures/expert.fixture.js"

describe("Expert six-phase round-trip", () => {
  it.effect("phase 1-6 all green", () =>
    Effect.gen(function* () {
      // Phase 1: Load fixture
      const original = fixtureExpert
      // Phase 2: Emit
      const triples = ExpertModule.toTriples(original)
      expect(triples.length).toBeGreaterThan(0)
      // Phase 3: SHACL
      const shapesTtl = readFileSync(
        "packages/ontology-store/shapes/expert.ttl",
        "utf8",
      )
      const shapes = new Parser({ format: "Turtle" }).parse(shapesTtl)
      const validator = new SHACLValidator(shapes)
      const report = validator.validate(triples)
      expect(report.conforms).toBe(true)
      // Phase 4: Reparse
      const writer = new Writer({ format: "Turtle" })
      writer.addQuads(triples as never)
      const ttl = yield* Effect.async<string>((resume) => {
        writer.end((err, result) =>
          err ? resume(Effect.die(err)) : resume(Effect.succeed(result)),
        )
      })
      const reparsed = new Parser({ format: "Turtle" }).parse(ttl)
      expect(reparsed.length).toBe(triples.length)
      // Phase 5: Distill
      const distilled = yield* ExpertModule.fromTriples(reparsed, original.iri)
      // Phase 6: Parity
      expect(distilled.iri).toBe(original.iri)
      expect(distilled.displayName).toBe(original.displayName)
      expect(distilled.roles).toEqual(original.roles)
    }),
  )
})
```

Create the fixture: `tests/fixtures/expert.fixture.ts` with one canonical Expert value.

**Step 3: Run test, verify pass**

```bash
bun run test packages/ontology-store/tests/expert-round-trip.test.ts 2>&1 | tail -15
```

Expected: PASS (six phases green).

**Step 4: Commit**

```bash
git add packages/ontology-store/tests/expert-round-trip.test.ts \
        packages/ontology-store/tests/fixtures/expert.fixture.ts \
        packages/ontology-store/package.json bun.lock
git commit -m "test(ontology-store): six-phase round-trip on Expert

Phases: load → emit → SHACL → reparse → distill → parity. Failures pin
to the phase. Uses rdf-validate-shacl (JS) to keep src/ Node-free."
```

---

## Phase E — Alchemy Migration and AI Search Provisioning

Goal: Replace `wrangler.toml`, `wrangler.agent.toml`, `wrangler.resolver.toml` with `alchemy.run.ts`. Provision all current bindings at parity. Add the new AI Search namespace + `experts` instance + AI Gateway. Verify `alchemy deploy` works against staging.

### Task 13: Add Alchemy dep + state-store config

**Files:**
- Modify: root `package.json` (add `alchemy` dep)
- Create: `alchemy.run.ts` (skeleton)
- Create: `.alchemy/.gitkeep` (so the dir is tracked; state files in `.alchemy/` are committed for single-operator use)
- Modify: `.gitignore` (add `.alchemy/` if not present? — actually keep it tracked per architecture decision)

**Step 1: Install Alchemy**

```bash
bun add alchemy
```

**Step 2: Skeleton `alchemy.run.ts`**

```ts
#!/usr/bin/env bun
import alchemy from "alchemy"

const app = await alchemy("skygest", {
  // Local file state — see architecture doc for rationale
})

// Resources land in tasks 14–16

await app.finalize()
```

**Step 3: Verify Alchemy CLI works**

```bash
bun alchemy.run.ts 2>&1 | tail -10
```

Expected: clean exit, `.alchemy/` dir created with empty state.

**Step 4: Commit**

```bash
git add package.json bun.lock alchemy.run.ts .alchemy/.gitkeep .gitignore
git commit -m "feat(alchemy): scaffolding + local state directory

Adds Alchemy as an IaC dep and the alchemy.run.ts entry point.
Resources land in subsequent tasks."
```

### Task 14: Translate D1, KV, R2, DO, Workflows to Alchemy

**Files:**
- Modify: `alchemy.run.ts` (add D1Database, KVNamespace, R2Bucket, DurableObjectNamespace, Workflow resources)

**Step 1: Read current wrangler files**

```bash
cat wrangler.toml | head -100
cat wrangler.agent.toml | head -80
cat wrangler.resolver.toml | head -40
```

**Step 2: Translate each binding**

Add to `alchemy.run.ts` (in resource-dependency order — D1 before KV before workers, etc.):

```ts
import { D1Database, KVNamespace, R2Bucket } from "alchemy/cloudflare"

// D1 databases
const dbProd = await D1Database("skygest", {
  name: "skygest",
  migrationsDir: "./src/db/migrations",
})
const dbStaging = await D1Database("skygest-staging", { name: "skygest-staging" })
const dbSearchStaging = await D1Database("skygest-search-staging", {
  name: "skygest-search-staging",
})

// KV
const ontologyKv = await KVNamespace("ontology-kv", { title: "ONTOLOGY_KV" })

// R2
const transcriptsProd = await R2Bucket("transcripts-prod", {
  name: "skygest-transcripts",
})
const transcriptsStaging = await R2Bucket("transcripts-staging", {
  name: "skygest-transcripts-staging",
})
```

**Step 3: Run + verify**

```bash
bun alchemy.run.ts 2>&1 | tail -10
```

Expected: each resource creates or updates without error. State file in `.alchemy/` records existing IDs.

**Step 4: Commit**

```bash
git add alchemy.run.ts .alchemy/
git commit -m "feat(alchemy): provision D1, KV, R2 at parity with wrangler.toml"
```

### Task 15: Translate workers + service bindings + cron + env vars

**Files:**
- Modify: `alchemy.run.ts` (add Worker resources for all 3 workers + service bindings + cron + env)

**Step 1: Resolver worker (depended on by both ingest and agent)**

```ts
import { Worker } from "alchemy/cloudflare"

const resolverWorker = await Worker("skygest-resolver", {
  entrypoint: "./src/resolver-worker/index.ts",
  bindings: {
    DB: dbProd,
    SEARCH_DB: dbSearchStaging, // staging-only feature flag handled via env
  },
})
```

**Step 2: Ingest worker (depended on by agent)**

```ts
import { DurableObjectNamespace, Workflow } from "alchemy/cloudflare"

const expertCoordinator = new DurableObjectNamespace("expert-poll-coordinator", {
  className: "ExpertPollCoordinatorDo",
  scriptName: "skygest-bi-ingest",
})

const ingestRunWorkflow = new Workflow("ingest-run-workflow", {
  className: "IngestRunWorkflow",
})
const enrichmentRunWorkflow = new Workflow("enrichment-run-workflow", {
  className: "EnrichmentRunWorkflow",
})

const ingestWorker = await Worker("skygest-bi-ingest", {
  entrypoint: "./src/worker/filter.ts",
  bindings: {
    DB: dbProd,
    ONTOLOGY_KV: ontologyKv,
    TRANSCRIPTS_BUCKET: transcriptsProd,
    EXPERT_POLL_COORDINATOR: expertCoordinator,
    RESOLVER: resolverWorker,
    INGEST_RUN: ingestRunWorkflow,
    ENRICHMENT_RUN: enrichmentRunWorkflow,
  },
  crons: ["*/15 * * * *"],
  vars: {
    PUBLIC_BSKY_API: "...",
    INGEST_SHARD_COUNT: "...",
    DEFAULT_DOMAIN: "...",
    MCP_LIMIT_DEFAULT: "...",
    MCP_LIMIT_MAX: "...",
    GEMINI_VISION_MODEL: "v2.5-flash",
  },
})
```

**Step 3: Agent worker**

```ts
const agentWorker = await Worker("skygest-bi-agent", {
  entrypoint: "./src/worker/feed.ts",
  bindings: {
    DB: dbProd,
    ONTOLOGY_KV: ontologyKv,
    TRANSCRIPTS_BUCKET: transcriptsProd,
    INGEST_SERVICE: ingestWorker,
    RESOLVER: resolverWorker,
  },
  assets: {
    directory: "./dist",
    runWorkerFirst: ["/api/*", "/admin/*", "/mcp", "/health"],
  },
})
```

**Step 4: Run + verify**

```bash
bun alchemy.run.ts 2>&1 | tail -20
```

Expected: workers create or update; service bindings link correctly.

**Step 5: Test deploy against staging (NOT production yet)**

```bash
ALCHEMY_STAGE=staging bun alchemy.run.ts 2>&1 | tail -20
```

Expected: staging deploy succeeds.

**Step 6: Commit**

```bash
git add alchemy.run.ts .alchemy/
git commit -m "feat(alchemy): provision 3 workers + DO + workflows + bindings

Translates wrangler.toml, wrangler.agent.toml, wrangler.resolver.toml
to alchemy.run.ts. Service bindings, cron, env vars, assets all at
parity. Staging deploy verified."
```

### Task 16: Provision AI Search namespace + experts instance + AI Gateway

**Files:**
- Modify: `alchemy.run.ts` (add AiSearchNamespace, AiSearchInstance, AiGateway)
- Modify: agent worker block to bind AI Search and AI Gateway
- Reference: `EXPERT_METADATA_KEYS` from `packages/ontology-store/src/agent/expert.ts` to avoid drift

**Step 1: Import shared metadata keys**

```ts
import { EXPERT_METADATA_KEYS } from "./packages/ontology-store/src/agent/expert.js"
```

**Step 2: Add resources**

```ts
import { AiGateway, AiSearchInstance, AiSearchNamespace } from "alchemy/cloudflare"

const energyIntelNs = await AiSearchNamespace("energy-intel-ns", {
  name: "energy-intel",
})

const expertsInstance = await AiSearchInstance("experts-instance", {
  name: "experts",
  namespace: energyIntelNs,
  customMetadata: [...EXPERT_METADATA_KEYS],
  hybridSearch: true,
  // chunking defaults; tune later
})

const aiGateway = await AiGateway("skygest-ai-gateway", {
  name: "skygest-ai",
})
```

**Step 3: Update agent worker bindings**

```ts
// inside agentWorker bindings:
AI_SEARCH: energyIntelNs, // namespace binding for cross-instance search
AI_GATEWAY: aiGateway,
```

**Step 4: Run + verify**

```bash
ALCHEMY_STAGE=staging bun alchemy.run.ts 2>&1 | tail -10
```

Expected: AI Search namespace + instance + AI Gateway exist on staging account. Agent worker has the bindings.

**Step 5: Manual verification**

```bash
bunx wrangler ai-search list
```

Expected: `experts` instance appears under `energy-intel`.

**Step 6: Commit**

```bash
git add alchemy.run.ts .alchemy/
git commit -m "feat(alchemy): provision energy-intel AI Search + AI Gateway

energy-intel namespace, experts instance with 5-field metadata schema
(matches packages/ontology-store/src/agent/expert.ts EXPERT_METADATA_KEYS),
hybrid search enabled. AI Gateway bound to agent worker."
```

### Task 17: Delete wrangler*.toml files

**Files:**
- Delete: `wrangler.toml`, `wrangler.agent.toml`, `wrangler.resolver.toml`
- Verify: `wrangler.json` is regenerated by Alchemy

**Step 1: Confirm Alchemy generates `wrangler.json`**

```bash
ls wrangler.json 2>/dev/null && cat wrangler.json | head -30
```

Expected: file exists with bindings matching the worker resources.

**Step 2: Delete the toml files**

```bash
git rm wrangler.toml wrangler.agent.toml wrangler.resolver.toml
```

**Step 3: Verify dev workflow still works**

```bash
bunx wrangler types
bunx wrangler dev --config wrangler.json
```

Expected: types regenerate; dev mode starts.

**Step 4: Update CI to run `alchemy deploy` instead of wrangler**

Edit `.github/workflows/ci.yml` (or whatever the deploy workflow is) to swap `wrangler deploy` → `bun alchemy.run.ts`. (Verify the actual file shape first.)

**Step 5: Commit**

```bash
git add -A
git commit -m "feat(alchemy): retire wrangler.toml; CI runs alchemy.run.ts

Deletes the 3 wrangler*.toml files. Alchemy emits wrangler.json for
wrangler types + Miniflare local dev. CI swap from wrangler deploy
to bun alchemy.run.ts."
```

---

## Phase F — Coordination Services + Cutover

Goal: Land `AiSearchClient`, `OntologyExpertRepo`, `ExpertSearchService`. Wire the agent worker layer. Ship `populate-experts.ts`. Add a debug HTTP route. Verify end-to-end.

### Task 18: AiSearchClient service

**Files:**
- Create: `src/services/AiSearchClient.ts`
- Test: `tests/services/AiSearchClient.test.ts`

**Step 1: Write failing test**

Mock `env.AI_SEARCH` binding. Test that `upload` and `search` correctly delegate and that errors map to `AiSearchError`.

**Step 2: Run, verify fail.**

**Step 3: Implement** per architecture doc Section 3 — `ServiceMap.Service` + `Layer.effect`, `Effect.tryPromise` wrapping the binding.

**Step 4: Run, verify pass.**

**Step 5: Commit:**

```bash
git add src/services/AiSearchClient.ts tests/services/AiSearchClient.test.ts
git commit -m "feat(services): AiSearchClient over env.AI_SEARCH binding

ServiceMap.Service wrapping items.upload and search calls. Errors map
to AiSearchError tagged error per src/domain/errors.ts convention."
```

### Task 19: OntologyExpertRepo (D1)

**Files:**
- Create: `src/services/OntologyExpertRepo.ts` (interface)
- Create: `src/services/d1/OntologyExpertRepoD1.ts` (D1 impl)
- Test: `tests/services/OntologyExpertRepoD1.test.ts`

**Step 1: Write failing test**

Setup: in-memory D1 (`@cloudflare/workers-types` mock). Insert one row matching the legacy `experts` table shape. Call `getByIri` and assert it returns a fully decoded `Expert` (new shape) via `expertFromLegacyRow`.

**Step 2: Run, verify fail.**

**Step 3: Implement.** Define `OntologyExpertRepo` as `ServiceMap.Service` with methods `getByIri`, `getByIris`, `listAll`. Implementation reads D1 rows and pipes through `expertFromLegacyRow` (a transformer in `packages/ontology-store/src/agent/expert.ts` — add it now if not present).

`expertFromLegacyRow` shape:
```ts
export const expertFromLegacyRow = (row: LegacyExpertRow): Effect.Effect<Expert, ParseError> =>
  Schema.decodeUnknown(Expert)({
    iri: `https://w3id.org/energy-intel/expert/${row.handle}`,
    did: row.did,
    displayName: row.displayName ?? row.handle,
    roles: ["https://w3id.org/energy-intel/role/EnergyExpertRole/default"],
    bio: row.bio ?? undefined,
    tier: row.tier ?? undefined,
    primaryTopic: row.primaryTopic ?? undefined,
  })
```

**Step 4: Run, verify pass.**

**Step 5: Commit:**

```bash
git add src/services/OntologyExpertRepo.ts \
        src/services/d1/OntologyExpertRepoD1.ts \
        tests/services/OntologyExpertRepoD1.test.ts \
        packages/ontology-store/src/agent/expert.ts
git commit -m "feat(services): OntologyExpertRepo over D1

Reads legacy experts table; returns the new energy-intel Expert via
expertFromLegacyRow transformer. Coexists with legacy ExpertsRepo."
```

### Task 20: ExpertSearchService + Layer wiring + populate script

**Files:**
- Create: `src/services/ExpertSearchService.ts` (with `searchExperts`)
- Modify: `src/edge/Layer.ts` (add `agentSearchLayer`)
- Create: `scripts/populate-experts.ts`
- Test: `tests/services/ExpertSearchService.test.ts`

**Step 1: Write failing test for `searchExperts`**

Mock `AiSearchClient.search` to return canned chunks; mock `OntologyExpertRepo.getByIris` to return canned rows. Assert `searchExperts` decodes correctly to `Expert[]`.

**Step 2: Run, verify fail.**

**Step 3: Implement** per architecture doc Section 3 — `searchExperts` Effect program, `ExpertSearchService` ServiceMap.Service, Layer wiring delta in `src/edge/Layer.ts`.

**Step 4: Run, verify pass.**

**Step 5: Implement populate script**

`scripts/populate-experts.ts` builds the runtime layer (CloudflareEnv-backed for staging), reads all rows via `OntologyExpertRepo.listAll`, projects via `ExpertModule.toAiSearch{Key,Body,Metadata}`, uploads via `AiSearchClient.upload`. Bun script using `runScopedWithLayer` from `src/platform/EffectRuntime.ts`.

**Step 6: Run populate against staging**

Pre-req: staging `AI_SEARCH` binding provisioned (Task 16). Set staging credentials in `~/.cloudflare` or via `wrangler login`.

```bash
ALCHEMY_STAGE=staging bun scripts/populate-experts.ts
```

Expected: ≥10 records uploaded, AI Search dashboard shows them.

**Step 7: Commit**

```bash
git add src/services/ExpertSearchService.ts \
        src/edge/Layer.ts \
        scripts/populate-experts.ts \
        tests/services/ExpertSearchService.test.ts
git commit -m "feat(services): ExpertSearchService with searchExperts

Effect program: AI Search query → dedupe by item.key → repo lookup →
Schema.decodeUnknownEffect → ReadonlyArray<Expert>. Layer wired into
src/edge/Layer.ts (one new line per future entity). Population script
seeds the experts instance from D1."
```

### Task 21: Admin debug route + end-to-end verification

**Files:**
- Modify: `src/api/Router.ts` (or appropriate API entry point — verify file path) to add `GET /admin/search-experts?q=...` route
- Test: `tests/api/admin-search-experts.test.ts`

**Step 1: Write failing test**

```ts
it.effect("GET /admin/search-experts returns Expert[] from AI Search", () =>
  Effect.gen(function* () {
    const response = yield* httpClient.get("/admin/search-experts?q=hydrogen")
    const body = yield* response.json
    expect(body.experts).toBeInstanceOf(Array)
    expect(body.experts[0]).toHaveProperty("iri")
    expect(body.experts[0]).toHaveProperty("did")
  }),
)
```

**Step 2: Run, verify fail.**

**Step 3: Implement route**

Wire the route to `ExpertSearchService.searchExperts` via the new Layer. Encode response via `Schema.Array(Expert)`.

**Step 4: Run unit test, verify pass.**

**Step 5: Manual end-to-end against staging**

```bash
ALCHEMY_STAGE=staging bun alchemy.run.ts # ensure latest deployed
curl -H "Authorization: Bearer $OPERATOR_SECRET" \
  https://skygest-bi-agent-staging.<account>.workers.dev/admin/search-experts?q=hydrogen
```

Expected: JSON response with `experts: [{iri, did, displayName, roles, ...}]`.

**Step 6: Run full test suite + typecheck**

```bash
bun run typecheck && bun run test 2>&1 | tail -10
```

Expected: green. ≥1411 + new tests passing, 0 failing.

**Step 7: Final commit**

```bash
git add src/api/Router.ts tests/api/admin-search-experts.test.ts
git commit -m "feat(api): admin debug route for searchExperts

GET /admin/search-experts?q=... returns typed Expert[] from the
energy-intel AI Search instance. Auth via OPERATOR_SECRET. End-to-end
verified against staging."
```

---

## Acceptance Criteria

Before opening the PR for review:

- [ ] `bun run typecheck` green
- [ ] `bun run test` green (1411 baseline + new tests, 0 failures)
- [ ] `bun packages/ontology-store/scripts/generate-from-ttl.ts agent` runs idempotently; CI drift gate passes
- [ ] Round-trip test green on `Expert` (six phases all green)
- [ ] `bun alchemy.run.ts` deploys to staging cleanly; all bindings validate
- [ ] Population script uploads ≥10 `Expert` records to staging AI Search instance; dashboard confirms
- [ ] `GET /admin/search-experts?q=...` returns ≥1 typed Expert from a sample query
- [ ] No `src/` imports of Node built-ins introduced (verify via `grep -r "from \"node:" src/`)
- [ ] `packages/ontology-store/` content delta is net-negative LOC (verify via `git diff --stat main..HEAD packages/ontology-store/`)
- [ ] Commit history is clean — one logical commit per task, no fixup commits

## Reopen / Followup Triggers

Once this slice merges, the following are unblocked (per slicing strategy in the architecture doc):

- **Slice 2: Organization** (~3 days) — same agent module, recipe-replay
- **Slice 3: Post + Article from media.ttl** (~1.5 weeks) — second codegen lift (markdown projection default)
- **Ingest cutover** (~1 week) — DO + workflow + feed migrate to new types
- **Slice 4: Distribution + Dataset + Variable + Series** (~2 weeks) — heaviest, three codegen lifts
- **Slice 5: Measurement** (~1 week)
- **Slice 6: Cleanup** (~1 week) — delete `src/resolution/`, `src/search/`, legacy types

Total downstream effort: ~7 weeks for the rest of the energy-intel migration.
