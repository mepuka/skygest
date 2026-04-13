# SKY-320 — Structural codegen: DataLayerSpineManifest → generated field fragments

## 1. Context

SKY-316 landed `sevocab:Series` + SHACL shapes in the sibling ontology repo (commit
`458c5e4` on `kokokessy/sky-316-...`). SKY-321 landed the runtime-side JSON contract
(`src/domain/dataLayerSpineManifest.ts`, `references/data-layer-spine/manifest.json`,
`tests/data-layer-spine-manifest.test.ts` at commit `be4b962d`). SKY-320 is the final
slice in that chain: it builds `scripts/generate-data-layer-spine.ts`, which reads the
checked-in manifest and emits `src/domain/generated/dataLayerSpine.ts` — four
ontology-owned field fragments (`AgentOntologyFields`, `DatasetOntologyFields`,
`VariableOntologyFields`, `SeriesOntologyFields`) that the hand-written structs in
`src/domain/data-layer/catalog.ts` and `src/domain/data-layer/variable.ts` compose via
object spread. The generator must be deterministic, avoid hard-coding, and add no
runtime RDF/Turtle dependency to the Worker bundle.

## 2. Locked design decisions

1. **Emitter strategy → plain string templates (option a).**
   Effect 4's `SchemaRepresentation.toCodeDocument()` at
   `.reference/effect/packages/effect/src/SchemaRepresentation.ts:2288-2332` is a
   full-document emitter: it consumes a `MultiDocument` built from Effect's canonical
   JSON-Schema representations, topologically sorts references, and returns `CodeDocument`
   objects whose `codes` entries are complete `type`/`const` declaration pairs. It cannot
   emit object-literal *fragments* destined for `...spread` composition — the one
   downstream consumer in the Effect repo (`openapi-generator/src/JsonSchemaGenerator.ts`)
   uses it to emit whole `Schema.Struct` definitions with imports. Agent A's second
   suggestion (TypeScript compiler API via `ts.createPrinter`) would work, but introduces
   a second codegen dialect alongside the already-working `generate-energy-profile.ts`
   pattern (`scripts/generate-energy-profile.ts:99-152`), with no payoff at this scale
   (four classes, three scalar field kinds). Plain string templates match the sibling
   exactly, stay well under the maintenance-burden bar, and keep determinism trivial to
   audit. We revisit only if the field-kind dispatch table outgrows ~10 cases.

2. **Import-path registry → Path A, generator-side `const` map.**
   The manifest is ontology-authored; forcing the ontology team to hand-edit TypeScript
   import paths every time a new branded ID lands would couple the two repos in the wrong
   direction. A single `BRANDED_ID_IMPORT_PATH` record in
   `scripts/generate-data-layer-spine.ts` (keyed by `SpineBrandedIdRef`) plus a matching
   `CLOSED_ENUM_IMPORT_PATH` record (keyed by runtime enum name) keeps the entire
   runtime↔filesystem coupling inside the runtime repo. The registry is the *only* place
   that names `../data-layer/ids` or `../data-layer/catalog`. An exhaustive-key check
   against the `SpineBrandedIdRef` literal union makes adding a new branded ID a
   compile-time failure in the generator until the registry is updated (see §6).

3. **Field order → direct array iteration, locked by the existing drift guard plus a new
   generated-output snapshot.** The manifest's `classes[X].fields` array is already the
   source of truth — we iterate it positionally and never re-sort. The drift test
   (`tests/data-layer-spine-manifest.test.ts`) already locks *field presence*; the new
   `tests/data-layer-spine-generation.test.ts` adds a byte-equality check against a
   re-generated output, which implicitly locks field *order* without introducing a
   separate snapshot artifact. A keyed-map approach would silently tolerate reordering
   and is rejected.

4. **New `SpineFieldType` variant → fail loudly via exhaustive switch with `never`
   assertion.** The generator dispatches on the discriminated union (`brandedId`,
   `literal`, `closedEnum`, `struct`, `webUrl`, `dateLike`, `isoTimestamp`, plus their
   `*Array` siblings) inside a single `renderFieldType` function; the `default` branch
   calls `assertNever(type)` to trigger a compile-time error the next time
   `SpineFieldType` in `src/domain/dataLayerSpineManifest.ts:82-93` grows a new variant.
   Warning-and-skip would produce silently wrong generated code; feature-flagging would
   delay pain.

