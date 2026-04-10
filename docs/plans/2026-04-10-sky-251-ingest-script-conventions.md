# Cold-Start Ingest Script Conventions — Shared

> **Scope:** every Bun-runnable ingestion script under `scripts/cold-start-ingest-*.ts` and the harness module at `src/ingest/dcat-harness/` (post-SKY-257). Applies to SKY-254, SKY-257, SKY-258, SKY-259, SKY-260, SKY-261, SKY-262, SKY-263.
> **Parent tracking issue:** [SKY-251 — Cold-start registry expansion](https://linear.app/pure-logic-industrial/issue/SKY-251)

This document is the single source of truth for **runtime layering**, **configuration**, and **observability** patterns that all cold-start ingest scripts must follow. It exists because the in-flight SKY-254 EIA implementation has converged on Effect-native platform-bun backing + the codebase already has centralized `Config`, `Json`, `Logging`, and `LocalPersistence` modules in `src/platform/` that scripts should consume rather than redefine.

The conventions below are derived from two parallel codebase audits dispatched on 2026-04-10. Both audit briefs are summarized inline; the source patterns cited come from the production codebase (Worker services, sibling scripts, and existing platform modules).

---

## 1. Runtime layering — `BunServices` + a shared `ScriptRuntime` module

### Current state

The EIA ingest script currently merges Bun layers by hand:

```ts
// scripts/cold-start-ingest-eia.ts:14-16, 2143-2152
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import * as BunRuntime from "@effect/platform-bun/BunRuntime";

// at the bottom:
main.pipe(
  Effect.provide(
    Layer.mergeAll(
      BunFileSystem.layer,
      BunPath.layer,
      FetchHttpClient.layer
    )
  ),
  Effect.tapError((error) => Effect.logError(stringifyUnknown(error))),
  BunRuntime.runMain
);
```

`scripts/cold-start-migrate-eia-bulk-id.ts` and the (new) cluster adapter scripts will all repeat this footer. There is **no** shared `mainAppLayer` / `scriptRuntimeLayer` in `src/platform/` today — every script hand-merges the same three layers.

### What `@effect/platform-bun` actually provides

`BunServices.layer` is the v4 successor to the old `BunContext.layer`. From `node_modules/@effect/platform-bun/dist/BunServices.d.ts:14-19`:

```ts
export const layer: Layer.Layer<
  | ChildProcessSpawner
  | FileSystem
  | Path
  | Terminal
  | Stdio
>
```

It bundles `FileSystem | Path | Terminal | Stdio | ChildProcessSpawner` in one layer. **Zero files in `src/` or `scripts/` currently import it** — we should adopt it everywhere.

### Convention — create `src/platform/ScriptRuntime.ts`

A new tiny module that bundles the common Bun script runtime + the standard error tap + `runMain` invocation:

```ts
// src/platform/ScriptRuntime.ts
import { Effect, Layer, Logger } from "effect";
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunServices from "@effect/platform-bun/BunServices";
import { FetchHttpClient } from "effect/unstable/http";
import { Logging } from "./Logging";
import { stringifyUnknown } from "./Json";

/**
 * The standard Bun script platform layer. Bundles:
 *   - BunServices.layer (FileSystem | Path | Terminal | Stdio | ChildProcessSpawner)
 *   - FetchHttpClient.layer (HttpClient)
 *   - Logging.layer (Logger.consoleJson)
 *
 * Provider-specific scripts merge this with any extra layers they need
 * (e.g. localPersistenceLayer for walk caches, SqliteClient.layer for
 *  build-stage1-eval-snapshot.ts).
 */
export const scriptPlatformLayer = Layer.mergeAll(
  BunServices.layer,
  FetchHttpClient.layer,
  Logging.layer
);

/**
 * Standard script entry point. Provides scriptPlatformLayer, taps any
 * top-level error to a structured log line, and dispatches BunRuntime.runMain.
 *
 * Usage:
 *   const main = Effect.fn("EiaIngest.main")(function* () { ... });
 *   if (import.meta.main) runScriptMain("EiaIngest", main);
 */
export const runScriptMain = <A, E>(
  scriptName: string,
  effect: Effect.Effect<A, E, never>
) =>
  effect.pipe(
    Effect.tapError((error) =>
      Effect.logError(`${scriptName} failed`).pipe(
        Effect.annotateLogs({
          errorTag: (error as { _tag?: string })._tag ?? "unknown",
          message: stringifyUnknown(error)
        })
      )
    ),
    BunRuntime.runMain
  );
```

After this lands, the EIA script footer becomes:

```ts
import { scriptPlatformLayer, runScriptMain } from "../src/platform/ScriptRuntime";

if (import.meta.main) {
  runScriptMain(
    "EiaIngest",
    main.pipe(Effect.provide(scriptPlatformLayer))
  );
}
```

That's −20 lines (imports + footer) per script and a single point of change for cross-cutting platform concerns.

### Where extra layers go

Some scripts need more than the platform baseline:

- **EIA ingest** also needs `localPersistenceLayer(...)` for the walk cache (`Persistable.Class` + `Persistence.Persistence`). This is provided **scoped** inside `getWalkData`, not as a global runtime layer, because the persistence directory is computed from `config.rootDir`. Keep this scoped.
- **Eval snapshot builder** needs `SqliteClient.layer` for D1 reads. Merge inline with `scriptPlatformLayer`:
  ```ts
  Layer.mergeAll(scriptPlatformLayer, SqliteClient.layer(...))
  ```
- **CKAN / SDMX / PX-Web adapters** only need the platform baseline + their fetch layer (already covered by `FetchHttpClient.layer` inside `scriptPlatformLayer`).

### Cleanup target

`scripts/build-stage1-eval-snapshot.ts:67-146` currently hand-builds an entire `FileSystem.FileSystem` from `node:fs/promises` via `Layer.succeed`. After `ScriptRuntime.ts` lands, retrofit that script to drop ~80 lines and use `scriptPlatformLayer` + the SQLite layer it actually needs.

---

## 2. Configuration — `src/platform/ConfigShapes.ts` is the registry

### Current state

`src/platform/ConfigShapes.ts:31-105` is the centralized "keys-as-records" registry. Each concern has its own record of `Config<T>` values:

```ts
export const WorkerKeys = { /* publicApi, ingestShardCount, ... */ }
export const WorkerDeployKeys = { /* same as Worker but stricter */ }
export const TwitterKeys = { /* twitterCookiePath */ }
export const EnrichmentKeys = { /* googleApiKey, visionModel */ }
export const OperatorKeys = { /* operatorSecret, baseUrl */ }
```

These records compose into services via `Config.all(WorkerKeys)` (`src/platform/Config.ts:6-14`). Two helpers exist as **module-private** today:

```ts
// src/platform/ConfigShapes.ts:14-27
const nonEmptyRedacted = (name: string) =>
  Config.redacted(name).pipe(Config.mapOrFail(...))

// src/platform/ConfigShapes.ts:78-91
const nonEmptyString = (name: string) =>
  Config.string(name).pipe(Config.mapOrFail(...))
```

**They need to be exported** so cold-start scripts can use the same "reject empty string / missing required secret" semantics the rest of the codebase enforces.

### Convention — add a `…IngestKeys` record per script

Every cold-start ingest script declares its config keys as a **named record** in `ConfigShapes.ts`, alongside `WorkerKeys`:

```ts
// src/platform/ConfigShapes.ts (new section, added per ingest script)

export const ColdStartCommonKeys = {
  rootDir: Config.withDefault(Config.string("COLD_START_ROOT"), "references/cold-start"),
  dryRun: Config.withDefault(Config.boolean("COLD_START_DRY_RUN"), false),
  noCache: Config.withDefault(Config.boolean("COLD_START_NO_CACHE"), false)
} as const;

export const EiaIngestKeys = {
  ...ColdStartCommonKeys,
  apiKey: nonEmptyRedacted("EIA_API_KEY"),
  minIntervalMs: Config.withDefault(Config.int("EIA_MIN_INTERVAL_MS"), 250),
  maxRetries: Config.withDefault(Config.int("EIA_MAX_RETRIES"), 4),
  cacheTtlDays: Config.withDefault(Config.int("EIA_WALK_CACHE_TTL_DAYS"), 30),
  onlyRoute: Config.option(Config.string("EIA_ONLY_ROUTE"))
} as const;

// Future cluster scripts each get their own record:
export const NoaaCdoIngestKeys = {
  ...ColdStartCommonKeys,
  token: nonEmptyRedacted("NOAA_CDO_TOKEN"),
  minIntervalMs: Config.withDefault(Config.int("NOAA_CDO_MIN_INTERVAL_MS"), 200)
} as const;

export const CkanIngestKeys = {
  ...ColdStartCommonKeys,
  baseUrl: nonEmptyString("CKAN_BASE_URL"),
  organizationFilter: Config.option(Config.string("CKAN_ORGANIZATION")),
  publisherFilter: Config.option(Config.string("CKAN_PUBLISHER")),
  queryScope: Config.option(Config.string("CKAN_QUERY_SCOPE"))
} as const;
```

The **`ColdStartCommonKeys`** record is the cross-script common ground (`rootDir` + `dryRun` + `noCache`). Each script spreads it into its own record and adds script-specific keys.

### Convention — script imports the record, calls `Config.all`

```ts
// scripts/cold-start-ingest-eia.ts (after refactor)
import { Config } from "effect";
import { EiaIngestKeys } from "../src/platform/ConfigShapes";

export const ScriptConfig = Config.all(EiaIngestKeys);
export type ScriptConfigShape = Config.Success<typeof ScriptConfig>;
```

Drops the inline `Config.all({...})` declaration. All env-var names live in `ConfigShapes.ts` so future audits / docs / `validateKeys`-based health endpoints can find every env var the project consumes from one location.

### Optional — use `validateKeys` for fail-fast validation

`src/platform/ConfigValidation.ts:40-86` exposes `validateKeys(keys, provider)` — resolves every key independently and aggregates failures into a `ConfigValidationError`. Currently only consumed by `AppConfig.validate` for the `/health` endpoint, but it's generic. Cold-start scripts can adopt it for fail-fast startup:

```ts
const config = yield* validateKeys(EiaIngestKeys, ConfigProvider.fromEnv());
```

This is a **nice-to-have** — bare `Config.all` already aggregates errors well enough for ingest scripts.

### What NOT to do

- **Do not import `src/platform/Config.ts` or `src/platform/Env.ts`** from cold-start scripts. Both are Cloudflare Worker bindings (`CloudflareEnv extends ServiceMap.Service<..., EnvBindings>` carrying `D1Database` / `KVNamespace` / `Workflow<>`). They have nothing to do with Bun script env-var reading.
- **Do not** declare `ScriptConfig` inline in the script file. It belongs in `ConfigShapes.ts`.

---

## 3. Walk caches — use `Persistable` + `localPersistenceLayer`, NOT raw FileSystem writes

### Current state

The EIA script already does this correctly (lines 321-329 + 545 + 608). The walk cache is modeled as a `Persistable.Class` keyed by a fingerprint, and `getWalkData` provides `localPersistenceLayer(hiddenCacheDirectory)` scoped to the call. On `PlatformError` it falls back to `Persistence.layerMemory`.

### Convention — clone the EIA pattern

```ts
import { Persistable, Persistence, KeyValueStore } from "effect/unstable/persistence";
import { localPersistenceLayer } from "../src/platform/LocalPersistence";

class WalkCacheRequest extends Persistable.Class<WalkCacheRequest>()(
  "WalkCacheRequest",
  { primaryKey: Schema.String },
  WalkCacheSnapshot  // success schema
) {}

const getWalkData = (config: ScriptConfigShape) =>
  Effect.gen(function* () {
    const persistence = yield* Persistence.Persistence;
    const store = yield* persistence.make({ storeId: "walk-cache", timeToLive: ttl });
    const cached = yield* store.get(new WalkCacheRequest({ primaryKey: fingerprint }));
    if (Option.isSome(cached)) return cached.value;
    // ... fetch fresh, store.set, return
  }).pipe(
    Effect.provide(
      localPersistenceLayer(hiddenCacheDirectory).pipe(
        Layer.catchAll(() => Persistence.layerMemory)
      )
    )
  );
```

### What stays as raw FileSystem writes

The **build report artifact** (`reports/harvest/eia-api-v2-walk.json`) is intentionally written via `FileSystem.writeFileString` because it lands at a git-tracked path for human-auditable diff review. Persistence-managed entries live under an opaque KV store directory and are not appropriate for git tracking. **Don't move the artifact write to Persistence — it's correct as-is.**

### What NOT to do

- **Do not** hand-roll a `WalkCache` Schema with `readWalkCache` / `writeWalkCache` Effect functions reading/writing JSON files. Use `Persistable.Class` + `Persistence`.
- **Do not** inline `node:fs` calls for cache storage — it violates CLAUDE.md rule #7 (no Node imports in `src/`; scripts may use `BunServices.layer` instead).

---

## 4. Observability — `Logging.layer` + `Effect.fn` spans + structured `annotateLogs`

### Current state

`src/platform/Logging.ts` exports two things:

```ts
// src/platform/Logging.ts (full file, 9 lines)
import { Effect, Layer, Logger } from "effect";

export const Logging = {
  layer: Logger.layer([Logger.consoleJson]),
  withContext:
    (annotations: Record<string, string | number | boolean>) =>
    <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(Effect.annotateLogs(annotations))
};
```

`Logging.layer` is wired into the **Worker runtime** via `src/edge/Layer.ts:46-51` and `src/enrichment/Layer.ts:35-40`, so every Worker request handler emits JSON logs. **Scripts under `scripts/` and `src/scripts/` do not currently provide it** — they inherit Effect's default pretty logger.

The dominant codebase pattern for spans is **`Effect.fn("<Module>.<method>")(function* …)`**, used by 15+ services (`src/services/OntologyCatalog.ts:249`, `src/resolution/Stage1Resolver.ts:31`, `src/services/PipelineStatusService.ts:7-42`, `src/services/d1/KnowledgeRepoD1.ts:755-1300`, `src/scripts/build-expert-seeds.ts:77-85, 223-234`, `src/ops/Cli.ts:133-176`, `src/enrichment/SourceAttributionExecutor.ts:48-89`, `src/enrichment/GeminiVisionServiceLive.ts:360-595`, etc.).

`Effect.withSpan` is used in **only one place** (`src/services/OntologyCatalog.ts:275, 283, 290, 297`), with the convention `"<Service>.<method>"` and **no attributes argument** (attributes go on log records, not on the span itself).

### Convention — provide `Logging.layer` from every script

Add `Logging.layer` to the `scriptPlatformLayer` in `src/platform/ScriptRuntime.ts` (already shown in §1). Every cold-start script then emits JSON-structured logs to stdout, matching the Worker runtime's log shape and making per-stage tail/grep + log-archive ingestion uniform.

### Convention — wrap units of work with `Effect.fn("<Script>.<step>")`

Every Stage 1/2/3 unit of work is an `Effect.fn` with a dotted name. **No `attributes` argument** (matching `OntologyCatalog.ts`). Attributes go on log records.

```ts
const fetchRoute = Effect.fn("EiaIngest.fetchRoute")(function* (
  route: string, apiKey: string
) {
  // ...
});

const validateCandidates = Effect.fn("EiaIngest.validateCandidates")(function* (
  candidates: ReadonlyArray<IngestNode>
) {
  // ...
});

const main = Effect.fn("EiaIngest.main")(function* () {
  // ...
});
```

### Span name reference (per script)

| Script | Span names |
|---|---|
| **EIA ingest** | `EiaIngest.main`, `EiaIngest.getWalkData`, `EiaIngest.fetchRoute`, `EiaIngest.loadCatalogIndex`, `EiaIngest.buildContextFromIndex`, `EiaIngest.buildCandidateNodes`, `EiaIngest.validateCandidates`, `EiaIngest.buildIngestGraph`, `EiaIngest.checkAcyclicity`, `EiaIngest.writeNode`, `EiaIngest.loadLedger`, `EiaIngest.saveLedger`, `EiaIngest.emitReport` |
| **Harness** | `DcatHarness.runIngest`, `DcatHarness.loadCatalogIndex`, `DcatHarness.buildIngestGraph`, `DcatHarness.validateGraphNodes`, `DcatHarness.writeGraph` |
| **CKAN adapter** | `CkanIngest.main`, `CkanIngest.fetchPackageList`, `CkanIngest.fetchPackageShow`, `CkanIngest.buildCandidateNodes`, `CkanIngest.fetchOrganizationList`, `CkanIngest.fetchDataJson` (sibling) |
| **SDMX adapter** | `SdmxIngest.main`, `SdmxIngest.fetchDataflow`, `SdmxIngest.fetchDataStructure`, `SdmxIngest.fetchCategoryScheme`, `SdmxIngest.buildCandidateNodes` |
| **PX-Web adapter** | `PxWebIngest.main`, `PxWebIngest.walkTree`, `PxWebIngest.fetchNode`, `PxWebIngest.buildCandidateNodes` |
| **OpenAPI flat adapter** | `OpenApiIngest.main`, `OpenApiIngest.fetchSpec`, `OpenApiIngest.buildCandidateNodes` |
| **NCEI CDO walker** | `NceiCdoIngest.main`, `NceiCdoIngest.fetchSiblingEndpoints`, `NceiCdoIngest.fetchDataset`, `NceiCdoIngest.buildCandidateNodes` |
| **Synthetic DCAT batch** | `SyntheticDcatBootstrap.main`, `SyntheticDcatBootstrap.buildStaticNodes` |

### Convention — structured logs via `Effect.logInfo(event).pipe(Effect.annotateLogs({...}))`

The codebase pattern (`src/services/OntologyCatalog.ts:136-141`, `src/services/PostHydrationService.ts:115-118`, `src/ingest/IngestRunWorkflow.ts:103-105`, `src/ingest/ExpertPollCoordinatorDo.ts:78-81`, `src/filter/FilterWorker.ts:73-78`, `src/scripts/bootstrap-experts.ts:23-29`):

```ts
yield* Effect.logInfo("eia route fetch succeeded").pipe(
  Effect.annotateLogs({
    route,
    status: 200,
    durationMs: elapsed,
    subRouteCount: response.response.routes?.length ?? 0
  })
);
```

**Rules:**
1. **The message is a short event-name, not a sentence with interpolated values.** Bad: `Effect.log(\`Fetched \${route} (\${count} sub-routes)\`)`. Good: `Effect.logInfo("eia route fetch succeeded").pipe(Effect.annotateLogs({ route, subRouteCount: count }))`.
2. **Use a level-typed call.** `Effect.logInfo` for normal events, `Effect.logWarning` for skipped/retried, `Effect.logError` for failures, `Effect.logDebug` for verbose per-item traces.
3. **Annotation keys are camelCase identifiers, not free-form labels.** `{ errorTag, durationMs, routeCount }`, not `{ "Error Tag": ... }`.
4. **Errors get `errorTag` + `message` annotations.** Mimic the existing pattern from `src/platform/MutationLog.ts:19-49` `toErrorAnnotations`:
   ```ts
   Effect.tapError((error) =>
     Effect.logError("eia ingest failed").pipe(
       Effect.annotateLogs({
         errorTag: error._tag,
         message: stringifyUnknown(error)
       })
     )
   );
   ```

### Required log events per ingest script

Every cold-start ingest script must emit at minimum these structured events. (Names use `eia` prefix here; clone with the appropriate provider prefix per script.)

| Stage | Event name | Annotations |
|---|---|---|
| Top | `"eia ingest started"` | `{ rootDir, dryRun, noCache }` |
| Stage 1 | `"eia walk loaded"` | `{ routeCount, fromCache }` |
| Stage 1 | `"eia route fetch attempted"` | `{ route, attempt, cacheState }` |
| Stage 1 | `"eia route fetch retried"` | `{ route, attempt, status, waitMs }` |
| Stage 1 | `"eia route fetch succeeded"` | `{ route, status, durationMs, subRouteCount, facetCount }` |
| Stage 1 | `"eia route fetch failed"` | `{ route, errorTag, status, message }` |
| Stage 2 | `"eia catalog index loaded"` | `{ agentCount, datasetCount, distributionCount, catalogRecordCount }` |
| Stage 2 | `"eia candidate nodes built"` | `{ total, byKind: { agent, catalog, dataset, distribution, "catalog-record" } }` |
| Stage 2 | `"eia validation failure"` (per failure) | `{ kind, slug, message }` |
| Stage 2 | `"eia validation summary"` | `{ valid, failed, total }` |
| Stage 2 | `"eia graph built"` | `{ nodeCount, edgeCount, acyclic }` |
| Stage 3 | `"eia node written"` | `{ kind, slug, outcome }` (`created` / `merged` / `skipped`) |
| Stage 3 | `"eia ledger updated"` | `{ entries }` |
| Stage 3 | `"eia mermaid emitted"` | `{ path, nodeCount }` |
| Top | `"eia ingest completed"` | `{ routesWalked, nodeCount, edgeCount, datasetsCreated, datasetsMerged, distributionCount, catalogRecordCount, durationMs, dryRun }` |
| Top (error) | `"eia ingest failed"` | `{ errorTag, message }` |

### New helpers worth adding to `src/platform/Logging.ts`

Three optional helpers that would collapse the boilerplate. None are blocking — every pattern above works inline today.

1. **`Logging.logSummary(message, fields)`** — alias for `Effect.logInfo(message).pipe(Effect.annotateLogs(fields))`. Removes `.pipe(...)` repetition.
2. **`Logging.logFailure(message, error, extra?)`** — `Effect.logError(message).pipe(Effect.annotateLogs({ errorTag: error._tag, message: error.message, ...extra }))`. Generalizes the `toErrorAnnotations` extraction from `src/platform/MutationLog.ts:19-49` to non-mutation contexts.
3. **`Logging.withTiming(name)`** — wraps an effect in `Effect.withSpan(name)` AND emits a trailing `Effect.logInfo(\`${name} completed\`)` with a `durationMs` annotation. The missing `withLogSpan`-style helper. Collapses `Clock.currentTimeMillis` boilerplate.

These three helpers ship as part of the SKY-257 harness factoring PR (see plan).

---

## 5. Tagged errors — keep them per-script for now

Each ingest script defines its own tagged errors as `Schema.TaggedErrorClass` (per CLAUDE.md rule #4). The harness (SKY-257) will define generic harness errors (`IngestSchemaError`, `IngestFsError`, `IngestLedgerError`, `IngestHarnessError`); each adapter keeps its own fetch/decode errors local (`EiaApiFetchError`, `EiaApiDecodeError`, `CkanFetchError`, etc.).

**Convention:** error message annotations always include `errorTag` and `message`. Higher-level error context (`route`, `kind`, `slug`, `path`, `operation`) goes in additional fields per the table in §4.

---

## 6. Domain & schema rules (already in CLAUDE.md, restated for completeness)

- **`Schema.parseJson(Target)` not `JSON.parse`.** Use `decodeJsonStringWith(schema)` / `decodeJsonStringEitherWith(schema)` / `encodeJsonStringPrettyWith(schema)` from `src/platform/Json.ts` (line 11-44). Never hand-roll JSON parse + decode.
- **`Schema.TaggedErrorClass` for all errors.** No plain `Error`, no `throw`.
- **Search `src/domain/data-layer/` first.** Don't redefine schemas inline.
- **Branded ID types.** Use `Did`, `AtUri`, `HttpsUrl`, `TopicSlug`, `OntologyConceptSlug` from `src/domain/data-layer/ids.ts`.
- **`stripUndefined` from `src/platform/Json.ts:47-55`** when building partial `ExternalIdentifier` records — satisfies `exactOptionalPropertyTypes` without dropping defined optional fields.

---

## 7a. Merge-key and slug-stability invariants (learned from SKY-254 first run)

The SKY-254 EIA ingest hit two production-data issues on its first end-to-end live run that turned out to be **architectural invariants** every future adapter must enforce. Both are about the boundary between the API-driven catalog walk and the existing hand-curated registry, and both will repeat verbatim in every cluster ticket if we don't bake them into the harness contract.

### Invariant 1 — Every existing entity MUST have an alias whose scheme is the adapter's merge key

**The problem (concrete instance from the EIA run):** the registry had three pre-existing hand-curated EIA dataset files (`eia-steo`, `eia-international`, `eia-total-energy`) whose `aliases` arrays were either empty or contained only `eia-bulk-id` aliases — they never picked up the `eia-route` alias. The Task 6 catalog index keys datasets by `aliases.find(scheme === "eia-route")?.value`, so the loader couldn't find them. The first ingest run treated them as fresh mints, gave them new ULIDs, and overwrote the curated `landingPage`/`themes`/`keywords`/`description` fields with API-derived (often less rich) values.

**Why this is an invariant, not a bug:** the harness merge logic deliberately keys on a single alias scheme per provider so that adapter-local merge can be O(1) and unambiguous. Falling back to slug-matching (a tempting "just match the file name") is unsafe because an adapter that uses `${publisher}-${slug}` filenames will collide with an unrelated provider that has the same suffix.

**Convention — every adapter declares its `mergeAliasScheme` and the harness asserts on load.**

```ts
// src/ingest/dcat-harness/Adapter.ts
export interface DcatAdapter<FetchOutput, Err = never, R = never> {
  readonly providerId: string
  readonly mergeAliasScheme: AliasScheme   // ← NEW: required field
  readonly fetch: Effect.Effect<FetchOutput, Err, R>
  readonly buildCandidateNodes: (...) => ReadonlyArray<IngestNode>
  readonly buildContextFromIndex: (...) => Effect.Effect<BuildContext, IngestLedgerError>
}
```

The harness's `loadCatalogIndex` then takes the active adapter's `mergeAliasScheme` and **fails loudly** with `IngestLedgerError` if it loads any dataset that lacks an alias of that scheme. This catches Issue A at the boundary instead of silently double-minting:

```ts
// src/ingest/dcat-harness/loadCatalogIndex.ts (relevant snippet)
const datasetsByMergeKey = new Map<string, Dataset>()
for (const ds of allDatasets) {
  const merge = ds.aliases.find((a) => a.scheme === adapter.mergeAliasScheme)
  if (merge !== undefined) {
    datasetsByMergeKey.set(merge.value, ds)
  } else if (isProviderOwnedFile(ds, adapter.providerId)) {
    return yield* new IngestLedgerError({
      message: `Dataset ${ds.id} (file: ${slug}.json) is owned by provider ${adapter.providerId} but has no '${adapter.mergeAliasScheme}' alias — re-mint guard tripped`
    })
  }
  // datasets owned by *other* providers (e.g. data.gov harvesting EIA) are
  // ignored for merge purposes — only their CR may be touched
}
```

### Invariant 2 — Existing file slugs win over computed slugs on merge

**The problem (concrete instance from the EIA run):** 30 hand-curated EIA distribution files use shorter ad-hoc slugs (`eia-steo-api.json`, `eia-coal-bulk.json`) than the script's mintage formula `${dataset-slug}-${kind}` (which would give `eia-steo-api-access.json`, `eia-coal-download.json`). The merge logic correctly preserves the existing entity `id` via the `${datasetId}::${kind}` lookup — so the dataset's `distributionIds` still references the right thing — but the file gets written under the new computed slug, leaving the old file on disk as a duplicate-id orphan.

**Why this is an invariant, not a bug:** the slug is part of the on-disk identity, not just a display label. Two files with the same `id` but different slugs are a registry corruption — every consumer that walks the catalog by slug will think there are two distinct entities; every consumer that walks by id will pick whichever wins last. Either way the registry diverges from itself.

**Convention — `buildCandidateNodes` MUST use the existing file's slug when merging.**

The fix in `buildCandidateNodes` is small: after `idx.distributionsByDatasetIdKind.get(\`${datasetId}::${kind}\`)` finds an existing distribution, the candidate `IngestNode.slug` is set from the existing file's slug (derived from its file path), not from the computed `${dataset-slug}-${kind}`. The same rule applies to datasets, catalog records, and any future entity type that has a stable on-disk file.

```ts
// In every adapter's buildCandidateNodes:
const existingDist = idx.distributionsByDatasetIdKind.get(`${datasetId}::${kind}`)
const slug = existingDist !== undefined
  ? existingDist.slug                                  // ← preserve on-disk identity
  : `${datasetSlug}-${kind}`                           // ← formula only for fresh mints
```

The harness exposes a helper to make this trivial:

```ts
// src/ingest/dcat-harness/slugStability.ts
export const stableSlug = <T extends { slug: string }>(
  existing: T | undefined,
  computeFresh: () => string
): string => existing?.slug ?? computeFresh()
```

### Invariant 3 — Adapter-owned files belong to one adapter

When a dataset is harvested into multiple catalogs (e.g. EIA datasets re-harvested into data.gov), the registry holds **one canonical entity file** owned by the originating publisher and **multiple `CatalogRecord` files** representing each catalog's harvest provenance. Only the originating publisher's adapter writes the dataset/distribution files; other adapters touch only their own `CatalogRecord` entries.

**Convention — every adapter has a `providerOwnsFile(file)` predicate** that the harness uses to decide whether the active adapter is allowed to write this file at all. For EIA: filename starts with `eia-`. For CKAN providers: filename starts with `<providerId>-`. The harness gates writes:

```ts
// In writeGraph:
if (!adapter.providerOwnsFile(node.slug)) {
  yield* Effect.logWarning("ingest skipping non-owned file").pipe(
    Effect.annotateLogs({ slug: node.slug, providerId: adapter.providerId })
  )
  return
}
```

This makes the existing SKY-254 catalog-records edge case (EIA's authoritative CR + Data.gov's duplicate CR for the same Dataset) work cleanly: the EIA adapter touches only `references/cold-start/catalog/catalog-records/eia-*-cr.json`; the future data-gov adapter touches only `references/cold-start/catalog/catalog-records/datagov-eia-*-cr.json`. Neither overwrites the other's CR.

### Required harness changes (folded into SKY-257)

The three invariants above add the following to the SKY-257 harness factoring scope:

1. `DcatAdapter.mergeAliasScheme: AliasScheme` (required field)
2. `DcatAdapter.providerOwnsFile(slug): boolean` (required predicate)
3. `loadCatalogIndex` re-mint guard (asserts every provider-owned dataset has the merge alias)
4. `stableSlug(existing, computeFresh)` helper in `src/ingest/dcat-harness/slugStability.ts`
5. `writeGraph` ownership gate (skips non-owned files with a structured warning log)
6. Per-stage observability events for the re-mint guard and ownership-skip cases (extends the table in §4)

### Required EIA-specific cleanup (folded into SKY-254 as new tasks)

**Task 13a — Backfill missing `eia-route` aliases on the 3 hand-curated datasets.** One-shot script (or hand edits) adding `{ scheme: "eia-route", value: "<api-v2-path>", relation: "exactMatch" }` to:
- `references/cold-start/catalog/datasets/eia-steo.json` → `value: "steo"`
- `references/cold-start/catalog/datasets/eia-international.json` → `value: "international"`
- `references/cold-start/catalog/datasets/eia-total-energy.json` → `value: "total-energy"`

Re-validate each file through the `Dataset` schema after the edit. Commit as a separate prep commit before re-running the ingest.

**Task 13b — Make `buildCandidateNodes` slug-respecting.** Apply the `stableSlug` rule above (~5 lines in `buildDistributionCandidates`). The alternative — renaming the 30 ad-hoc distribution files to the computed formula — is also lossless but is a one-shot fix that leaves the script latent-buggy for the next provider. The slug-respecting change is the architecturally correct fix and benefits SKY-258 onward.

**Task 13c — Re-run the ingest, verify zero new file creations on a clean repo.** `git status` after the run should show only modifications to existing files (not creations of new ones with different slugs). Confirm via `git diff --stat` that the net changes are intentional metadata enrichment, not slug churn.

---

## 7. Test conventions

- Tests live in `tests/` and use `@effect/vitest`. Run with `bun run test`.
- Per-stage unit tests for the harness live in `tests/dcat-harness-*.test.ts` (post-SKY-257).
- Per-adapter unit tests live in `tests/cold-start-ingest-<adapter>.test.ts`.
- Stub HTTP layers via `Layer.succeed(HttpClient.HttpClient, fakeHttpClient)` (the SKY-254 EIA tests already follow this pattern).
- The walk-cache test should provide `Persistence.layerMemory` to avoid touching the FileSystem.

---

## Acceptance — when can a script claim "follows conventions"?

A cold-start ingest script is convention-compliant when **all** of:

- [ ] Imports `scriptPlatformLayer` + `runScriptMain` from `src/platform/ScriptRuntime.ts`
- [ ] Declares its config keys in `src/platform/ConfigShapes.ts` as a `<provider>IngestKeys` record (spreading `ColdStartCommonKeys`)
- [ ] Uses `nonEmptyRedacted` for required secrets, `nonEmptyString` for required strings
- [ ] Walk caches use `Persistable.Class` + `Persistence.Persistence` via `localPersistenceLayer`
- [ ] Every public unit of work is wrapped in `Effect.fn("<Script>.<step>")`
- [ ] Every Stage 1/2/3 boundary emits the structured events listed in §4
- [ ] All error logs have `errorTag` + `message` annotations
- [ ] No raw `JSON.parse`, no plain `throw`, no `node:fs` imports
- [ ] Tests stub HTTP via `Layer.succeed` and persistence via `Persistence.layerMemory`

---

## Cross-references

- **SKY-254 plan**: `docs/plans/2026-04-10-sky-254-eia-dcat-ingestion.md` — first script to retrofit onto these conventions
- **SKY-257 plan**: `docs/plans/2026-04-10-sky-257-dcat-ingest-harness-factoring.md` — bakes the conventions into the harness
- **SKY-258 (CKAN)** through **SKY-263 (synthetic DCAT batch)** — each adapter ticket inherits these conventions verbatim
- **Research backing**: `docs/research/2026-04-10-sky-251-provider-expansion-research.md`
