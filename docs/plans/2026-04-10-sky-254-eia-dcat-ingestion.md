# SKY-254 — EIA DCAT Ingestion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an Effect-native, schema-validated, idempotent ingestion script (`scripts/cold-start-ingest-eia.ts`) that walks the EIA API v2 catalog tree and produces / merges `Agent`, `Catalog`, `CatalogRecord`, `Dataset`, `Distribution`, and `DataService` records under `references/cold-start/catalog/`, validating every record against the Phase 0 domain schemas in `src/domain/data-layer/`.

**`DatasetSeries` is explicitly out of scope for this PR.** The existing `references/cold-start/catalog/dataset-series/eia-aeo.json` is hand-curated metadata about a recurring outlook publication, and the API v2 surface does not give us the structural signal needed to derive new series (we'd need to mine the bulk manifest's vintage codes and EIA's outlooks page). The script preserves the existing file untouched and does NOT populate `Dataset.inSeries` for newly-merged datasets in this run. A follow-up ticket will design the Dataset → DatasetSeries linking pass once a second publisher (e.g. ENTSO-E TYNDP) gives us a second example of the recurring-publication shape.

**Architecture:** A single Bun-runnable Effect program that builds the EIA catalog as a **typed `Graph.DirectedGraph<IngestNode, IngestEdge>`** and walks it. The graph is the source of truth: nodes are tagged-union entities (`agent | catalog | data-service | dataset | distribution | catalog-record`), edges encode the domain-model relationships (`publishes | record-in | primary-topic | distribution-of | served-by`). The pipeline is:

1. **Stage 1 — fetch:** lazy walk of the EIA API v2 route tree via `Effect.whileLoop` over a queue, accumulating raw responses into a `Map<route, EiaApiResponse>`. Output is a fetch cache, not a graph yet. Full-root walks may use the shared 30-day disk cache; scoped `--only-route` walks bypass that shared cache so they do not overwrite it with a partial snapshot.
2. **Stage 2a — build candidates:** load the existing entities from `references/cold-start/catalog/`, then build candidate `Dataset` / `Distribution` / `CatalogRecord` values plus the top-level `Agent` / `Catalog` / `DataService` nodes. At this point they are still plain candidate payloads, not yet schema-validated.
3. **Phase A — validate candidates:** run `Effect.partition(...)` over the flat `Array<IngestNode>` candidate set. Any failure aborts before disk is touched.
4. **Stage 2b — build the IngestGraph from validated nodes:** construct the graph in a single `Graph.directed<IngestNode, IngestEdge>((mutable) => { ... })` block and run `Graph.isAcyclic` as a sanity check.
5. **Phase B — topo write:** walk `Graph.topo(graph)` via `Effect.forEach`, writing each node atomically (temp + rename). With the dependency-direction edges defined below, the emitted order is Agent → {Catalog, Dataset} → {Distribution, CatalogRecord, DataService}. A `Graph.toMermaid` rendering of the final graph is emitted to the build report directory for diagnostic value.

Effect-native means: zero `for ... of` over collections inside Effect-typed code, zero raw `while` loops outside `Effect.whileLoop`, zero `async function`. The only synchronous loops permitted are inside the `Graph.directed` mutate callback (which is sync by design — see `/Users/pooks/Dev/skygest-editorial/src/narrative/BuildGraph.ts:950-1018` for the canonical pattern).

**Tech Stack:** Effect 4.0.0-beta.43 (`effect/unstable/http`, `effect/unstable/cli`, `Schema.TaggedErrorClass`, `Graph` from `effect`, `FileSystem`, `Path`, `Config`, `Schedule`, `Cache`, `Semaphore`, `SynchronizedRef`, `Effect.whileLoop`, `Effect.forEach`, `Effect.partition`), Bun runtime, ULID, vitest via `@effect/vitest`.

---

## Reference Material (read before starting)

- **Ticket:** SKY-254 — Workstream A — EIA DCAT ingestion (parent: SKY-251)
- **Domain schemas (the validation contract):** `src/domain/data-layer/catalog.ts` — `Agent`, `Catalog`, `CatalogRecord`, `Dataset`, `Distribution`, `DataService`, `DatasetSeries`. Read all of it. Pay attention to `TimestampedAliasedFields` (`src/domain/data-layer/base.ts`), the alias scheme enum (`src/domain/data-layer/alias.ts`), and the branded ID types in `src/domain/data-layer/ids.ts`.
- **Effect-native patterns to clone:**
  - `src/bluesky/BlueskyClient.ts:170-232` — `HttpClient` + `Cache`/`Semaphore`/`SynchronizedRef` per-host rate limiter + `Effect.retry` with `Schedule.exponential.pipe(Schedule.jittered, Schedule.both(Schedule.recurs(N)))` + `HttpClientResponse.filterStatusOk` + `HttpClientResponse.schemaBodyJson`.
  - `scripts/build-stage1-eval-snapshot.ts:14-198` — local `FileSystem.make({...})` adapter wrapping `node:fs/promises`, `Runtime.makeRunMain` entry, `Command`/`Flag` CLI from `effect/unstable/cli`, local `Schema.TaggedErrorClass`.
  - `src/scripts/build-expert-seeds.ts:40-80` — `Config.all({...})` with `Config.string` / `Config.int` / `Config.withDefault` and `Config.redacted` for secrets.
  - `src/platform/Json.ts` — `decodeJsonStringWith`, `encodeJsonString`, `formatSchemaParseError`, `stringifyUnknown`. **Use these. Do not hand-roll JSON parse/stringify.**
  - **`/Users/pooks/Dev/skygest-editorial/src/narrative/BuildGraph.ts` — the canonical Effect `Graph` + `Effect.forEach` + `Effect.partition` pattern in the Skygest org.** Read it before touching Tasks 5, 6, or 10. Key idioms to clone verbatim:
    - `Graph.directed<NodeData, EdgeData>((mutable) => { ... })` constructor: collect data first (in maps/arrays), then build the graph in a single mutation block. Inside the block use `const idx = Graph.addNode(mutable, nodeData)` and `Graph.addEdge(mutable, sourceIdx, targetIdx, edgeData)` (line 950-965, 1004-1018).
    - `Graph.isAcyclic(graph)` for sanity-checking tree shape (line 967).
    - `yield* Effect.forEach(items, fn, { concurrency: N })` for parallel work (line 257, 300).
    - `const [issues, results] = yield* Effect.partition(items, validateFn, { concurrency: N })` — splits successes from failures in one pass; perfect for the Phase A validation gate (line 421, 983).
    - **No `for` loops over collections that need Effect.** Plain JS `for` loops are OK only inside a `Graph.directed` mutate callback (since that callback is synchronous and not Effect-typed).
- **Existing EIA artifacts (the merge baseline):**
  - `references/cold-start/catalog/agents/eia.json` — wikidata `Q1133499` is **correct** for the U.S. Energy Information Administration. The ticket's `Q466438` is wrong (that QID belongs to American President Lines). The script must NOT add `Q466438`. Document the discrepancy in the build report under `notes`, but otherwise leave the agent's wikidata alias untouched.
  - `references/cold-start/catalog/catalogs/eia.json`
  - `references/cold-start/catalog/data-services/eia-api.json` (17 servesDatasetIds today)
  - `references/cold-start/catalog/datasets/eia-*.json` (20 files)
  - `references/cold-start/catalog/distributions/eia-*.json` (~32 files)
  - `references/cold-start/catalog/dataset-series/eia-aeo.json`
  - `references/cold-start/.entity-ids.json` — append-only ledger
- **Critical schema constraint** — `src/domain/data-layer/alias.ts` defines `aliasSchemes` as an exhaustive `Schema.Literals` enum. The currently-allowed schemes are: `oeo`, `ires-siec`, `iea-shortname`, `ipcc`, `entsoe-psr`, `entsoe-eic`, `eia-route`, `eia-series`, `eurostat-code`, `ror`, `wikidata`, `doi`, `iso3166`, `url`, `other`. Any alias whose `scheme` is not on this list will fail Schema validation. **There is no `frequency`, `eia-data-set`, or `eia-category-id`.** Task 0 expands this enum (see `feedback_check_domain_schemas.md` and the existing `project_alias_scheme_growth.md` memory which explicitly anticipates research-driven enum growth during cold-start).
- **Critical legacy data fact** — the existing 20 EIA dataset files use `eia-route` to mean *bulk-manifest top-level category code* (e.g. `EBA`, `ELEC`, `PET`). Verified via `references/cold-start/catalog/datasets/eia-electric-system-operating-data.json:8-12`. The new API v2 surface uses path-style identifiers (e.g. `electricity/rto/region-data`). These two namespaces do NOT overlap, so a naive merge keyed on `eia-route` will treat every API v2 leaf as net-new. Task 0.5 migrates the legacy values to a new `eia-bulk-id` scheme to free up `eia-route` for API v2 paths.
- **Cautionary tales (non-Effect-native, do NOT clone):** `scripts/catalog-harvest/probe-eia-manifest.ts` and `scripts/catalog-harvest/harvest-eia-datasets.ts` use raw `fetch`, `node:fs`, top-level async/await, `Record<string, any>`, no Schema validation. The new script supersedes their patterns.
- **CLAUDE.md rules that bind this work:** Effect-native (no async/await, no try/catch outside Worker entry); `Schema.parseJson` not `JSON.parse`; `Schema.TaggedErrorClass` for all errors; new schemas live in `src/domain/`, not inline; Effect platform APIs for IO. Scripts directory may import `node:fs/promises` *only* through the local `FileSystem.make` adapter shown in `build-stage1-eval-snapshot.ts`.

## Pre-flight (do before Task 1)

1. Confirm `EIA_API_KEY` is in `.env`. Register at `https://www.eia.gov/opendata/register.php` if not. The key is a 40-char string.
2. Sanity-probe one route by hand to confirm response shape: `curl -s "https://api.eia.gov/v2/?api_key=$EIA_API_KEY" | jq '.response | keys'`. Expected keys include `id`, `name`, `description`, `routes`.
3. Pick one leaf for fixture data: `curl -s "https://api.eia.gov/v2/electricity/retail-sales/?api_key=$EIA_API_KEY" > /tmp/eia-leaf-fixture.json`. Verify `.response.routes` is missing or empty and `.response.facets` is present.
4. Read the entity-id ledger to confirm shape: `cat references/cold-start/.entity-ids.json | head -40`.
5. Verify the current branch is `sky-254/eia-dcat-ingestion`.

## Out of scope for this PR

- Variable linking (deferred — see SKY-254 "Notes")
- `DatasetSeries` derivation and `Dataset.inSeries` linking — preserved as-is, deferred to a follow-up ticket once a second publisher gives us a structural signal for recurring publications
- Changing the substantive modeling of the existing 20 datasets that don't map to API v2 leaves (e.g. `eia-today-in-energy`, `eia-recs`) beyond the one-time alias migration in Task 0.5
- Touching CatalogRecords whose `catalogId` is not the EIA catalog (e.g. Data.gov duplicate CRs)
- Non-EIA publishers (separate tickets)
- Wiring the script into CI

---

## Task 0: Schema prep — extend `AliasScheme` enum

**Why first:** every later task validates records through `Dataset` / `Distribution` schemas, which both transitively use `AliasScheme`. Adding the new scheme now means every later validation step will accept the new alias automatically.

**Files:**
- Modify: `src/domain/data-layer/alias.ts`
- Modify: `tests/data-layer-alias.test.ts` (or wherever the alias schema tests live — search first)

**Step 1: Search for the existing alias test file.**

Run: Use `Grep` for `aliasSchemes` under `tests/`. If a test file exists, modify it. If not, create `tests/data-layer-alias.test.ts`.

**Step 2: Write the failing test.**

```ts
import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { AliasScheme, ExternalIdentifier } from "../src/domain/data-layer/alias";

describe("AliasScheme", () => {
  it.effect("accepts the new eia-bulk-id scheme", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknown(ExternalIdentifier)({
        scheme: "eia-bulk-id",
        value: "EBA",
        relation: "exactMatch"
      });
      expect(result.scheme).toBe("eia-bulk-id");
    })
  );
});
```

**Step 3: Run test, verify it fails.**

Run: `bun run test tests/data-layer-alias.test.ts`
Expected: FAIL — `eia-bulk-id` not in literal union.

**Step 4: Add `eia-bulk-id` to the `aliasSchemes` array in `src/domain/data-layer/alias.ts`.**

```ts
export const aliasSchemes = [
  "oeo", "ires-siec", "iea-shortname", "ipcc",
  "entsoe-psr", "entsoe-eic",
  "eia-route", "eia-series", "eia-bulk-id",
  "eurostat-code",
  "ror", "wikidata", "doi",
  "iso3166", "url", "other"
 ] as const;
```

**Important:** do NOT add `frequency`, `eia-data-set`, or `eia-category-id`. Frequency is a property, not an external identifier — it does not belong as an alias. The other two were misjudged in the earlier draft of this plan; we do not actually need them, because once Task 0.5 frees `eia-route` we can index merges off route paths alone.

**Step 5: Run test, verify pass.**

Run: `bun run test tests/data-layer-alias.test.ts`
Expected: PASS.

**Step 6: Run the full data-layer test suite to verify no regressions.**

Run: `bun run test src/domain/data-layer tests/data-layer*`
Expected: clean.

**Step 7: Type-check.**

Run: `bunx tsc --noEmit`
Expected: clean.

**Step 8: Commit.**

```bash
git add src/domain/data-layer/alias.ts tests/data-layer-alias.test.ts
git commit -m "feat(data-layer): add eia-bulk-id alias scheme (SKY-254 prep)"
```

---

## Task 0.5: Legacy `eia-route` → `eia-bulk-id` migration (datasets only)

**Why:** the existing 20 EIA datasets use `eia-route` to hold bulk-manifest top-level codes like `EBA`. The new ingest script uses `eia-route` for API v2 paths like `electricity/rto/region-data`. We need to free the namespace before the ingest script runs, otherwise the merge logic keyed on `eia-route` matches nothing and re-mints duplicate datasets.

**Scope:** dataset files only. The current EIA distribution files have empty `aliases` arrays — verified via `jq '.aliases' references/cold-start/catalog/distributions/eia-*.json` — so distributions need no migration. The script still reads the distribution dir to verify the empty-aliases assumption holds, and aborts loudly if it ever finds a distribution with a slashless `eia-route` alias (defensive: that would indicate a future contributor added one and we'd need to extend this script).

**Files:**
- Create: `scripts/cold-start-migrate-eia-bulk-id.ts`
- Modified by script (one-shot): all `references/cold-start/catalog/datasets/eia-*.json` whose `eia-route` value contains no slash.

**Step 1: Write the migration script.** Effect-native, same FileSystem pattern as the main ingest. For each EIA dataset file:
1. Decode through `Dataset` schema.
2. For each alias with `scheme === "eia-route"` whose `value` does not contain a `/`, rewrite the alias to `scheme: "eia-bulk-id"` (preserving `value` and `relation`).
3. Re-encode and write back atomically (temp + rename).
4. Print a per-file diff summary.

The script is small enough to inline in this plan. Refuse to run if any file fails to decode (forces a clean baseline). Distributions are checked but never written.

```ts
// scripts/cold-start-migrate-eia-bulk-id.ts
import { Effect, FileSystem, Layer, Runtime, Schema } from "effect";
import * as fs from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { Dataset, Distribution } from "../src/domain/data-layer";
import { decodeJsonStringWith, encodeJsonString, stringifyUnknown } from "../src/platform/Json";

class MigrationError extends Schema.TaggedErrorClass<MigrationError>()(
  "MigrationError",
  { path: Schema.String, message: Schema.String }
) {}

const ROOT = resolve(import.meta.dirname, "..", "references", "cold-start");

const migrateAliases = <T extends { aliases: ReadonlyArray<{ scheme: string; value: string; relation: string }> }>(
  entity: T
): { entity: T; changed: boolean } => {
  let changed = false;
  const newAliases = entity.aliases.map((a) => {
    if (a.scheme === "eia-route" && !a.value.includes("/")) {
      changed = true;
      return { ...a, scheme: "eia-bulk-id" as const };
    }
    return a;
  });
  return { entity: { ...entity, aliases: newAliases }, changed };
};

const migrateFile = <S extends Schema.Top>(schema: S, dir: string, file: string) =>
  Effect.gen(function* () {
    const fs_ = yield* FileSystem.FileSystem;
    const path = resolve(ROOT, "catalog", dir, file);
    const text = yield* fs_.readFileString(path);
    const decoded = decodeJsonStringWith(schema)(text) as any;
    const { entity, changed } = migrateAliases(decoded);
    if (!changed) return { file, changed: false };
    // Re-validate to ensure the rewritten record still passes the schema
    const validated = yield* Schema.decodeUnknown(schema)(entity).pipe(
      Effect.mapError((cause) =>
        new MigrationError({ path, message: stringifyUnknown(cause) })
      )
    );
    const tmp = `${path}.tmp-${Date.now()}`;
    yield* fs_.writeFileString(tmp, encodeJsonString(validated) + "\n");
    yield* fs_.rename(tmp, path);
    return { file, changed: true };
  });

// Defensive distribution check: verify no distribution has a slashless
// eia-route alias. If one ever appears, this script must be extended.
const verifyDistributionAssumption = (file: string) =>
  Effect.gen(function* () {
    const fs_ = yield* FileSystem.FileSystem;
    const path = resolve(ROOT, "catalog", "distributions", file);
    const text = yield* fs_.readFileString(path);
    const decoded = decodeJsonStringWith(Distribution)(text) as any;
    const offending = (decoded.aliases ?? []).find(
      (a: any) => a.scheme === "eia-route" && !a.value.includes("/")
    );
    if (offending) {
      return yield* new MigrationError({
        path,
        message: `Distribution has a slashless eia-route alias (${offending.value}) — extend cold-start-migrate-eia-bulk-id.ts to handle distributions`
      });
    }
  });

const main = Effect.gen(function* () {
  const fs_ = yield* FileSystem.FileSystem;
  const datasetFiles = (yield* fs_.readDirectory(resolve(ROOT, "catalog", "datasets")))
    .filter((f) => f.startsWith("eia-") && f.endsWith(".json"));
  const distFiles = (yield* fs_.readDirectory(resolve(ROOT, "catalog", "distributions")))
    .filter((f) => f.startsWith("eia-") && f.endsWith(".json"));

  // Migrate dataset files
  const dsResults = yield* Effect.forEach(
    datasetFiles,
    (f) => migrateFile(Dataset, "datasets", f),
    { concurrency: 10 }
  );

  // Verify distributions have nothing to migrate (they currently don't)
  yield* Effect.forEach(distFiles, verifyDistributionAssumption, {
    concurrency: 10,
    discard: true
  });

  const dsChanged = dsResults.filter((r) => r.changed).length;
  yield* Effect.log(
    `Migrated ${dsChanged}/${datasetFiles.length} datasets. ` +
    `Verified ${distFiles.length} distributions need no migration.`
  );
});

// (FileSystem layer adapter + runMain identical to Task 4)
```

**Step 2: Type-check.**

Run: `bunx tsc --noEmit`
Expected: clean.

**Step 3: Dry-run inspection.** Before mutating files, manually grep what will change so we know the scope:

Run: `Grep` for `"scheme": "eia-route"` under `references/cold-start/catalog/datasets/`. Confirm every match has a slash-less value (e.g. `"EBA"`, `"ELEC"`, `"NG"`) — these are the ones that will move to `eia-bulk-id`.

**Step 4: Execute the migration.**

Run: `bun scripts/cold-start-migrate-eia-bulk-id.ts`
Expected: log line `Migrated N/20 datasets, M/32 distributions`. N should equal the number of files that had `eia-route` aliases pointing at bulk-manifest codes.

**Step 5: Verify with `git diff`** that every changed file shows only `"scheme": "eia-route"` → `"scheme": "eia-bulk-id"` substitutions, no other field changes.

**Step 6: Commit.**

```bash
git add src/domain/data-layer/alias.ts \
        scripts/cold-start-migrate-eia-bulk-id.ts \
        references/cold-start/catalog/datasets/eia-*.json \
        references/cold-start/catalog/distributions/eia-*.json
git commit -m "refactor(sky-254): migrate legacy eia-route bulk codes to eia-bulk-id"
```

---

## Task 1: Module skeleton + tagged errors + Config

**Files:**
- Create: `scripts/cold-start-ingest-eia.ts`
- Test: `tests/cold-start-ingest-eia.test.ts`

**Step 1: Stub the file with imports, errors, Config, and a stub `main` Effect.**

```ts
import {
  Cache, Clock, Config, Duration, Effect, FileSystem, Layer,
  Path, Runtime, Schedule, Schema, Semaphore, SynchronizedRef
} from "effect";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/unstable/http";
import { Command, Flag } from "effect/unstable/cli";
import * as fs from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import {
  Agent, Catalog, CatalogRecord, DataService, Dataset,
  DatasetSeries, Distribution
} from "../src/domain/data-layer";
import {
  decodeJsonStringWith, encodeJsonString,
  formatSchemaParseError, stringifyUnknown
} from "../src/platform/Json";

// ---------- Tagged errors ----------
class EiaApiFetchError extends Schema.TaggedErrorClass<EiaApiFetchError>()(
  "EiaApiFetchError",
  { route: Schema.String, message: Schema.String, status: Schema.optionalKey(Schema.Number) }
) {}

class EiaApiDecodeError extends Schema.TaggedErrorClass<EiaApiDecodeError>()(
  "EiaApiDecodeError",
  { route: Schema.String, message: Schema.String }
) {}

class EiaIngestSchemaError extends Schema.TaggedErrorClass<EiaIngestSchemaError>()(
  "EiaIngestSchemaError",
  { kind: Schema.String, slug: Schema.String, message: Schema.String }
) {}

class EiaIngestFsError extends Schema.TaggedErrorClass<EiaIngestFsError>()(
  "EiaIngestFsError",
  { operation: Schema.String, path: Schema.String, message: Schema.String }
) {}

class EiaIngestLedgerError extends Schema.TaggedErrorClass<EiaIngestLedgerError>()(
  "EiaIngestLedgerError",
  { message: Schema.String }
) {}

// ---------- Script config ----------
// dryRun / noCache default to false here; onlyRoute defaults to "full tree"
// by being absent. Task 11's CLI flags override these via Layer composition
// (Flag.boolean / Flag.text wired into a custom ConfigProvider). Defining
// them here means main can reference config.dryRun / config.noCache /
// config.onlyRoute from Task 10 onward without forward refs.
const ScriptConfig = Config.all({
  apiKey: Config.redacted("EIA_API_KEY"),
  rootDir: Config.withDefault(Config.string("COLD_START_ROOT"), "references/cold-start"),
  minIntervalMs: Config.withDefault(Config.int("EIA_MIN_INTERVAL_MS"), 250),
  maxRetries: Config.withDefault(Config.int("EIA_MAX_RETRIES"), 4),
  cacheTtlDays: Config.withDefault(Config.int("EIA_WALK_CACHE_TTL_DAYS"), 30),
  dryRun: Config.withDefault(Config.boolean("EIA_DRY_RUN"), false),
  noCache: Config.withDefault(Config.boolean("EIA_NO_CACHE"), false),
  onlyRoute: Config.option(Config.string("EIA_ONLY_ROUTE"))
});
type ScriptConfigShape = Config.Success<typeof ScriptConfig>;

// ---------- Stub main ----------
const main = Effect.gen(function* () {
  const config = yield* ScriptConfig;
  yield* Effect.log(`SKY-254 EIA ingest stub — root=${config.rootDir}`);
});

const runMain = Runtime.makeRunMain(({ fiber, teardown }) => {
  fiber.addObserver((exit) => teardown(exit, (code) => process.exit(code)));
});

main.pipe(
  Effect.tapError((error) => Effect.logError(stringifyUnknown(error))),
  runMain
);
```

**Step 2: Verify it type-checks.**

Run: `bunx tsc --noEmit`
Expected: clean exit, no errors mentioning `cold-start-ingest-eia.ts`.

**Step 3: Verify it executes (with EIA_API_KEY set).**

Run: `bun scripts/cold-start-ingest-eia.ts`
Expected: log line `SKY-254 EIA ingest stub — root=references/cold-start`, exit 0.

**Step 4: Commit.**

```bash
git add scripts/cold-start-ingest-eia.ts
git commit -m "scaffold(sky-254): stub Effect-native EIA ingest script"
```

---

## Task 2: API v2 response schema + single-route fetch

**Files:**
- Modify: `scripts/cold-start-ingest-eia.ts`
- Test: `tests/cold-start-ingest-eia.test.ts`

**Step 1: Add the API v2 response Schema.**

```ts
const EiaRouteRef = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.optionalKey(Schema.String)
});

const EiaFacetDef = Schema.Struct({
  id: Schema.String,
  description: Schema.optionalKey(Schema.String)
});

const EiaFrequencyDef = Schema.Struct({
  id: Schema.String,
  description: Schema.optionalKey(Schema.String),
  format: Schema.optionalKey(Schema.String)
});

const EiaApiResponse = Schema.Struct({
  response: Schema.Struct({
    id: Schema.String,
    name: Schema.optionalKey(Schema.String),
    description: Schema.optionalKey(Schema.String),
    routes: Schema.optionalKey(Schema.Array(EiaRouteRef)),
    facets: Schema.optionalKey(Schema.Array(EiaFacetDef)),
    frequency: Schema.optionalKey(Schema.Array(EiaFrequencyDef)),
    defaultFrequency: Schema.optionalKey(Schema.String),
    startPeriod: Schema.optionalKey(Schema.String),
    endPeriod: Schema.optionalKey(Schema.String),
    data: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown))
  })
});
type EiaApiResponse = Schema.Schema.Type<typeof EiaApiResponse>;
```

**Step 2: Write the failing test for `fetchRoute`.**

In `tests/cold-start-ingest-eia.test.ts`:

```ts
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import { fetchRouteForTesting, EiaApiResponseForTesting } from "../scripts/cold-start-ingest-eia";

const fakeHttpLayer = (body: unknown) =>
  Layer.succeed(HttpClient.HttpClient, {
    // minimal stub — only supports .get
    get: (_url: string) =>
      Effect.succeed(
        HttpClientResponse.fromWeb(
          { method: "GET", url: _url } as any,
          new Response(JSON.stringify(body), { status: 200 })
        )
      )
  } as any);

describe("fetchRoute", () => {
  it.effect("decodes a leaf route response into EiaApiResponse", () =>
    Effect.gen(function* () {
      const result = yield* fetchRouteForTesting("electricity/retail-sales", "fake-key");
      expect(result.response.id).toBe("retail-sales");
      expect(result.response.routes).toBeUndefined();
    }).pipe(
      Effect.provide(fakeHttpLayer({
        response: { id: "retail-sales", name: "Electricity Sales", facets: [] }
      }))
    )
  );
});
```

**Step 3: Run test, verify it fails.**

Run: `bun run test tests/cold-start-ingest-eia.test.ts`
Expected: FAIL — `fetchRouteForTesting` not exported.

**Step 4: Implement `fetchRoute`.**

```ts
const EIA_API_BASE = "https://api.eia.gov/v2/";

const fetchRoute = (route: string, apiKey: string) =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    const url = `${EIA_API_BASE}${route}${route.endsWith("/") ? "" : "/"}`;
    return yield* http.get(url, { urlParams: { api_key: apiKey } }).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(EiaApiResponse)),
      Effect.mapError((cause) =>
        cause._tag === "ParseError" || cause._tag === "SchemaError"
          ? new EiaApiDecodeError({ route, message: stringifyUnknown(cause) })
          : new EiaApiFetchError({
              route,
              message: stringifyUnknown(cause),
              ...(typeof (cause as any)?.response?.status === "number"
                ? { status: (cause as any).response.status }
                : {})
            })
      )
    );
  });

// Test exports
export const fetchRouteForTesting = fetchRoute;
export const EiaApiResponseForTesting = EiaApiResponse;
```

**Step 5: Run test, verify it passes.**

Run: `bun run test tests/cold-start-ingest-eia.test.ts`
Expected: PASS.

**Step 6: Commit.**

```bash
git add scripts/cold-start-ingest-eia.ts tests/cold-start-ingest-eia.test.ts
git commit -m "feat(sky-254): add fetchRoute with EiaApiResponse schema decode"
```

---

## Task 3: Rate limiter + retry layer

**Files:**
- Modify: `scripts/cold-start-ingest-eia.ts`

**Step 1: Add the per-host rate limiter (cloned from `BlueskyClient.ts:179-216`).**

```ts
interface HostGate {
  readonly semaphore: Semaphore.Semaphore;
  readonly lastCompletedAt: SynchronizedRef.SynchronizedRef<number>;
}

const makeRateLimitedFetcher = (minIntervalMs: number, maxRetries: number) =>
  Effect.gen(function* () {
    const hostGates = yield* Cache.make({
      capacity: 8,
      timeToLive: Duration.infinity,
      lookup: () =>
        Effect.all([
          Semaphore.make(1),
          SynchronizedRef.make(-minIntervalMs)
        ]).pipe(
          Effect.map(([semaphore, lastCompletedAt]) => ({
            semaphore,
            lastCompletedAt
          }) satisfies HostGate)
        )
    });

    const retrySchedule = Schedule.exponential(Duration.millis(500)).pipe(
      Schedule.jittered,
      Schedule.both(Schedule.recurs(maxRetries))
    );

    const isRetryable = (err: EiaApiFetchError | EiaApiDecodeError) =>
      err._tag === "EiaApiFetchError" &&
      (err.status === undefined || err.status >= 500 || err.status === 429);

    return <A>(route: string, apiKey: string) =>
      Effect.gen(function* () {
        const gate = yield* Cache.get(hostGates, "api.eia.gov");
        return yield* gate.semaphore.withPermits(1)(
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;
            const last = yield* SynchronizedRef.get(gate.lastCompletedAt);
            const waitMs = Math.max(0, minIntervalMs - (now - last));
            if (waitMs > 0) yield* Effect.sleep(Duration.millis(waitMs));
            return yield* fetchRoute(route, apiKey);
          }).pipe(
            Effect.ensuring(
              Clock.currentTimeMillis.pipe(
                Effect.flatMap((t) =>
                  SynchronizedRef.set(gate.lastCompletedAt, t)
                )
              )
            )
          )
        );
      }).pipe(Effect.retry({ schedule: retrySchedule, while: isRetryable }));
  });
```

**Step 2: Update the stub `main` to construct the fetcher and fetch the root route.**

```ts
const main = Effect.gen(function* () {
  const config = yield* ScriptConfig;
  const fetcher = yield* makeRateLimitedFetcher(config.minIntervalMs, config.maxRetries);
  const apiKey = Redacted.value(config.apiKey);
  const root = yield* fetcher("", apiKey);
  yield* Effect.log(`Root route returned ${root.response.routes?.length ?? 0} child routes`);
});
```

(Add `import { Redacted } from "effect";` to the top.)

**Step 3: Provide `FetchHttpClient.layer` to the runtime.**

```ts
main.pipe(
  Effect.provide(FetchHttpClient.layer),
  Effect.tapError((error) => Effect.logError(stringifyUnknown(error))),
  runMain
);
```

**Step 4: Run it against the live API.**

Run: `bun scripts/cold-start-ingest-eia.ts`
Expected: log line like `Root route returned 14 child routes` (count may differ).

**Step 5: Type-check + run existing tests.**

Run: `bunx tsc --noEmit && bun run test tests/cold-start-ingest-eia.test.ts`
Expected: clean.

**Step 6: Commit.**

```bash
git add scripts/cold-start-ingest-eia.ts
git commit -m "feat(sky-254): add rate-limited fetcher with retry schedule"
```

---

## Task 4: Filesystem + Path local layer

**Files:**
- Modify: `scripts/cold-start-ingest-eia.ts`

**Step 1: Copy the `FileSystem.make({...})` adapter from `scripts/build-stage1-eval-snapshot.ts:46-146`.** Trim methods to only those we need: `readDirectory`, `readFileString`, `writeFileString`, `makeDirectory`, `access`, `rename`. Keep the `unsupportedFileSystemMethod` helper for everything else.

```ts
const toFsError = (operation: string, path: string, error: unknown) =>
  new EiaIngestFsError({ operation, path, message: stringifyUnknown(error) });

const unsupportedFs = (method: string) =>
  (path: string, ..._args: Array<any>): any =>
    Effect.fail(
      new EiaIngestFsError({ operation: method, path, message: `unsupported in cold-start-ingest-eia` })
    );

const fileSystemLayer = Layer.succeed(
  FileSystem.FileSystem,
  FileSystem.make({
    access: (p) => Effect.tryPromise({
      try: async () => { await fs.access(p); },
      catch: (e) => toFsError("access", p, e)
    }),
    readDirectory: (p) => Effect.tryPromise({
      try: () => fs.readdir(p),
      catch: (e) => toFsError("readDirectory", p, e)
    }),
    readFileString: (p) => Effect.tryPromise({
      try: async () => (await fs.readFile(p)).toString("utf-8"),
      catch: (e) => toFsError("readFileString", p, e)
    }),
    writeFileString: (p, content) => Effect.tryPromise({
      try: () => fs.writeFile(p, content),
      catch: (e) => toFsError("writeFileString", p, e)
    }),
    makeDirectory: (p, options) => Effect.tryPromise({
      try: async () => { await fs.mkdir(p, { recursive: Boolean(options?.recursive) }); },
      catch: (e) => toFsError("makeDirectory", p, e)
    }),
    rename: (oldP, newP) => Effect.tryPromise({
      try: () => fs.rename(oldP, newP),
      catch: (e) => toFsError("rename", `${oldP} -> ${newP}`, e)
    }),
    // unsupported (delegates to unsupportedFs)
    chmod: unsupportedFs("chmod"),
    chown: unsupportedFs("chown"),
    copy: unsupportedFs("copy"),
    copyFile: unsupportedFs("copyFile"),
    link: unsupportedFs("link"),
    makeTempDirectory: unsupportedFs("makeTempDirectory"),
    makeTempDirectoryScoped: unsupportedFs("makeTempDirectoryScoped"),
    makeTempFile: unsupportedFs("makeTempFile"),
    makeTempFileScoped: unsupportedFs("makeTempFileScoped"),
    open: unsupportedFs("open"),
    readFile: unsupportedFs("readFile"),
    readLink: unsupportedFs("readLink"),
    realPath: unsupportedFs("realPath"),
    remove: unsupportedFs("remove"),
    stat: unsupportedFs("stat"),
    symlink: unsupportedFs("symlink"),
    truncate: unsupportedFs("truncate"),
    utimes: unsupportedFs("utimes"),
    watch: unsupportedFs("watch"),
    writeFile: unsupportedFs("writeFile")
  } as any)
);
```

**Step 2: Provide it in the runtime layer.**

```ts
main.pipe(
  Effect.provide(Layer.mergeAll(FetchHttpClient.layer, fileSystemLayer)),
  ...
);
```

**Step 3: Type-check.**

Run: `bunx tsc --noEmit`
Expected: clean.

**Step 4: Commit.**

```bash
git add scripts/cold-start-ingest-eia.ts
git commit -m "feat(sky-254): wire local FileSystem layer for ingest script"
```

---

## Task 5: Lazy walk via `Effect.whileLoop` + disk cache

**Files:**
- Modify: `scripts/cold-start-ingest-eia.ts`
- Test: `tests/cold-start-ingest-eia.test.ts`

**Goal:** fetch every route in the EIA API v2 tree into a `Map<route, EiaApiResponse>`. No graph yet (Task 5.5 builds the graph from this fetch cache). No `for`/`while` loops — discovery uses `Effect.whileLoop`.

**Step 1: Define the walk-cache schema.**

```ts
const WalkCache = Schema.Struct({
  fetchedAt: Schema.String,
  routes: Schema.Record(Schema.String, EiaApiResponse)
});
type WalkCache = Schema.Schema.Type<typeof WalkCache>;
```

**Step 2: Write failing tests for `walkRoutes` using a stubbed fetcher.** Cover both the full-tree case and a scoped subtree case.

```ts
it.effect("walks a 2-level route tree and collects every response", () =>
  Effect.gen(function* () {
    const fakeResponses: Record<string, EiaApiResponse> = {
      "": { response: { id: "root", routes: [{ id: "electricity", name: "Electricity" }] } },
      "electricity": { response: { id: "electricity", routes: [{ id: "retail-sales", name: "Retail Sales" }] } },
      "electricity/retail-sales": { response: { id: "retail-sales", facets: [] } }
    };
    const fakeFetcher = (route: string) => Effect.succeed(fakeResponses[route]!);
    const walkData = yield* walkRoutesForTesting(fakeFetcher);
    expect(Array.from(walkData.keys()).sort()).toEqual(["", "electricity", "electricity/retail-sales"]);
  })
);

it.effect("walks only a subtree when startRoute is provided", () =>
  Effect.gen(function* () {
    const fakeResponses: Record<string, EiaApiResponse> = {
      "electricity": { response: { id: "electricity", routes: [{ id: "retail-sales", name: "Retail Sales" }] } },
      "electricity/retail-sales": { response: { id: "retail-sales", facets: [] } }
    };
    const fakeFetcher = (route: string) => Effect.succeed(fakeResponses[route]!);
    const walkData = yield* walkRoutesForTesting(fakeFetcher, "electricity");
    expect(Array.from(walkData.keys()).sort()).toEqual(["electricity", "electricity/retail-sales"]);
  })
);
```

**Step 3: Run test, verify failure.**

**Step 4: Implement `walkRoutes` with `Effect.whileLoop`.** No `while`, no `for`. The queue is a `MutableRef<Array<string>>` so the `whileLoop` body can mutate it without leaking through Effect's purity boundary. The discovered responses go into a `MutableHashMap` (also from `effect`).

```ts
import { MutableRef, MutableHashMap } from "effect";

const walkRoutes = (
  fetch: (route: string) => Effect.Effect<EiaApiResponse, EiaApiFetchError | EiaApiDecodeError>,
  startRoute = ""
) =>
  Effect.gen(function* () {
    const queue = MutableRef.make<Array<string>>([startRoute]);
    const seen = MutableHashMap.empty<string, true>();
    const results = MutableHashMap.empty<string, EiaApiResponse>();

    yield* Effect.whileLoop({
      while: () => MutableRef.get(queue).length > 0,
      body: () =>
        Effect.gen(function* () {
          const current = MutableRef.get(queue);
          const [next, ...rest] = current;
          MutableRef.set(queue, rest);

          if (MutableHashMap.has(seen, next)) return null;
          MutableHashMap.set(seen, next, true);

          const resp = yield* fetch(next);
          MutableHashMap.set(results, next, resp);

          const childRoutes = resp.response.routes ?? [];
          const childPaths = childRoutes.map((c) =>
            next === "" ? c.id : `${next}/${c.id}`
          );
          MutableRef.set(queue, [...MutableRef.get(queue), ...childPaths]);
          return null;
        }),
      step: () => {}
    });

    return results;
  });

export const walkRoutesForTesting = walkRoutes;
```

**Why `MutableRef`/`MutableHashMap` and not plain JS `Set`/`Array`:** Effect provides these so the mutable state stays inside an Effect-typed boundary. They're cheaper than `Ref`/`SynchronizedRef` since this loop is single-fiber, but they still let us reason about mutation explicitly. The `step` callback is unused (no per-iteration log).

**Step 5: Run test, verify pass.**

**Step 6: Add walk-cache read/write.**

```ts
const walkCachePath = (rootDir: string) =>
  resolve(rootDir, "reports", "harvest", "eia-api-v2-walk.json");

const readWalkCache = (rootDir: string, ttlDays: number) =>
  Effect.gen(function* () {
    const fs_ = yield* FileSystem.FileSystem;
    const path = walkCachePath(rootDir);
    const exists = yield* Effect.exit(fs_.access(path));
    if (exists._tag === "Failure") return null;
    const text = yield* fs_.readFileString(path);
    const decoded = decodeJsonStringWith(WalkCache)(text);
    const ageMs = Date.now() - new Date(decoded.fetchedAt).getTime();
    if (ageMs > ttlDays * 86400_000) return null;
    return decoded;
  });

const writeWalkCache = (rootDir: string, cache: WalkCache) =>
  Effect.gen(function* () {
    const fs_ = yield* FileSystem.FileSystem;
    const path = walkCachePath(rootDir);
    yield* fs_.makeDirectory(dirname(path), { recursive: true });
    yield* fs_.writeFileString(path, encodeJsonString(cache));
  });
```

**Step 7: Add a `getWalkData` helper that returns a normal `ReadonlyMap` regardless of source.** `--no-cache` must bypass the shared cache entirely. `--only-route` must walk just that subtree and must also bypass the shared cache so a partial walk never overwrites the full-root snapshot.

```ts
import { Option } from "effect";

const getWalkData = (config: ScriptConfigShape, apiKey: string) =>
  Effect.gen(function* () {
    const startRoute = Option.getOrElse(config.onlyRoute, () => "");
    const scoped = startRoute !== "";

    if (!config.noCache && !scoped) {
      const cached = yield* readWalkCache(config.rootDir, config.cacheTtlDays);
      if (cached) {
        yield* Effect.log(`Using cached walk from ${cached.fetchedAt}`);
        return new Map(Object.entries(cached.routes));
      }
    } else if (config.noCache) {
      yield* Effect.log("Skipping walk cache because --no-cache was set");
    } else {
      yield* Effect.log(`Scoped walk for ${startRoute}; shared cache disabled`);
    }

    yield* Effect.log(
      scoped
        ? `Walking EIA API v2 fresh from subtree ${startRoute}...`
        : "Walking EIA API v2 fresh..."
    );
    const fetcher = yield* makeRateLimitedFetcher(config.minIntervalMs, config.maxRetries);
    const results = yield* walkRoutes((route) => fetcher(route, apiKey), startRoute);

    // Snapshot MutableHashMap → Record for cache persistence.
    // MutableHashMap is itself Iterable<[K, V]> (see effect/src/MutableHashMap.ts:69),
    // so we can iterate it directly inside Effect.sync. There is no
    // MutableHashMap.entries helper in this Effect version.
    const snapshot = yield* Effect.sync(() => {
      const out: Record<string, EiaApiResponse> = {};
      for (const [route, response] of results) {
        out[route] = response;
      }
      return out;
    });

    if (!config.noCache && !scoped) {
      yield* writeWalkCache(config.rootDir, {
        fetchedAt: new Date().toISOString(),
        routes: snapshot
      });
    }
    yield* Effect.log(`Walked ${Object.keys(snapshot).length} routes`);
    return new Map(Object.entries(snapshot));
  });
```

**Step 8: Run live walk via a temporary `main` that calls `getWalkData` and logs the count.**

Run: `bun scripts/cold-start-ingest-eia.ts`
Expected: log "Walking EIA API v2 fresh...", then "Walked N routes" (N expected ~150–300, including non-leaf nodes). Walk cache at `references/cold-start/reports/harvest/eia-api-v2-walk.json`.

**Step 9: Run again to confirm cache hit.**

Run: `bun scripts/cold-start-ingest-eia.ts`
Expected: log "Using cached walk from <timestamp>". No HTTP traffic.

**Step 10: Commit.**

```bash
git add scripts/cold-start-ingest-eia.ts tests/cold-start-ingest-eia.test.ts references/cold-start/reports/harvest/eia-api-v2-walk.json
git commit -m "feat(sky-254): lazy whileLoop walk of EIA API v2 with disk cache"
```

---

## Task 5.5: Build candidate nodes, validate, then build the `IngestGraph`

**Files:**
- Modify: `scripts/cold-start-ingest-eia.ts`
- Test: `tests/cold-start-ingest-eia.test.ts`

**Goal:** define the `IngestNode` / `IngestEdge` types and the build pipeline. The flow is **build → validate → graph** so the graph contains *only* validated entities — never candidates. The graph IS the catalog after this step.

**Critical edge-direction rule:** In Effect's `Graph.topo` (Kahn's algorithm — verified at `.reference/effect/packages/effect/src/Graph.ts:3878-3917`), edges encode dependencies: `A → B` means *A must be emitted before B* (`B`'s in-degree includes `A`). For our pipeline, that means edges flow from "thing that must be written first" to "thing that depends on it". Concretely:

| Edge | Reason |
|------|--------|
| `agent → catalog`        | Catalog.publisherAgentId references Agent.id |
| `agent → dataset`        | Dataset.publisherAgentId references Agent.id |
| `agent → data-service`   | DataService.publisherAgentId references Agent.id |
| `catalog → catalog-record` | CatalogRecord.catalogId references Catalog.id |
| `dataset → distribution` | Distribution.datasetId references Dataset.id |
| `dataset → catalog-record` | CatalogRecord.primaryTopicId references Dataset.id |
| `dataset → data-service` | DataService.servesDatasetIds[] references Dataset.id |

Topological emission: Agent → {Catalog, Dataset} → {Distribution, CatalogRecord, DataService}. (Catalog and Dataset are independent; their relative order is a topo-sort tiebreak. CatalogRecord lands after both Catalog and Dataset.)

**Step 1: Define the node and edge types.**

```ts
import { Graph } from "effect";

export type IngestNode =
  | { readonly _tag: "agent";          readonly slug: string; readonly data: Agent }
  | { readonly _tag: "catalog";        readonly slug: string; readonly data: Catalog }
  | { readonly _tag: "data-service";   readonly slug: string; readonly data: DataService }
  | { readonly _tag: "dataset";        readonly slug: string; readonly data: Dataset; readonly merged: boolean }
  | { readonly _tag: "distribution";   readonly slug: string; readonly data: Distribution }
  | { readonly _tag: "catalog-record"; readonly slug: string; readonly data: CatalogRecord };

export type IngestEdge =
  | "publishes"
  | "record-in"
  | "primary-topic"
  | "distribution-of"
  | "served-by";

export type IngestGraph = Graph.DirectedGraph<IngestNode, IngestEdge>;
```

**Step 2: Failing test — build a graph from one fake leaf and assert node count + topology.**

```ts
it.effect("buildIngestGraph produces expected node and edge counts for one leaf", () =>
  Effect.gen(function* () {
    const walkData = new Map<string, EiaApiResponse>([
      ["electricity/retail-sales", { response: { id: "retail-sales", name: "Retail Sales", facets: [] } }]
    ]);
    const idx = makeFakeCatalogIndex(); // helper that returns existing eia Agent/Catalog/DataService
    const graph = yield* buildIngestGraphForTesting(walkData, idx, fakeCtx);

    // 1 agent + 1 catalog + 1 data-service + 1 dataset + 1 distribution (api-access) + 1 catalog-record = 6 nodes
    expect(Graph.nodeCount(graph)).toBe(6);
    expect(Graph.isAcyclic(graph)).toBe(true);
  })
);
```

**Step 3: Run test, verify failure.**

**Step 4: Implement `buildContextFromIndex`.** Helper that extracts the EIA-specific roots from the catalog index. Used by both Task 5.5 and main.

```ts
interface BuildContext {
  readonly nowIso: string;
  readonly eiaAgent: Agent;
  readonly eiaCatalog: Catalog;
  readonly eiaDataService: DataService;
}

const buildContextFromIndex = (
  idx: CatalogIndex,
  nowIso: string
): Effect.Effect<BuildContext, EiaIngestLedgerError> =>
  Effect.gen(function* () {
    if (!idx.catalog || !idx.dataService) {
      return yield* new EiaIngestLedgerError({
        message: "EIA Catalog or DataService missing from cold-start registry"
      });
    }
    const eiaAgent = [...idx.agentsByName.values()].find((a) =>
      a.aliases.some((al) => al.scheme === "url" && al.value === "https://www.eia.gov/")
    );
    if (!eiaAgent) {
      return yield* new EiaIngestLedgerError({ message: "EIA Agent missing from registry" });
    }
    return { nowIso, eiaAgent, eiaCatalog: idx.catalog, eiaDataService: idx.dataService };
  });
```

**Step 5: Implement `buildCandidateNodes`.** Pure function that produces an `Array<IngestNode>` where each node's `data` is still a *candidate* (not yet schema-validated). The DataService node is built last because its `servesDatasetIds` needs to know every Dataset's id.

```ts
const buildCandidateNodes = (
  walkData: ReadonlyMap<string, EiaApiResponse>,
  idx: CatalogIndex,
  ctx: BuildContext
): Array<IngestNode> => {
  // 1. Compute leaf entries with their merged Dataset candidates first.
  //    Dataset ids are needed by both the data-service node (for
  //    servesDatasetIds) and per-dataset Distribution / CatalogRecord nodes.
  type LeafCandidate = {
    readonly slug: string;
    readonly leafPath: string;
    readonly parents: ReadonlyArray<string>;
    readonly existingDataset: Dataset | null;
    readonly existingCr: CatalogRecord | null;
    readonly datasetCandidate: Dataset; // pre-decoded shape, validated in Task 8
    readonly distCandidates: ReadonlyArray<Distribution>;
    readonly crCandidate: CatalogRecord;
  };

  const leafCandidates: Array<LeafCandidate> = [];
  for (const [path, resp] of walkData) {
    if (path === "") continue;
    const childRoutes = resp.response.routes ?? [];
    if (childRoutes.length > 0) continue; // not a leaf

    const slug = slugifyRoute(path);
    const parents = path.split("/").slice(0, -1);
    const existingDataset = idx.datasetsByRoute.get(path) ?? null;

    const datasetCandidate = buildDatasetCandidate(
      { slug, leafPath: path, parents, response: resp.response },
      ctx,
      existingDataset
    );
    const distCandidates = buildDistributionCandidates(
      { slug, leafPath: path, parents, response: resp.response },
      datasetCandidate.id,
      ctx,
      idx
    );
    datasetCandidate.distributionIds = distCandidates.map((d) => d.id);

    // CR merge key MUST be (catalogId, primaryTopicId) — see fix #4 in
    // the v3 review. Multiple catalogs may carry CRs for the same dataset
    // (e.g. EIA's authoritative CR + Data.gov's duplicate). We only ever
    // touch CRs whose catalogId === ctx.eiaCatalog.id.
    const existingCr = idx.catalogRecordsByCatalogAndPrimaryTopic.get(
      `${ctx.eiaCatalog.id}::${datasetCandidate.id}`
    ) ?? null;

    const crCandidate = buildCatalogRecord(datasetCandidate, ctx, existingCr);

    leafCandidates.push({
      slug, leafPath: path, parents,
      existingDataset, existingCr,
      datasetCandidate, distCandidates, crCandidate
    });
  }

  // 2. Top-level scope nodes. The DataService node carries the union of
  //    its existing servesDatasetIds with every Dataset id we just
  //    minted/merged — that's what fix #2 from the v3 review requires.
  const allDatasetIds = Array.from(new Set([
    ...ctx.eiaDataService.servesDatasetIds,
    ...leafCandidates.map((l) => l.datasetCandidate.id)
  ]));

  const agentNode: IngestNode = {
    _tag: "agent",
    slug: "eia",
    data: { ...ctx.eiaAgent, updatedAt: ctx.nowIso }
  };
  const catalogNode: IngestNode = {
    _tag: "catalog",
    slug: "eia",
    data: { ...ctx.eiaCatalog, updatedAt: ctx.nowIso }
  };
  const dataServiceNode: IngestNode = {
    _tag: "data-service",
    slug: "eia-api",
    data: {
      ...ctx.eiaDataService,
      servesDatasetIds: allDatasetIds,
      updatedAt: ctx.nowIso
    }
  };

  // 3. Flatten per-leaf candidates into IngestNodes
  const datasetNodes: Array<IngestNode> = leafCandidates.map((l) => ({
    _tag: "dataset",
    slug: l.slug,
    data: l.datasetCandidate,
    merged: l.existingDataset !== null
  }));
  const distNodes: Array<IngestNode> = leafCandidates.flatMap((l) =>
    l.distCandidates.map((d) => ({
      _tag: "distribution" as const,
      slug: `${l.slug}-${d.kind}`,
      data: d
    }))
  );
  const crNodes: Array<IngestNode> = leafCandidates.map((l) => ({
    _tag: "catalog-record",
    slug: `${l.slug}-cr`,
    data: l.crCandidate
  }));

  return [agentNode, catalogNode, dataServiceNode, ...datasetNodes, ...distNodes, ...crNodes];
};
```

**Step 6: Implement `buildIngestGraph`** — pure function that takes an `Array<IngestNode>` (already validated by Task 8) and assembles the graph. The mutate callback only contains plain `for` loops (synchronous-block exception), exactly mirroring `/Users/pooks/Dev/skygest-editorial/src/narrative/BuildGraph.ts:950-1018`.

```ts
const buildIngestGraph = (validatedNodes: ReadonlyArray<IngestNode>): IngestGraph => {
  // Index nodes by a stable composite key so we can resolve edges
  // (key = "<tag>::<id>" — works because schema ids are unique per tag)
  const nodeKey = (n: IngestNode) => `${n._tag}::${n.data.id}`;

  return Graph.directed<IngestNode, IngestEdge>((mutable) => {
    const indexById = new Map<string, number>();

    // Pass 1: add all nodes
    for (const node of validatedNodes) {
      indexById.set(nodeKey(node), Graph.addNode(mutable, node));
    }

    // Pass 2: add edges (dependency direction — see edge-direction rule above)
    const agentNodes      = validatedNodes.filter((n): n is Extract<IngestNode, { _tag: "agent" }>          => n._tag === "agent");
    const catalogNodes    = validatedNodes.filter((n): n is Extract<IngestNode, { _tag: "catalog" }>        => n._tag === "catalog");
    const dataServiceNodes = validatedNodes.filter((n): n is Extract<IngestNode, { _tag: "data-service" }> => n._tag === "data-service");
    const datasetNodes    = validatedNodes.filter((n): n is Extract<IngestNode, { _tag: "dataset" }>        => n._tag === "dataset");
    const distNodes       = validatedNodes.filter((n): n is Extract<IngestNode, { _tag: "distribution" }>   => n._tag === "distribution");
    const crNodes         = validatedNodes.filter((n): n is Extract<IngestNode, { _tag: "catalog-record" }> => n._tag === "catalog-record");

    for (const agent of agentNodes) {
      const agentIdx = indexById.get(nodeKey(agent))!;
      // agent → catalog (Catalog.publisherAgentId)
      for (const catalog of catalogNodes) {
        if (catalog.data.publisherAgentId === agent.data.id) {
          Graph.addEdge(mutable, agentIdx, indexById.get(nodeKey(catalog))!, "publishes");
        }
      }
      // agent → dataset (Dataset.publisherAgentId)
      for (const ds of datasetNodes) {
        if (ds.data.publisherAgentId === agent.data.id) {
          Graph.addEdge(mutable, agentIdx, indexById.get(nodeKey(ds))!, "publishes");
        }
      }
      // agent → dataService (DataService.publisherAgentId)
      for (const svc of dataServiceNodes) {
        if (svc.data.publisherAgentId === agent.data.id) {
          Graph.addEdge(mutable, agentIdx, indexById.get(nodeKey(svc))!, "publishes");
        }
      }
    }

    for (const ds of datasetNodes) {
      const dsIdx = indexById.get(nodeKey(ds))!;
      // dataset → distribution (Distribution.datasetId)
      for (const dist of distNodes) {
        if (dist.data.datasetId === ds.data.id) {
          Graph.addEdge(mutable, dsIdx, indexById.get(nodeKey(dist))!, "has-distribution");
        }
      }
      // dataset → catalog-record (CatalogRecord.primaryTopicId)
      for (const cr of crNodes) {
        if (cr.data.primaryTopicId === ds.data.id) {
          Graph.addEdge(mutable, dsIdx, indexById.get(nodeKey(cr))!, "primary-topic-of");
        }
      }
      // dataset → dataService (DataService.servesDatasetIds[])
      for (const svc of dataServiceNodes) {
        if (svc.data.servesDatasetIds.includes(ds.data.id)) {
          Graph.addEdge(mutable, dsIdx, indexById.get(nodeKey(svc))!, "served-by");
        }
      }
    }

    for (const catalog of catalogNodes) {
      const catIdx = indexById.get(nodeKey(catalog))!;
      // catalog → catalog-record (CatalogRecord.catalogId)
      for (const cr of crNodes) {
        if (cr.data.catalogId === catalog.data.id) {
          Graph.addEdge(mutable, catIdx, indexById.get(nodeKey(cr))!, "contains-record");
        }
      }
    }
  });
};
```

**Step 7: Update `IngestEdge` to match the dependency-direction labels.**

```ts
export type IngestEdge =
  | "publishes"          // agent → {catalog, dataset, data-service}
  | "contains-record"    // catalog → catalog-record
  | "has-distribution"   // dataset → distribution
  | "primary-topic-of"   // dataset → catalog-record
  | "served-by";         // dataset → data-service
```

**Step 8: Sanity-check `Graph.isAcyclic` after construction in `main`** — a cycle here is a programmer error in `buildIngestGraph` (e.g., the edge directions got flipped again). Fail loudly with `EiaIngestLedgerError` if detected.

**Step 6: Run test, verify pass.**

**Step 7: Commit.**

```bash
git add scripts/cold-start-ingest-eia.ts tests/cold-start-ingest-eia.test.ts
git commit -m "feat(sky-254): IngestGraph build via Graph.directed (catalog as graph)"
```

---

## Task 6: Existing-entity index loader

**Files:**
- Modify: `scripts/cold-start-ingest-eia.ts`
- Test: `tests/cold-start-ingest-eia.test.ts`

**Step 1: Define the index shape.**

```ts
interface CatalogIndex {
  readonly datasetsByRoute: Map<string, Dataset>;
  readonly distributionsByDatasetIdKind: Map<string, Distribution>;
  // CR index is keyed by (catalogId, primaryTopicId), NOT primaryTopicId
  // alone — the registry contains multiple CRs for the same dataset from
  // different catalogs (e.g. the EIA-published authoritative CR plus a
  // Data.gov duplicate CR). Verified via:
  //   references/cold-start/catalog/catalog-records/eia-electricity-data-cr.json
  //   references/cold-start/catalog/catalog-records/eia-electricity-data-datagov-cr.json
  // The script only ever merges CRs whose catalogId === EIA catalog id;
  // CRs from other catalogs are read but never touched.
  readonly catalogRecordsByCatalogAndPrimaryTopic: Map<string, CatalogRecord>;
  readonly agentsByName: Map<string, Agent>;
  readonly catalog: Catalog | null;
  readonly dataService: DataService | null;
  readonly allDatasets: ReadonlyArray<Dataset>;
  readonly allDistributions: ReadonlyArray<Distribution>;
  readonly allCatalogRecords: ReadonlyArray<CatalogRecord>;
}
```

**Note:** the only Dataset merge key is `eia-route`. After Task 0.5, the legacy bulk-manifest codes have moved to `eia-bulk-id` and no longer collide with API v2 paths, so route-based indexing is sufficient.

**Step 2: Failing test — load a temp dir with one EIA dataset and verify it's indexed by route alias.**

```ts
it.effect("indexes existing EIA dataset by eia-route alias", () =>
  Effect.gen(function* () {
    const tmp = yield* makeTmpFixture(/* see helper below */);
    const idx = yield* loadCatalogIndexForTesting(tmp);
    const ds = idx.datasetsByRoute.get("electricity/retail-sales");
    expect(ds).toBeDefined();
    expect(ds!.title).toBe("Existing");
  })
);
```

(Add a `makeTmpFixture` helper in the test that writes one Dataset JSON file with the right alias.)

**Step 3: Run test, verify failure.**

**Step 4: Implement `loadCatalogIndex`.** Walks `<rootDir>/catalog/{datasets,distributions,catalog-records,data-services,catalogs,agents}/`, decodes each JSON through the matching domain Schema using `decodeJsonStringWith`, indexes by alias scheme. Failure to decode any file aborts with `EiaIngestSchemaError`. **No `for ... of` over file lists** — use `Effect.forEach` with concurrency 10 (matching `BuildGraph.ts:151` `FILESYSTEM_CONCURRENCY = 10`).

```ts
const decodeFileAs = <S extends Schema.Top>(
  schema: S, kind: string, slug: string
) =>
  (text: string): Effect.Effect<S["Type"], EiaIngestSchemaError> =>
    Effect.try({
      try: () => decodeJsonStringWith(schema)(text),
      catch: (cause) => new EiaIngestSchemaError({
        kind, slug, message: formatSchemaParseError(cause as any)
      })
    });

const loadEntitiesFromDir = <S extends Schema.Top>(
  fs_: FileSystem.FileSystem,
  rootDir: string,
  subDir: string,
  schema: S,
  kind: string
) =>
  Effect.gen(function* () {
    const dir = resolve(rootDir, "catalog", subDir);
    const files = (yield* fs_.readDirectory(dir)).filter((f) => f.endsWith(".json"));
    return yield* Effect.forEach(
      files,
      (file) =>
        Effect.gen(function* () {
          const slug = file.replace(/\.json$/, "");
          const text = yield* fs_.readFileString(resolve(dir, file));
          return yield* decodeFileAs(schema, kind, slug)(text);
        }),
      { concurrency: 10 }
    );
  });

const loadCatalogIndex = (rootDir: string) =>
  Effect.gen(function* () {
    const fs_ = yield* FileSystem.FileSystem;
    const [datasets, distributions, catalogRecords, dataServices, catalogs, agents] =
      yield* Effect.all([
        loadEntitiesFromDir(fs_, rootDir, "datasets",        Dataset,        "Dataset"),
        loadEntitiesFromDir(fs_, rootDir, "distributions",   Distribution,   "Distribution"),
        loadEntitiesFromDir(fs_, rootDir, "catalog-records", CatalogRecord,  "CatalogRecord"),
        loadEntitiesFromDir(fs_, rootDir, "data-services",   DataService,    "DataService"),
        loadEntitiesFromDir(fs_, rootDir, "catalogs",        Catalog,        "Catalog"),
        loadEntitiesFromDir(fs_, rootDir, "agents",          Agent,          "Agent")
      ], { concurrency: "unbounded" });

    // Build the indices in a single Effect.sync block (no Effect needed inside)
    return yield* Effect.sync(() => {
      const datasetsByRoute = new Map<string, Dataset>();
      const distributionsByDatasetIdKind = new Map<string, Distribution>();
      const agentsByName = new Map<string, Agent>();

      for (const ds of datasets) {
        const route = ds.aliases.find((a) => a.scheme === "eia-route" && a.value.includes("/"))?.value;
        if (route) datasetsByRoute.set(route, ds);
      }
      for (const dist of distributions) {
        distributionsByDatasetIdKind.set(`${dist.datasetId}::${dist.kind}`, dist);
      }
      for (const ag of agents) {
        agentsByName.set(ag.name, ag);
      }

      // Compound key: (catalogId, primaryTopicId). Each catalog can have
      // its own CR for the same dataset; we want all of them visible to
      // the script and only ever merge into the EIA-catalog ones.
      const catalogRecordsByCatalogAndPrimaryTopic = new Map<string, CatalogRecord>();
      for (const cr of catalogRecords) {
        catalogRecordsByCatalogAndPrimaryTopic.set(`${cr.catalogId}::${cr.primaryTopicId}`, cr);
      }

      // Find the EIA-published catalog and dataService (the ones we care about)
      const eiaAgent = agents.find((a) =>
        a.aliases.some((al) => al.scheme === "url" && al.value === "https://www.eia.gov/")
      );
      const catalog = eiaAgent
        ? catalogs.find((c) => c.publisherAgentId === eiaAgent.id) ?? null
        : null;
      const dataService = eiaAgent
        ? dataServices.find((s) => s.publisherAgentId === eiaAgent.id) ?? null
        : null;

      return {
        datasetsByRoute,
        distributionsByDatasetIdKind,
        catalogRecordsByCatalogAndPrimaryTopic,
        agentsByName,
        catalog,
        dataService,
        allDatasets: datasets,
        allDistributions: distributions,
        allCatalogRecords: catalogRecords
      };
    });
  });
```

The `for ... of` loops inside `Effect.sync` are pure synchronous index-building over already-fetched data — that's a synchronous-block exception, equivalent to the `for` loops inside `Graph.directed`'s mutate callback. Effect-typed code (the file reads, decodes) goes through `Effect.forEach`/`Effect.all`.

**Implementation note:** index lookup keys:
- `datasetsByRoute`: `dataset.aliases.find(a => a.scheme === "eia-route")?.value` — only entries that look like API v2 paths (i.e. contain `/`) are indexed; legacy bulk codes have been migrated to `eia-bulk-id` in Task 0.5 and are intentionally invisible to this index.
- `distributionsByDatasetIdKind`: `${dist.datasetId}::${dist.kind}`
- `catalog`/`dataService`: filter to publisher = EIA agent ID

**Step 5: Run test, verify pass.**

**Step 6: Commit.**

```bash
git add scripts/cold-start-ingest-eia.ts tests/cold-start-ingest-eia.test.ts
git commit -m "feat(sky-254): catalog index loader with alias-keyed lookup"
```

---

## Task 7: Pure record builders (Dataset, Distribution, CatalogRecord)

**Files:**
- Modify: `scripts/cold-start-ingest-eia.ts`
- Test: `tests/cold-start-ingest-eia.test.ts`

These are pure functions returning *unvalidated candidate* objects. Validation happens in Task 8.

**Step 1: Failing tests for `buildDatasetCandidate`, `buildDistributionCandidates`, `buildCatalogRecord`.**

Cover: title from `response.name`; themes from parents; the **only** alias that gets minted is `eia-route` (value = full path); merge preserves `id` + `createdAt` and bumps `updatedAt`; merge preserves any existing `landingPage` (do NOT clobber human-curated topic pages); fresh case mints new ULID; distributions have correct `accessURL` and `kind`; `defaultFrequency` ends up in `keywords`, NOT in aliases.

**Step 2: Run tests, verify failure.**

**Step 3: Implement builders.**

```ts
import { ulid } from "ulid";

const slugifyRoute = (route: string) => `eia-${route.replace(/\//g, "-")}`;

const datasetIdFromUlid = () => `https://id.skygest.io/dataset/ds_${ulid()}` as const;
const distIdFromUlid = () => `https://id.skygest.io/distribution/dist_${ulid()}` as const;
const crIdFromUlid = () => `https://id.skygest.io/catalog-record/cr_${ulid()}` as const;

// Reuse BuildContext from Task 5.5 (nowIso + full EIA Agent / Catalog /
// DataService records). Builders need the full objects, not just their ids.
interface LeafRoute {
  readonly path: string;
  readonly parents: ReadonlyArray<string>;
  readonly response: EiaApiResponse["response"];
}

const buildDatasetCandidate = (
  leaf: LeafRoute,
  ctx: BuildContext,
  existing: Dataset | null
) => {
  const slug = slugifyRoute(leaf.path);
  const id = existing?.id ?? datasetIdFromUlid();
  const createdAt = existing?.createdAt ?? ctx.nowIso;
  const updatedAt = ctx.nowIso;

  // Only one alias is minted by ingestion: the API v2 route path.
  // Every other alias scheme used elsewhere in the registry (eia-bulk-id,
  // eia-series, ror, wikidata, doi, ...) is hand-curated and we preserve
  // whatever the existing record already has via unionAliases.
  const newAliases = [
    { scheme: "eia-route" as const, value: leaf.path, relation: "exactMatch" as const }
  ];
  const aliases = unionAliases(existing?.aliases ?? [], newAliases);

  // Merge contract: PRESERVE curated metadata when an existing record is
  // present. The API v2 surface gives us thin, structural data — humans
  // have spent time tagging these records with richer themes, keywords,
  // licenses, temporal coverage, and series links. Overwriting curated
  // values with API-derived guesses is a regression. The rule:
  //   - title:        always overwrite (API v2 is canonical)
  //   - description:  prefer existing if set (API v2 descriptions are terse)
  //   - publisherAgentId, dataServiceIds: always overwrite (structural)
  //   - landingPage:  preserve existing; never synthesize (covered earlier)
  //   - accessRights, license: preserve existing if set
  //   - temporal:     preserve existing if set (API v2 dates are coarser)
  //   - keywords:     UNION existing + facet ids + defaultFrequency
  //   - themes:       preserve existing if non-empty, else fall back to
  //                   parent route segments (the structural derivation)
  //   - inSeries:     preserve existing (curated link to DatasetSeries)
  //   - aliases:      union (handled above)
  //   - distributionIds: rewritten in main after distributions are built
  const facetIds = (leaf.response.facets ?? []).map((f) => f.id);
  const freqKw = leaf.response.defaultFrequency ? [leaf.response.defaultFrequency] : [];
  const mergedKeywords = Array.from(new Set([
    ...(existing?.keywords ?? []),
    ...facetIds,
    ...freqKw
  ]));

  const mergedThemes =
    existing?.themes && existing.themes.length > 0
      ? existing.themes
      : leaf.parents;

  const mergedTemporal = existing?.temporal
    ?? (leaf.response.startPeriod && leaf.response.endPeriod
          ? `${leaf.response.startPeriod}/${leaf.response.endPeriod}`
          : undefined);

  return {
    _tag: "Dataset" as const,
    id,
    title: leaf.response.name ?? leaf.response.id,
    description: existing?.description ?? leaf.response.description,
    publisherAgentId: ctx.eiaAgent.id,
    ...(existing?.landingPage ? { landingPage: existing.landingPage } : {}),
    accessRights: existing?.accessRights ?? "public" as const,
    license: existing?.license ?? "https://www.eia.gov/about/copyrights_reuse.php",
    keywords: mergedKeywords,
    themes: mergedThemes,
    ...(mergedTemporal ? { temporal: mergedTemporal } : {}),
    ...(existing?.inSeries ? { inSeries: existing.inSeries } : {}),
    aliases,
    createdAt,
    updatedAt,
    dataServiceIds: [ctx.eiaDataService.id],
    distributionIds: [] // populated after distributions are built
  };
};

const unionAliases = (
  existing: ReadonlyArray<{ scheme: string; value: string; relation: string }>,
  fresh: ReadonlyArray<{ scheme: string; value: string; relation: string }>
) => {
  const seen = new Set<string>();
  const out: Array<{ scheme: string; value: string; relation: string }> = [];
  for (const a of [...existing, ...fresh]) {
    const key = `${a.scheme}::${a.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
};
```

(Distribution and CatalogRecord builders follow the same shape — see Task 2's domain schema reference for which fields to set. **Distribution builders must also preserve any existing fields not derivable from API v2** — specifically `format`, `mediaType`, `title`, and any hand-curated `accessURL` for download-kind distributions where the API v2 walk doesn't tell us anything new.)

**Step 4: Run tests, verify pass.**

**Step 5: Commit.**

```bash
git add scripts/cold-start-ingest-eia.ts tests/cold-start-ingest-eia.test.ts
git commit -m "feat(sky-254): pure builders for Dataset/Distribution/CatalogRecord candidates"
```

---

## Task 8: `validateNode` dispatcher + `Effect.partition` candidate validation

**Files:**
- Modify: `scripts/cold-start-ingest-eia.ts`
- Test: `tests/cold-start-ingest-eia.test.ts`

**Step 1: Failing tests.** Two cases:

1. `validateNode` rejects a Dataset node with an invalid id and returns `EiaIngestSchemaError`.
2. `validateCandidates` partitions nodes into `[failures, successes]` and returns failures-first; given an array with two valid agent nodes and one invalid dataset node, the result should report the dataset failure but not abort.

```ts
it.effect("validateNode rejects an invalid Dataset", () =>
  Effect.gen(function* () {
    const bad: IngestNode = {
      _tag: "dataset",
      slug: "bad",
      merged: false,
      data: { _tag: "Dataset", id: "not-a-uri", title: "x", aliases: [],
              createdAt: "2026-04-10T00:00:00.000Z", updatedAt: "2026-04-10T00:00:00.000Z" } as any
    };
    const result = yield* Effect.exit(validateNodeForTesting(bad));
    expect(result._tag).toBe("Failure");
  })
);

it.effect("validateCandidates partitions failures and successes", () =>
  Effect.gen(function* () {
    const candidates = makeMixedFakeCandidates(); // 2 valid agents, 1 invalid dataset
    const result = yield* validateCandidatesForTesting(candidates);
    expect(result.failures.length).toBe(1);
    expect(result.successes.length).toBe(2);
  })
);
```

**Step 2: Run tests, verify failure.**

**Step 3: Implement `validateNode` (dispatches on `_tag`) and `validateCandidates` (uses `Effect.partition` over an `Array<IngestNode>`).**

The validation operates on the **candidate array**, not on a graph that's already been built. The orchestration order is: build candidates → validate candidates → if all OK, build the graph from validated → topo write. That way the graph contains *only* validated entities and the data Phase B writes is byte-identical to what Phase A blessed.

```ts
// validateNode: per-node schema dispatch.
// Returns a NEW node whose `data` field is the post-decode value. The
// caller MUST use the returned successes (not the inputs) to construct
// the IngestGraph — schema decoding may canonicalize / transform values.
const validateNode = (node: IngestNode): Effect.Effect<IngestNode, EiaIngestSchemaError> =>
  Effect.gen(function* () {
    const decode = (() => {
      switch (node._tag) {
        case "agent":          return Schema.decodeUnknown(Agent)(node.data);
        case "catalog":        return Schema.decodeUnknown(Catalog)(node.data);
        case "data-service":   return Schema.decodeUnknown(DataService)(node.data);
        case "dataset":        return Schema.decodeUnknown(Dataset)(node.data);
        case "distribution":   return Schema.decodeUnknown(Distribution)(node.data);
        case "catalog-record": return Schema.decodeUnknown(CatalogRecord)(node.data);
      }
    })();
    const decoded = yield* decode.pipe(
      Effect.mapError((issue) => new EiaIngestSchemaError({
        kind: node._tag,
        slug: node.slug,
        message: formatSchemaParseError(issue)
      }))
    );
    // Re-build the IngestNode with the validated data, preserving _tag,
    // slug, and (for dataset) the merged flag.
    return { ...node, data: decoded } as IngestNode;
  });

// validateCandidates: Effect.partition over the candidate array.
// Collects ALL failures in one parallel pass so a fix-and-rerun cycle
// catches every problem at once instead of fail-fast.
const validateCandidates = (candidates: ReadonlyArray<IngestNode>) =>
  Effect.gen(function* () {
    const [failures, successes] = yield* Effect.partition(
      candidates,
      validateNode,
      { concurrency: "unbounded" }
    );
    return { failures, successes };
  });

export const validateNodeForTesting = validateNode;
export const validateCandidatesForTesting = validateCandidates;
```

**Why operate on the candidate array, not on the built graph:** if validation runs after graph construction, the validated copies have to be re-stitched into a new graph (or the original graph's node data has to be mutated in place — which `Graph` doesn't expose). It's simpler to validate the flat array and only build the graph from the proven-valid nodes. The graph build (Task 5.5 Step 6) is pure, so building it twice (once on candidates only as a sanity check, once on validated nodes) is cheap if needed. In `main` we only build it once, after validation passes.

**Step 4: Run tests, verify pass.**

**Step 5: Commit.**

```bash
git add scripts/cold-start-ingest-eia.ts tests/cold-start-ingest-eia.test.ts
git commit -m "feat(sky-254): schema validation gate for minted records"
```

---

## Task 9: Atomic write helpers + entity-id ledger

**Files:**
- Modify: `scripts/cold-start-ingest-eia.ts`
- Test: `tests/cold-start-ingest-eia.test.ts`

**Step 1: Failing tests.** Three cases:

1. `writeEntityFile` writes via temp + rename (assert tmp file does not exist after success).
2. `loadLedger` returns `{}` when `.entity-ids.json` is missing (ENOENT).
3. `loadLedger` **fails** with `EiaIngestLedgerError` when the file exists but is unreadable for any other reason — e.g. permission-denied, decode failure, IO error. This test must use a fixture that simulates a non-ENOENT failure (e.g. write a file with invalid JSON content).

The ENOENT-vs-other distinction is the safety contract: a missing ledger means "first run", which is fine; any other failure means "something is wrong on disk", which must abort the run rather than silently re-mint every ID.

**Step 2: Implement.**

```ts
const writeEntityFile = (filePath: string, content: string) =>
  Effect.gen(function* () {
    const fs_ = yield* FileSystem.FileSystem;
    const tmp = `${filePath}.tmp-${Date.now()}`;
    yield* fs_.makeDirectory(dirname(filePath), { recursive: true });
    yield* fs_.writeFileString(tmp, content);
    yield* fs_.rename(tmp, filePath);
  });

const EntityIdLedger = Schema.Record(Schema.String, Schema.String);

// Distinguish "ledger does not exist" (a normal first-run condition) from
// any other read failure (which must abort, not silently re-mint IDs).
const loadLedger = (rootDir: string) =>
  Effect.gen(function* () {
    const fs_ = yield* FileSystem.FileSystem;
    const path = resolve(rootDir, ".entity-ids.json");

    // Pre-flight: does the file exist?
    const exists = yield* Effect.exit(fs_.access(path));
    if (exists._tag === "Failure") {
      // Inspect the error message — our local FS adapter wraps node:fs errors
      // and surfaces ENOENT in the message. Treat ENOENT as "first run, empty
      // ledger". Anything else is a hard failure.
      const message = stringifyUnknown(exists.cause).toLowerCase();
      if (message.includes("enoent") || message.includes("no such file")) {
        return {} as Record<string, string>;
      }
      return yield* new EiaIngestLedgerError({
        message: `Cannot access ledger at ${path}: ${stringifyUnknown(exists.cause)}`
      });
    }

    // File exists — read and decode. Any failure here is a real error.
    const text = yield* fs_.readFileString(path).pipe(
      Effect.mapError((cause) => new EiaIngestLedgerError({
        message: `Cannot read ledger at ${path}: ${stringifyUnknown(cause)}`
      }))
    );
    return yield* Effect.try({
      try: () => decodeJsonStringWith(EntityIdLedger)(text),
      catch: (cause) => new EiaIngestLedgerError({
        message: `Cannot decode ledger at ${path}: ${stringifyUnknown(cause)}`
      })
    });
  });

const saveLedger = (rootDir: string, ledger: Record<string, string>) =>
  writeEntityFile(
    resolve(rootDir, ".entity-ids.json"),
    encodeJsonString(ledger) + "\n"
  );
```

**Step 3-4: Run tests, verify all three pass.**

**Step 5: Commit.**

```bash
git add scripts/cold-start-ingest-eia.ts tests/cold-start-ingest-eia.test.ts
git commit -m "feat(sky-254): atomic file writes and entity-id ledger helpers"
```

---

## Task 10: End-to-end orchestration via graph traversal

**Files:**
- Modify: `scripts/cold-start-ingest-eia.ts`

**Architectural contract:**

- **Stage 1 — fetch** (Task 5): walk EIA API v2 into a `Map<route, EiaApiResponse>`.
- **Stage 2a — build candidates** (Task 5.5 Step 5): assemble `Array<IngestNode>` of unvalidated candidates.
- **Phase A — validate candidates** (Task 8): `validateCandidates(candidates)` runs `Effect.partition` to split into `{ failures, successes }`. If `failures.length > 0`, log every failure and abort with the first error. Disk untouched.
- **Stage 2b — build graph from validated** (Task 5.5 Step 6): `buildIngestGraph(successes)` constructs the `Graph.DirectedGraph<IngestNode, IngestEdge>` from the validated array. `Graph.isAcyclic` check confirms the edge directions are correct.
- **Phase B — write via topological traversal**: `Effect.forEach(Array.from(Graph.values(Graph.topo(graph))), writeNode, { concurrency: 1 })`. Topological order is guaranteed by the dependency-direction edges (Agent → Catalog → Dataset → {Distribution, CatalogRecord, DataService}). Writes are per-file atomic; the batch is not transactional, but Phase A makes that risk negligible (every node has already been blessed by its domain schema).
- The data Phase B writes is **byte-identical** to what Phase A validated. There is no candidate-vs-validated drift.

**Step 1: Define `writeNode` and the report shape.**

```ts
const entityFilePath = (rootDir: string, node: IngestNode): string => {
  switch (node._tag) {
    case "agent":          return resolve(rootDir, "catalog", "agents",          `${node.slug}.json`);
    case "catalog":        return resolve(rootDir, "catalog", "catalogs",        `${node.slug}.json`);
    case "data-service":   return resolve(rootDir, "catalog", "data-services",   `${node.slug}.json`);
    case "dataset":        return resolve(rootDir, "catalog", "datasets",        `${node.slug}.json`);
    case "distribution":   return resolve(rootDir, "catalog", "distributions",   `${node.slug}.json`);
    case "catalog-record": return resolve(rootDir, "catalog", "catalog-records", `${node.slug}.json`);
  }
};

const writeNode = (rootDir: string, node: IngestNode) =>
  writeEntityFile(
    entityFilePath(rootDir, node),
    encodeJsonString(node.data) + "\n"
  );

const ledgerKeyForNode = (node: IngestNode): string => {
  const kindKey: Record<IngestNode["_tag"], string> = {
    "agent": "Agent",
    "catalog": "Catalog",
    "data-service": "DataService",
    "dataset": "Dataset",
    "distribution": "Distribution",
    "catalog-record": "CatalogRecord"
  };
  return `${kindKey[node._tag]}:${node.slug}`;
};

interface IngestReport {
  readonly fetchedAt: string;
  readonly routesWalked: number;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly datasets: { readonly created: ReadonlyArray<string>; readonly merged: ReadonlyArray<string> };
  readonly distributions: { readonly count: number };
  readonly catalogRecords: { readonly count: number };
  readonly mermaidPath: string;
  readonly notes: ReadonlyArray<string>;
}
```

**Step 2: Replace stub `main` with the graph-driven pipeline.**

```ts
const main = Effect.gen(function* () {
  const config = yield* ScriptConfig;
  const apiKey = Redacted.value(config.apiKey);
  const nowIso = new Date().toISOString();

  // ---------- Stage 1: fetch ----------
  const walkData = yield* getWalkData(config, apiKey);

  // ---------- Stage 2a: build candidates ----------
  const idx = yield* loadCatalogIndex(config.rootDir);
  const ctx = yield* buildContextFromIndex(idx, nowIso);
  const candidates = buildCandidateNodes(walkData, idx, ctx);
  yield* Effect.log(`Built ${candidates.length} candidate nodes`);

  // ---------- Phase A: validate candidates ----------
  const { failures, successes } = yield* validateCandidates(candidates);
  if (failures.length > 0) {
    yield* Effect.logError(
      `Phase A validation failed: ${failures.length}/${candidates.length} node(s) failed schema validation`
    );
    yield* Effect.forEach(
      failures,
      (err) => Effect.logError(`  ${err.kind}/${err.slug}: ${err.message}`),
      { discard: true }
    );
    return yield* failures[0]; // abort with first error after logging all
  }
  yield* Effect.log(`Phase A complete: ${successes.length}/${candidates.length} nodes valid`);

  // ---------- Stage 2b: build the IngestGraph from VALIDATED nodes ----------
  const graph = buildIngestGraph(successes);
  if (!Graph.isAcyclic(graph)) {
    return yield* new EiaIngestLedgerError({
      message: "IngestGraph contains a cycle — programmer error in buildIngestGraph (edge directions flipped?)"
    });
  }
  yield* Effect.log(
    `Built IngestGraph: ${Graph.nodeCount(graph)} nodes, ${Graph.edgeCount(graph)} edges`
  );

  if (config.dryRun) {
    yield* Effect.log("DRY RUN: skipping Phase B (no files written)");
    yield* Effect.log(`Would write ${Graph.nodeCount(graph)} files in topological order`);
    return;
  }

  // ---------- Phase B: write via topological traversal ----------
  yield* Effect.log("Phase B: writing validated graph in topological order...");

  // Graph.topo returns a Walker; convert to Iterable<IngestNode> for forEach.
  // Sources (no incoming edges) come first; targets last. With our
  // dependency-direction edges (A → B = "A must be written before B"),
  // emission order is: Agent, Catalog, Dataset, then {Distribution,
  // CatalogRecord, DataService}.
  const topoOrder = Array.from(Graph.values(Graph.topo(graph)));

  yield* Effect.forEach(
    topoOrder,
    (node) => writeNode(config.rootDir, node),
    { concurrency: 1 } // sequential for stable git diff order
  );

  // Update ledger from the graph
  const ledger = { ...(yield* loadLedger(config.rootDir)) };
  yield* Effect.forEach(
    topoOrder,
    (node) => Effect.sync(() => { ledger[ledgerKeyForNode(node)] = node.data.id; }),
    { discard: true }
  );
  yield* saveLedger(config.rootDir, ledger);

  // Build and write the report + mermaid artifact
  const datasetNodes = topoOrder.filter((n): n is Extract<IngestNode, { _tag: "dataset" }> =>
    n._tag === "dataset"
  );
  const report: IngestReport = {
    fetchedAt: nowIso,
    routesWalked: walkData.size,
    nodeCount: Graph.nodeCount(graph),
    edgeCount: Graph.edgeCount(graph),
    datasets: {
      created: datasetNodes.filter((n) => !n.merged).map((n) => n.slug),
      merged: datasetNodes.filter((n) => n.merged).map((n) => n.slug)
    },
    distributions: { count: topoOrder.filter((n) => n._tag === "distribution").length },
    catalogRecords: { count: topoOrder.filter((n) => n._tag === "catalog-record").length },
    mermaidPath: "reports/harvest/eia-ingest-graph.mermaid",
    notes: [
      "Wikidata QID for EIA: Q1133499 (correct). Ticket SKY-254 listed Q466438 in error — that QID belongs to American President Lines and was not added.",
      "landingPage values for new datasets are intentionally omitted; existing hand-curated topic-page URLs (e.g. eia.gov/electricity/gridmonitor/) are preserved on merge.",
      "Legacy bulk-manifest codes (EBA, ELEC, ...) were migrated from `eia-route` to `eia-bulk-id` in Task 0.5 prior to this run."
    ]
  };

  const mermaid = Graph.toMermaid(graph, {
    nodeLabel: (node) => `${node._tag}: ${node.slug}`,
    edgeLabel: (edge) => edge,
    diagramType: "flowchart",
    direction: "LR"
  });
  yield* writeEntityFile(
    resolve(config.rootDir, "reports", "harvest", "eia-ingest-graph.mermaid"),
    mermaid + "\n"
  );
  yield* writeEntityFile(
    resolve(config.rootDir, "reports", "harvest", "eia-ingest-report.json"),
    encodeJsonString(report) + "\n"
  );

  yield* Effect.log(
    `Done. ${report.datasets.created.length} new + ${report.datasets.merged.length} merged datasets`
  );
});
```

**Step 2: Type-check.**

Run: `bunx tsc --noEmit`
Expected: clean.

**Step 3: Dry-run test (with `--dry-run` flag — Task 12 will add real CLI; for now just run main).**

Run: `bun scripts/cold-start-ingest-eia.ts`
Expected: Walks (or uses cache), creates ~80–150 dataset files, exits 0. Inspect a few outputs:

```bash
jq . references/cold-start/catalog/datasets/eia-electricity-retail-sales.json
jq . references/cold-start/reports/harvest/eia-ingest-report.json
```

**Step 4: Run idempotency check — run twice in a row, verify second run reports all merges and no creates, and `git diff` shows only `updatedAt` field changes.**

Run: `bun scripts/cold-start-ingest-eia.ts && bun scripts/cold-start-ingest-eia.ts`
Expected: second run's report shows `created: 0`. `git diff` on dataset files shows only `updatedAt` differing.

**Step 5: Commit.**

```bash
git add scripts/cold-start-ingest-eia.ts references/cold-start/
git commit -m "feat(sky-254): end-to-end EIA API v2 ingestion pipeline"
```

---

## Task 11: CLI flags

**Files:**
- Modify: `scripts/cold-start-ingest-eia.ts`

**Step 1: Replace `Runtime.makeRunMain`-only entry with `Command`/`Flag` CLI matching `build-stage1-eval-snapshot.ts:190+`.**

Flags:
- `--no-cache` (boolean, default false) — skip the walk cache and refetch
- `--dry-run` (boolean, default false) — validate everything but write nothing
- `--only-route <path>` (string, optional) — limit walk to a subtree; this mode bypasses the shared disk cache so a partial walk never overwrites the full-root snapshot
- `--root <path>` (string, default "references/cold-start") — override `COLD_START_ROOT`

**Step 2: Run with `--dry-run` to verify no writes.**

Run: `bun scripts/cold-start-ingest-eia.ts --dry-run`
Expected: Validation runs, log line `DRY RUN: would write N files`, no diff in `references/`.

**Step 3: Commit.**

```bash
git add scripts/cold-start-ingest-eia.ts
git commit -m "feat(sky-254): CLI flags (--no-cache, --dry-run, --only-route, --root)"
```

---

## Task 12: Tests for merge semantics + Effect lint pass

**Files:**
- Modify: `tests/cold-start-ingest-eia.test.ts`

**Step 1: Add the merge-semantics + graph test cases.**

Merge semantics:
- `merge preserves createdAt and bumps updatedAt`
- `merge unions aliases by (scheme, value)` — existing has `eia-route + eia-bulk-id`; fresh ingest adds the same `eia-route` (idempotent — should not duplicate); expect exactly 2 aliases.
- `merge preserves the existing dataset id`
- `merge preserves an existing landingPage and does NOT synthesize a new one`
- `walk cache respects TTL — stale cache returns null`
- `Phase A failure leaves the registry untouched` — feed a leaf whose response would produce an invalid Dataset (e.g. force `themes` to a non-array via mutation), run main, assert that no files under `<rootDir>/catalog/` were modified.
- `wikidata: agent merge does NOT add Q466438` — assert the validated Agent's aliases do not contain `Q466438`.

Graph structure:
- `IngestGraph is acyclic for any valid input`
- `topological order writes Agent before Dataset before Distribution` — call `Graph.topo`, capture indices for each `_tag`, assert `agent < dataset < distribution`.
- `every leaf route produces exactly one Dataset, one CatalogRecord, and ≥1 Distribution node`
- `mermaid output is non-empty and references the EIA agent slug`

**Step 2: Run full test file.**

Run: `bun run test tests/cold-start-ingest-eia.test.ts`
Expected: all green.

**Step 3: Effect lint pass.**

Run: `bunx tsc --noEmit`
Expected: clean. If any TS29/TS44 Effect Language Service warnings appear (per `feedback_effect_lint_errors.md`), fix them.

**Step 4: Final commit.**

```bash
git add tests/cold-start-ingest-eia.test.ts
git commit -m "test(sky-254): merge semantics and walk cache TTL"
```

---

## Task 13: Stage 1 eval re-run + delta report

**Files:**
- Create: `references/cold-start/reports/harvest/eia-ingest-eval-delta.md`

**Step 1: Capture baseline.**

Run: `bun eval/resolution-stage1/run-eval.ts`
Expected: writes `eval/resolution-stage1/snapshot.build-report.json`. Save a copy as `eval/resolution-stage1/snapshot.build-report.before-sky254.json`.

**Step 2: After Tasks 1-12 are merged, re-run.**

Run: `bun eval/resolution-stage1/run-eval.ts`

**Step 3: Diff the two reports** and write a short markdown summary documenting:
- Which gold-set entries moved buckets (cannot-resolve → partial → fully-resolved)
- Whether gold-02 (eia-retail-rates) is now fully resolved
- New variable links (probably zero — variables are out of scope here)
- Total leaves added vs total dataset rows in registry

**Step 4: Commit.**

```bash
git add references/cold-start/reports/harvest/eia-ingest-eval-delta.md
git commit -m "docs(sky-254): Stage 1 eval delta after EIA ingestion"
```

---

## Task 14: PR

**Step 1: Push branch and open PR.**

```bash
git push -u origin sky-254/eia-dcat-ingestion
gh pr create --title "feat: SKY-254 EIA DCAT ingestion (Workstream A first publisher)" --body "$(cat <<'EOF'
## Summary
- Effect-native ingestion script `scripts/cold-start-ingest-eia.ts` walks the EIA API v2 catalog tree and produces validated `Dataset`, `Distribution`, `CatalogRecord`, `DataService`, and `Agent` records under `references/cold-start/catalog/`.
- Every record is decoded through the Phase 0 domain schemas in `src/domain/data-layer/` in **Phase A**, before Phase B touches disk — a single validation failure aborts the run with the registry untouched.
- Schema prep: extends `aliasSchemes` with `eia-bulk-id` and migrates legacy bulk-manifest codes off `eia-route` so the API v2 surface can use the slot cleanly.
- Idempotent merge by `eia-route` (the only minted alias). Re-runs only update mutable fields and `updatedAt`. Existing hand-curated `landingPage` values are preserved.
- Per-host rate limiter + retry schedule cloned from `BlueskyClient` patterns.
- Walk cache at `references/cold-start/reports/harvest/eia-api-v2-walk.json` (30-day TTL).
- Wikidata: existing `Q1133499` (correct) preserved; the ticket's `Q466438` is American President Lines and is NOT added — discrepancy documented in build report.

## Test plan
- [x] `bun run test tests/cold-start-ingest-eia.test.ts`
- [x] `bunx tsc --noEmit`
- [x] Dry-run: `bun scripts/cold-start-ingest-eia.ts --dry-run`
- [x] Live run + idempotency check (run twice, second run = all merges, only `updatedAt` diffs)
- [x] Stage 1 eval re-run delta in `references/cold-start/reports/harvest/eia-ingest-eval-delta.md`

Closes SKY-254.
Refs SKY-251 (parent), SKY-252 (synthetic DCAT for non-DCAT publishers — separate ticket).
EOF
)"
```

---

## Done criteria (the SKY-254 acceptance checklist mapped to tasks)

- [ ] Schema prep: `eia-bulk-id` added to `aliasSchemes`, legacy `eia-route` bulk codes migrated — Tasks 0 + 0.5
- [ ] `scripts/cold-start-ingest-eia.ts` exists — Tasks 1-11
- [ ] Fetches EIA API v2 catalog endpoint — Tasks 2, 3, 5
- [ ] Mints IDs via `cold-start-id.ts` convention (ULID, prefixed) — Task 7, Task 9 ledger
- [ ] Writes to the 6 catalog subdirectories the script owns — Task 10
  - [ ] agents/ — Agent touch in Phase B (no Q466438 added)
  - [ ] catalogs/ — Catalog touch in Phase B (refresh `updatedAt` only)
  - [ ] datasets/ — Phase B writes (new + merged)
  - [ ] distributions/ — Phase B writes
  - [ ] data-services/ — Phase B writes (refresh `servesDatasetIds` union with all leaf Datasets)
  - [ ] catalog-records/ — Phase B writes EIA-catalog CRs only; CRs from other catalogs are read but never touched
  - [ ] dataset-series/ — explicitly out of scope (see Goal); files preserved as-is, no inSeries linking
- [ ] Schema validation runs as part of script (two-phase: Phase A validate-all → Phase B write-all) — Task 8 + Task 10
- [ ] Wikidata: existing Q1133499 preserved; Q466438 (incorrect) not added; discrepancy noted in build report — Task 10
- [ ] Re-runnable (no duplicates, only mutable fields update; ledger ENOENT distinct from other read errors) — Tasks 9 + 10
- [ ] Existing hand-curated `landingPage` values preserved on merge — Task 7
- [ ] Header documents endpoints used and skipped — top-of-file comment at end of Task 11
- [ ] Stage 1 eval re-run + delta report — Task 13