5. **Metadata placement → header comment only.** `sourceCommit`, `generatedAt`,
   `inputHash` flow into the leading JSDoc block verbatim — never into `export const`
   values. This matches `src/domain/generated/energyVariableProfile.ts` (the
   `renderGeneratedProfile` header at `scripts/generate-energy-profile.ts:115-124`) and
   is the single biggest determinism lever: it keeps the *body* of the generated file
   stable across reruns with the same manifest, so CI and local re-runs produce
   byte-identical content *within* the file. The header block is tolerated as the one
   known-changing region only because the deterministic-generation test regenerates from
   the pinned manifest and compares full-file bytes (including header).

6. **`manifestVersion` mismatch → automatic via `Schema.Literal(1)`.**
   `DataLayerSpineManifest` at `src/domain/dataLayerSpineManifest.ts:195` already encodes
   `manifestVersion: Schema.Literal(1)`, so any bump decodes as a
   `DataLayerSpineManifestLoadError` with a Schema-formatted issue string. We do not add
   a separate human-readable guard — the Schema error is already structured, actionable,
   and consistent with the sibling `EnergyProfileManifest` pattern.

## 3. Architecture

```
references/data-layer-spine/manifest.json        (ontology-authored, checked in)
                │
                ▼  Schema.parseJson(DataLayerSpineManifest)
scripts/generate-data-layer-spine.ts              (Bun + Effect CLI)
                │
                ▼  renderSpineFile(manifest, BRANDED_ID_IMPORT_PATH, CLOSED_ENUM_IMPORT_PATH)
src/domain/generated/dataLayerSpine.ts            (four `export const *OntologyFields`)
                │
                ▼  import + object spread
src/domain/data-layer/catalog.ts                  (Agent, Dataset)
src/domain/data-layer/variable.ts                 (Variable, Series)
                │
                ▼  bun run test
tests/data-layer-spine-generation.test.ts         (re-runs generator, asserts bytes equal)
tests/data-layer-spine-manifest.test.ts           (existing drift guard, unchanged this slice)
```

No runtime code imports `n3`, Turtle, or SPARQL. The generator lives in `scripts/` and
is the only place that touches the filesystem.

## 4. File-by-file implementation plan

### 4.1 `src/domain/errors.ts` — add two tagged errors

Follow the existing `EnergyProfileManifestLoadError` / `EnergyProfilePipelineError`
shape (`src/domain/errors.ts:293-310`, referenced by Research Report 2). Add:

- `DataLayerSpineManifestLoadError` — fields: `message: Schema.String`,
  `path: Schema.String`, `issues: Schema.Array(Schema.String)`.
- `DataLayerSpineGenerationError` — fields: `operation: Schema.String`,
  `path: Schema.String`, `message: Schema.String`.

Both defined via `Schema.TaggedErrorClass`. No plain `throw`; the generator yields them.
Satisfies the "dedicated `DataLayerSpineGenerationError`" acceptance bullet.

### 4.2 `scripts/generate-data-layer-spine.ts` — new generator

Mirrors `scripts/generate-energy-profile.ts` one-for-one on structure:

- `Command.make` + `Flag.string` CLI built on `effect/unstable/cli`.
- Flags: `--manifest` (default `references/data-layer-spine/manifest.json`),
  `--output` (default `src/domain/generated/dataLayerSpine.ts`).
- Uses `FileSystem.FileSystem` and `Path.Path` from `effect` — no `node:fs`/`node:path`.
- JSON decode via `decodeJsonStringEitherWith(DataLayerSpineManifest)` from
  `src/platform/Json.ts:32-34`; format errors with `formatSchemaParseError`
  (`src/platform/Json.ts:39-40`). Never `JSON.parse`.
- Boot via `runScriptMain` + `scriptPlatformLayer` (`src/platform/ScriptRuntime.ts:7-27`).

**Internal structure (pure helpers):**

```
const BRANDED_ID_IMPORT_PATH: Record<SpineBrandedIdRef, string> = {
  AgentId: "../data-layer/ids",
  DatasetId: "../data-layer/ids",
  // ... all nine entries from SpineBrandedIdRef (dataLayerSpineManifest.ts:43-53)
};

const CLOSED_ENUM_IMPORT_PATH: Record<string, string> = {
  AgentKind:        "../data-layer/catalog",
  DistributionKind: "../data-layer/catalog",
  AccessRights:     "../data-layer/catalog",
  Cadence:          "../data-layer/catalog",
  StatisticType:    "../data-layer/variable-enums",
  Aggregation:      "../data-layer/variable-enums",
  UnitFamily:       "../data-layer/variable-enums",
};
```

Helpers (all pure, all deterministic):

- `renderFieldType(type: SpineFieldType): { expr: string; imports: ReadonlySet<Import> }`
  — exhaustive `switch (type._tag)` with `assertNever` default. Maps each variant to a
  `Schema.*` call: `brandedId`→`<BrandedId>`, `brandedIdArray`→`Schema.Array(<BrandedId>)`,
  `literal`→`Schema.String|Number|Boolean`, `closedEnum`→`<EnumName>`,
  `struct`→`<StructName>`, `webUrl`→`WebUrl`, `dateLike`→`DateLike`,
  `isoTimestamp`→`IsoTimestamp`.
- `renderFieldLine(field: SpineFieldSpec)` — wraps the type expression in
  `Schema.optionalKey(...)` if `field.optional` is true, then prefixes
  `${field.runtimeName}: ` and emits an ontology-IRI trailing comment
  (`// <ontologyIri>`) when non-null. Also adds the `DcatProperty` annotation as
  `.annotate({ [DcatProperty]: "<iri>" })` if the source field already carried one —
  which, for this slice, means we preserve the IRI but defer the `DcatProperty` symbol
  import decision to §4.3 (we *emit* the annotation only when the manifest declares
  `ontologyIri` non-null AND the hand-written wrapper currently carries one, matching
  the annotation-survival matrix from Research Report 2).
- `renderFragment(className, classSpec)` — filters to
  `field.generation === "generated"`, iterates positionally, joins lines, wraps in
  `export const ${className}OntologyFields = {` ... `} as const;`.
- `collectImports(manifest)` — walks every generated field, aggregates branded-IDs and
  closed-enums into a `Map<path, Set<name>>`, sorts paths lexicographically, sorts names
  within each group, emits stable `import { a, b } from "path";` lines. Only imports
  symbols that are actually referenced.
- `renderHeader(manifest)` — JSDoc block with source path, manifest version, source
  commit, input hash, `bun run gen:data-layer-spine` (matches
  `scripts/generate-energy-profile.ts:115-124`).
- `renderSpineFile(manifest)` — composes header + imports + annotation import
  (`DcatProperty` from `../data-layer/annotations` when any field carries an IRI) +
  four fragments in fixed order: `Agent`, `Dataset`, `Variable`, `Series`.

**Effect flow** (`Effect.fn("generate-data-layer-spine.run")`):
1. Read manifest file (mapError → `DataLayerSpineGenerationError`).
2. Decode via `decodeJsonStringEitherWith` (`Result.isFailure` → `DataLayerSpineManifestLoadError`).
3. Call `renderSpineFile(manifest)` (pure, no Effect).
4. `makeDirectory` + `writeFileString` (both mapError → `DataLayerSpineGenerationError`).
5. `Console.log` success.

Satisfies: script path, `gen:data-layer-spine` entry point, JSON decode via existing
helpers, no Turtle dependency, structured errors.

### 4.3 `src/domain/generated/dataLayerSpine.ts` — sample generated shape

```ts
/**
 * AUTO-GENERATED. DO NOT EDIT.
 *
 * Source manifest: references/data-layer-spine/manifest.json
 * Manifest version: 1
 * Source commit: <from manifest>
 * Input hash: <from manifest>
 * Generation command: bun run gen:data-layer-spine
 */

import { Schema } from "effect";
import { DcatProperty } from "../data-layer/annotations";
import { DateLike, WebUrl } from "../data-layer/base";
import { DatasetId, VariableId /* ... */ } from "../data-layer/ids";

export const AgentOntologyFields = {
  name: Schema.String.annotate({ [DcatProperty]: "http://xmlns.com/foaf/0.1/name" }),
  alternateNames: Schema.optionalKey(Schema.Array(Schema.String)),
  homepage: Schema.optionalKey(WebUrl.annotate({ [DcatProperty]: "http://xmlns.com/foaf/0.1/homepage" })),
} as const;

export const DatasetOntologyFields = { /* title, description, creatorAgentId, ... */ } as const;
export const VariableOntologyFields = { /* seven sevocab facets */ } as const;
export const SeriesOntologyFields = {
  label: Schema.String,
  variableId: VariableId,
  datasetId: Schema.optionalKey(DatasetId), // optional in v1 per SKY-321 deferredTightening
} as const;
```

File is the single output of `renderSpineFile`. No hand-edits permitted (header banner).

### 4.4 `src/domain/data-layer/catalog.ts` — compose fragments

**Agent** (currently `catalog.ts:44-62`): replace `name`, `alternateNames`, `homepage`
with `...AgentOntologyFields`. `_tag`, `id`, `kind`, `parentAgentId`, and
`TimestampedAliasedFields` stay hand-written. The struct-level
`.annotate({ [DcatClass], [DesignDecision] })` stays on the hand-written wrapper
(annotation-survival matrix).

```ts
export const Agent = Schema.Struct({
  _tag: Schema.Literal("Agent"),
  id: AgentId,
  kind: AgentKind,
  ...AgentOntologyFields,
  parentAgentId: Schema.optionalKey(AgentId),
  ...TimestampedAliasedFields
}).annotate({ /* unchanged */ });
```

**Dataset** (currently `catalog.ts:142-195`): replace the 13 ontology-owned fields
(`title`, `description`, `creatorAgentId`, `wasDerivedFrom`, `publisherAgentId`,
`landingPage`, `license`, `temporal`, `keywords`, `themes`, `variableIds`,
`distributionIds`, `inSeries`) with `...DatasetOntologyFields`. `accessRights` and
`dataServiceIds` remain hand-written. Catalog, CatalogRecord, Distribution, DataService,
DatasetSeries are untouched in this slice.

### 4.5 `src/domain/data-layer/variable.ts` — compose fragments

**Variable** (`variable.ts:43-62`): replace the seven facet fields
(`measuredProperty`, `domainObject`, `technologyOrFuel`, `statisticType`, `aggregation`,
`unitFamily`, `policyInstrument`) with `...VariableOntologyFields`. `_tag`, `id`,
`label`, `definition`, and `TimestampedAliasedFields` stay hand-written. Struct-level
`SchemaOrgType` / `SdmxConcept` / `DesignDecision` annotations stay on the wrapper.

**Series** (`variable.ts:68-80`): replace `label` and `variableId` with
`...SeriesOntologyFields`. `_tag`, `id`, `fixedDims`, and `TimestampedAliasedFields`
stay hand-written. Critically, `SeriesOntologyFields` will introduce a new
`datasetId: Schema.optionalKey(DatasetId)` field that the runtime Series struct does
*not* currently have — spreading the fragment adds it. Research Report 2 flagged this:
the runtime field is absent today and SKY-317 will backfill construction sites. The
`deferredTightening` note in the manifest documents the eventual move to required.

### 4.6 `src/db/migrations.ts`, `src/services/d1/SeriesRepoD1.ts`, `src/resolution/dataLayerRegistry.ts` — Series.datasetId alignment

The first draft of this plan left `Series.datasetId` type-only, which would have been
incorrect: the current `series` table has no `dataset_id` column and `SeriesRepoD1`
maps fields manually, so real values would be silently dropped on write/read. This
slice therefore owns the storage + lookup alignment as well.

- Add a new D1 migration that idempotently adds nullable `dataset_id TEXT` to
  `series` plus `idx_series_dataset_id`. The original `CREATE TABLE series` statement
  in migration 22 should also include `dataset_id TEXT` so empty databases land on the
  aligned schema immediately.
- Extend `SeriesRowSchema` / `SeriesUpsertRowSchema` in `SeriesRepoD1` with
  `dataset_id: Schema.NullOr(Schema.String)`, decode `null` → omitted runtime field,
  and encode `series.datasetId ?? null` on writes. This preserves the optional runtime
  contract while ensuring values are not lost once callers start sending them.
- Update registry preparation to understand `Series.datasetId` when present:
  validate that it points at a `Dataset`, and use `Series.datasetId + Series.variableId`
  as an additional source for dataset↔variable lookups so D1-loaded registries can
  reflect the new structural link without regressing existing `Dataset.variableIds`
  consumers during the transition.

### 4.7 `tests/data-layer-spine-generation.test.ts` — new

Uses `@effect/vitest`, runs under `bun run test`. Covers:

1. **Deterministic generation.** Run the generator twice against the checked-in
   manifest, writing to two temp paths; assert byte equality of the two outputs.
2. **Matches checked-in file.** Regenerate against the checked-in manifest and
   `readFileString` the committed `src/domain/generated/dataLayerSpine.ts`; assert
   byte equality. This catches any drift between manifest and committed output.
3. **Header contains manifest metadata.** Assert the header block contains
   `sourceCommit`, `inputHash`, `manifestVersion: 1`.
4. **Imports are stable under repeated runs.** Covered implicitly by (1) + (2) but
   called out as a regression site.
5. **Field order locked.** Modify a clone of the manifest in memory to reorder
   `classes.Variable.fields`, run `renderSpineFile` on both, assert the generated
   output differs. Proves reordering is visible (not silently absorbed).
6. **Optionality match.** For each generated field, assert `Schema.optionalKey(...)`
   appears in the output iff `field.optional` is true.

### 4.8 `tests/data-layer-spine-manifest.test.ts` — drift guard update

Remove `Series.datasetId` from the forward-looking allowlist now that the runtime
schema grows the field in this slice. The existing drift checks should then pass
without exemptions. *Optionality-match* assertion remains deferred to §10.

### 4.9 `tests/migrations.test.ts`, `tests/data-layer-registry-repos.test.ts` — persistence coverage

- Add migration assertions proving `series.dataset_id` exists and is nullable on both
  a fresh database and an upgrade from a pre-SKY-320 shape.
- Extend the Series repo round-trip test to persist a `datasetId`, reload it, and
  confirm the value survives.
- Add a registry test that proves a dataset/variable relationship is discoverable via
  `Series.datasetId + Series.variableId` even when `Dataset.variableIds` is absent.

### 4.10 `package.json` — script entry

Add under `"scripts"`:

```json
"gen:data-layer-spine": "bun scripts/generate-data-layer-spine.ts"
```

Mirrors the existing `gen:energy-profile` entry.

## 5. Determinism guarantees

- Manifest is the single input. Reruns with the same manifest bytes produce identical
  output bytes (asserted by the new test).
- Field iteration uses the manifest's `fields` array order verbatim; no sorting.
- Imports are deduplicated via `Map<path, Set<name>>`, then paths sorted
  lexicographically, names within each path sorted lexicographically.
- Metadata (`sourceCommit`, `generatedAt`, `inputHash`) only in the header JSDoc, never
  in exported values. Re-running with unchanged manifest reproduces the header too
  (all three fields come from the manifest, not from runtime `Date.now()`).
- No ULID minting, no `new Date()`, no `Math.random()`.
- Generator is pure except at the filesystem boundary (`readFileString`,
  `writeFileString`).

## 6. Brittleness guards

- `renderFieldType` uses exhaustive `switch (type._tag)` with
  `default: assertNever(type)` — new `SpineFieldType` variants are compile-time
  failures.
- `BRANDED_ID_IMPORT_PATH` is typed as `Record<SpineBrandedIdRef, string>` — new
  entries in the `SpineBrandedIdRef` literal union
  (`src/domain/dataLayerSpineManifest.ts:43-53`) force a compile-time error until the
  map is updated.
- `CLOSED_ENUM_IMPORT_PATH` is a free-form `Record<string, string>` — protected by
  test (3) in §4.6: missing an entry produces an unresolved import in the generated
  file, which fails `bun run typecheck` in the generation test's compile step (or the
  CI typecheck job on commit).
- `manifestVersion` is a `Schema.Literal(1)` — any future bump surfaces as a
  structured decode failure at generator startup.
- Existing drift guard (`tests/data-layer-spine-manifest.test.ts`) catches runtime
  field additions/removals that diverge from the manifest.

## 7. Test plan

`tests/data-layer-spine-generation.test.ts` covers the must-have invariants from
Research Report 3:

| Invariant | Test |
|---|---|
| Field order locked | §4.6 test (2) byte-equality + test (5) reorder diff |
| Exhaustive `SpineFieldType` switch | Compile-time via `assertNever`; no runtime test needed |
| `manifestVersion` invariant | `DataLayerSpineManifestLoadError` smoke test with `manifestVersion: 2` fixture |
| Import-path registry correctness | Test (2) fails at typecheck if a registry entry is missing |
| Deterministic output | Test (1) byte equality across two runs |
| Optionality match | Test (6) |
| `Series.datasetId` persistence | §4.9 repo round-trip + migration assertions |
| Dataset↔variable lookup alignment | §4.9 registry test |

No snapshot files committed — the checked-in
`src/domain/generated/dataLayerSpine.ts` *is* the snapshot, and test (2) validates it.

## 8. Acceptance criteria mapping

| SKY-320 acceptance criterion | Plan section |
|---|---|
| SKY-321 lands first (already done) | §1 |
| `scripts/generate-data-layer-spine.ts` generates `src/domain/generated/dataLayerSpine.ts` from checked-in manifest | §4.2 + §4.3 |
| Fragment composition, not full generated struct | §4.3 (four `*OntologyFields` objects) + §4.4, §4.5 (hand-written structs compose via `...spread`) |
| Generated field names exactly match runtime camelCase | §4.2 `renderFieldLine` emits `field.runtimeName` verbatim; drift guard locks |
| Series.datasetId optional in first slice | §4.5 + manifest already encodes `optional: true` |
| Series.datasetId is stored instead of being silently dropped | §4.6 + §4.9 |
| Tests prove determinism and catch field-name drift | §4.7 + updated §4.8 |
| No RDF/SPARQL runtime stack, no Turtle parser | §4.2 uses only `effect` + `src/platform/Json.ts`; no `n3`, no SPARQL |
| `DataLayerSpineGenerationError` exists | §4.1 |
| Reuse existing JSON decode helpers | §4.2 uses `decodeJsonStringEitherWith` |

## 9. Out of scope

- Runtime RDF/OWL reasoning or SPARQL evaluation.
- Replacing hand-written structs wholesale with generated code (Catalog, CatalogRecord,
  Distribution, DataService, DatasetSeries, Observation remain fully hand-written).
- SKY-317 Distribution→Series construction-site migration for the new
  `Series.datasetId` field beyond the runtime/storage/lookup support landed here.
- Tightening `Series.datasetId` from optional to required (future ticket).
- Additional `SpineBrandedIdRef` entries or new spine classes — requires manifest
  version bump.
- Ontology update / SHACL regeneration — upstream SKY-316 territory.

## 10. Open follow-ups

- **SKY-317**: backfill `Series.datasetId` at every construction site so the manifest
  can eventually tighten `optional: false`.
- **Optionality-match drift guard**: extend `tests/data-layer-spine-manifest.test.ts`
  to assert that `field.optional` in the manifest matches `Schema.optionalKey` usage
  in the hand-written wrapper for generated fields. Deferred in this PR to avoid
  blocking on Series.datasetId's transitional state.
- **Closed-enum import registry typing**: once the `closedEnums` section of the
  manifest stabilises, lift `CLOSED_ENUM_IMPORT_PATH` to a typed union mirroring the
  runtime enum names, so a missing entry becomes a compile-time rather than runtime
  error.
- **Re-evaluate Effect `toCodeDocument()`**: if a future slice needs to emit whole
  `Schema.Struct` declarations (rather than fragments) — e.g. fully generated D1 row
  schemas — that is the natural point to reconsider the Effect-native emitter, since
  its output shape lines up with that use case.
