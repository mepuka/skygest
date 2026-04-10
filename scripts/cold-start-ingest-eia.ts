/**
 * SKY-254 — EIA DCAT ingestion (Workstream A)
 *
 * Effect-native, schema-validated, idempotent ingestion of the EIA API v2
 * catalog tree into the cold-start registry under references/cold-start/.
 * The script walks api.eia.gov/v2/, builds an IngestGraph of typed nodes
 * (Agent | Catalog | DataService | Dataset | Distribution | CatalogRecord),
 * validates every candidate via Effect.partition, and emits files in
 * topological order so dependencies are written before dependents.
 *
 * See docs/plans/2026-04-10-sky-254-eia-dcat-ingestion.md for the full plan.
 */

import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import {
  Cache,
  Clock,
  Config,
  Duration,
  Effect,
  FileSystem,
  Graph,
  Layer,
  MutableHashMap,
  MutableRef,
  Option,
  Path,
  Redacted,
  Result,
  Schedule,
  Schema,
  Semaphore,
  SynchronizedRef
} from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientResponse
} from "effect/unstable/http";
import { ulid } from "ulid";
import {
  Agent,
  Catalog,
  CatalogRecord,
  DataService,
  Dataset,
  Distribution,
  type ExternalIdentifier
} from "../src/domain/data-layer";
import {
  decodeJsonStringEitherWith,
  decodeJsonStringWith,
  encodeJsonStringPrettyWith,
  formatSchemaParseError,
  stringifyUnknown
} from "../src/platform/Json";

// ---------------------------------------------------------------------------
// Tagged errors
// ---------------------------------------------------------------------------

export class EiaApiFetchError extends Schema.TaggedErrorClass<EiaApiFetchError>()(
  "EiaApiFetchError",
  {
    route: Schema.String,
    message: Schema.String,
    status: Schema.optionalKey(Schema.Number)
  }
) {}

export class EiaApiDecodeError extends Schema.TaggedErrorClass<EiaApiDecodeError>()(
  "EiaApiDecodeError",
  {
    route: Schema.String,
    message: Schema.String
  }
) {}

export class EiaIngestSchemaError extends Schema.TaggedErrorClass<EiaIngestSchemaError>()(
  "EiaIngestSchemaError",
  {
    kind: Schema.String,
    slug: Schema.String,
    message: Schema.String
  }
) {}

export class EiaIngestFsError extends Schema.TaggedErrorClass<EiaIngestFsError>()(
  "EiaIngestFsError",
  {
    operation: Schema.String,
    path: Schema.String,
    message: Schema.String
  }
) {}

export class EiaIngestLedgerError extends Schema.TaggedErrorClass<EiaIngestLedgerError>()(
  "EiaIngestLedgerError",
  { message: Schema.String }
) {}

// ---------------------------------------------------------------------------
// Script config
// ---------------------------------------------------------------------------

// dryRun / noCache default to false here; onlyRoute defaults to "no scope"
// (Option.none) by being absent. Task 11's CLI flags override these via
// a custom ConfigProvider so main can reference config.dryRun /
// config.noCache / config.onlyRoute uniformly across both env-driven and
// flag-driven invocations.
export const ScriptConfig = Config.all({
  apiKey: Config.redacted("EIA_API_KEY"),
  rootDir: Config.withDefault(
    Config.string("COLD_START_ROOT"),
    "references/cold-start"
  ),
  minIntervalMs: Config.withDefault(Config.int("EIA_MIN_INTERVAL_MS"), 250),
  maxRetries: Config.withDefault(Config.int("EIA_MAX_RETRIES"), 4),
  cacheTtlDays: Config.withDefault(Config.int("EIA_WALK_CACHE_TTL_DAYS"), 30),
  dryRun: Config.withDefault(Config.boolean("EIA_DRY_RUN"), false),
  noCache: Config.withDefault(Config.boolean("EIA_NO_CACHE"), false),
  onlyRoute: Config.option(Config.string("EIA_ONLY_ROUTE"))
});
export type ScriptConfigShape = Config.Success<typeof ScriptConfig>;

// ---------------------------------------------------------------------------
// EIA API v2 response schema
// ---------------------------------------------------------------------------

// EIA returns `null` (not an absent field) for missing strings, so optional
// string fields must accept `string | null | undefined`. Schema.NullOr +
// optionalKey gives us that shape; downstream code treats null and undefined
// equivalently via Option-style guards.
const NullableString = Schema.optionalKey(Schema.NullOr(Schema.String));

const EiaRouteRef = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: NullableString
});

const EiaFacetDef = Schema.Struct({
  id: Schema.String,
  description: NullableString
});

const EiaFrequencyDef = Schema.Struct({
  id: Schema.String,
  description: NullableString,
  format: NullableString
});

export const EiaApiResponse = Schema.Struct({
  response: Schema.Struct({
    id: Schema.String,
    name: NullableString,
    description: NullableString,
    routes: Schema.optionalKey(Schema.Array(EiaRouteRef)),
    facets: Schema.optionalKey(Schema.Array(EiaFacetDef)),
    frequency: Schema.optionalKey(Schema.Array(EiaFrequencyDef)),
    defaultFrequency: NullableString,
    startPeriod: NullableString,
    endPeriod: NullableString,
    data: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown))
  })
});
export type EiaApiResponse = Schema.Schema.Type<typeof EiaApiResponse>;

// ---------------------------------------------------------------------------
// fetchRoute — single-shot HTTP GET + schema decode
// ---------------------------------------------------------------------------

const EIA_API_BASE = "https://api.eia.gov/v2/";

const getResponseStatus = (cause: unknown): number | undefined => {
  if (typeof cause !== "object" || cause === null) return undefined;
  const maybe = cause as { readonly response?: { readonly status?: unknown } };
  if (
    maybe.response !== undefined &&
    typeof maybe.response.status === "number"
  ) {
    return maybe.response.status;
  }
  return undefined;
};

const isParseError = (cause: unknown): boolean => {
  if (typeof cause !== "object" || cause === null) return false;
  const tag = (cause as { readonly _tag?: unknown })._tag;
  return tag === "ParseError" || tag === "SchemaError";
};

export const fetchRoute = (route: string, apiKey: string) =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    const trimmed = route.replace(/^\/+|\/+$/gu, "");
    const url = `${EIA_API_BASE}${trimmed}${trimmed.length > 0 ? "/" : ""}`;
    return yield* http
      .get(url, { urlParams: { api_key: apiKey } })
      .pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap(HttpClientResponse.schemaBodyJson(EiaApiResponse)),
        Effect.mapError((cause) =>
          isParseError(cause)
            ? new EiaApiDecodeError({
                route,
                message: stringifyUnknown(cause)
              })
            : new EiaApiFetchError({
                route,
                message: stringifyUnknown(cause),
                ...(getResponseStatus(cause) !== undefined
                  ? { status: getResponseStatus(cause)! }
                  : {})
              })
        )
      );
  });

// ---------------------------------------------------------------------------
// Per-host rate limiter + retry (cloned from BlueskyClient.ts:170-232)
// ---------------------------------------------------------------------------

interface HostGate {
  readonly semaphore: Semaphore.Semaphore;
  readonly lastCompletedAt: SynchronizedRef.SynchronizedRef<number>;
}

const isRetryableEiaError = (
  error: EiaApiFetchError | EiaApiDecodeError
): boolean => {
  if (error._tag !== "EiaApiFetchError") return false;
  // Retry on transport failures (no status) and on 429 / 5xx.
  if (error.status === undefined) return true;
  return error.status === 429 || (error.status >= 500 && error.status < 600);
};

export const makeRateLimitedFetcher = (
  minIntervalMs: number,
  maxRetries: number
) =>
  Effect.gen(function* () {
    const hostGates = yield* Cache.make({
      capacity: 8,
      timeToLive: Duration.infinity,
      lookup: (_host: string) =>
        Effect.all([
          Semaphore.make(1),
          SynchronizedRef.make(-minIntervalMs)
        ]).pipe(
          Effect.map(
            ([semaphore, lastCompletedAt]) =>
              ({
                semaphore,
                lastCompletedAt
              }) satisfies HostGate
          )
        )
    });

    const retrySchedule = Schedule.exponential(Duration.millis(500)).pipe(
      Schedule.jittered,
      Schedule.both(Schedule.recurs(maxRetries))
    );

    return (route: string, apiKey: string) =>
      Effect.gen(function* () {
        const gate = yield* Cache.get(hostGates, "api.eia.gov");
        return yield* gate.semaphore
          .withPermits(1)(
            Effect.gen(function* () {
              const now = yield* Clock.currentTimeMillis;
              const last = yield* SynchronizedRef.get(gate.lastCompletedAt);
              const waitMs = Math.max(0, minIntervalMs - (now - last));
              if (waitMs > 0) {
                yield* Effect.sleep(Duration.millis(waitMs));
              }
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
          )
          .pipe(
            Effect.retry({
              schedule: retrySchedule,
              while: isRetryableEiaError
            })
          );
      });
  });

// ---------------------------------------------------------------------------
// Walk cache schema + lazy whileLoop walk
// ---------------------------------------------------------------------------

const WalkCache = Schema.Struct({
  fetchedAt: Schema.String,
  routes: Schema.Record(Schema.String, EiaApiResponse)
});
type WalkCache = Schema.Schema.Type<typeof WalkCache>;

const decodeWalkCache = decodeJsonStringWith(WalkCache);
const encodeWalkCache = encodeJsonStringPrettyWith(WalkCache);

/**
 * Lazy walk of the EIA API v2 route tree. Uses Effect.whileLoop over a
 * MutableRef-backed queue so the body stays Effect-typed (no `for ... of`,
 * no raw `while`). The `fetch` parameter is parameterized so tests can
 * stub it without spinning up the full rate-limited fetcher.
 *
 * Returns a MutableHashMap<route, EiaApiResponse>; iterating it inside an
 * Effect.sync block produces a snapshot suitable for caching to disk.
 */
export const walkRoutes = <R>(
  fetch: (
    route: string
  ) => Effect.Effect<EiaApiResponse, EiaApiFetchError | EiaApiDecodeError, R>,
  startRoute = ""
) =>
  Effect.gen(function* () {
    const queue = MutableRef.make<ReadonlyArray<string>>([startRoute]);
    const seen = MutableHashMap.empty<string, true>();
    const results = MutableHashMap.empty<string, EiaApiResponse>();

    yield* Effect.whileLoop({
      while: () => MutableRef.get(queue).length > 0,
      body: () =>
        Effect.gen(function* () {
          const current = MutableRef.get(queue);
          const next = current[0]!;
          MutableRef.set(queue, current.slice(1));

          if (MutableHashMap.has(seen, next)) return;
          MutableHashMap.set(seen, next, true);

          const resp = yield* fetch(next);
          MutableHashMap.set(results, next, resp);

          const childRoutes = resp.response.routes ?? [];
          const childPaths = childRoutes.map((c) =>
            next === "" ? c.id : `${next}/${c.id}`
          );
          if (childPaths.length > 0) {
            MutableRef.set(queue, [...MutableRef.get(queue), ...childPaths]);
          }
        }),
      step: () => {}
    });

    return results;
  });

const walkCacheRelativePath = "reports/harvest/eia-api-v2-walk.json";

const readWalkCache = (rootDir: string, ttlDays: number) =>
  Effect.gen(function* () {
    const fs_ = yield* FileSystem.FileSystem;
    const path_ = yield* Path.Path;
    const cachePath = path_.resolve(rootDir, walkCacheRelativePath);

    const exists = yield* Effect.exit(fs_.access(cachePath));
    if (exists._tag === "Failure") return null;

    const text = yield* fs_.readFileString(cachePath).pipe(
      Effect.mapError(
        (cause) =>
          new EiaIngestFsError({
            operation: "readFileString",
            path: cachePath,
            message: stringifyUnknown(cause)
          })
      )
    );

    const decoded = yield* Effect.try({
      try: () => decodeWalkCache(text),
      catch: (cause) =>
        new EiaIngestFsError({
          operation: "decode-walk-cache",
          path: cachePath,
          message: stringifyUnknown(cause)
        })
    });

    const ageMs = Date.now() - new Date(decoded.fetchedAt).getTime();
    if (ageMs > ttlDays * 86_400_000) {
      yield* Effect.log(
        `Walk cache at ${cachePath} is older than ${String(ttlDays)} days; ignoring.`
      );
      return null;
    }
    return decoded;
  });

const writeWalkCache = (rootDir: string, cache: WalkCache) =>
  Effect.gen(function* () {
    const fs_ = yield* FileSystem.FileSystem;
    const path_ = yield* Path.Path;
    const cachePath = path_.resolve(rootDir, walkCacheRelativePath);
    const cacheDir = path_.dirname(cachePath);

    yield* fs_.makeDirectory(cacheDir, { recursive: true }).pipe(
      Effect.mapError(
        (cause) =>
          new EiaIngestFsError({
            operation: "makeDirectory",
            path: cacheDir,
            message: stringifyUnknown(cause)
          })
      )
    );

    yield* fs_.writeFileString(cachePath, `${encodeWalkCache(cache)}\n`).pipe(
      Effect.mapError(
        (cause) =>
          new EiaIngestFsError({
            operation: "writeFileString",
            path: cachePath,
            message: stringifyUnknown(cause)
          })
      )
    );
  });

/**
 * Returns the walk data as a `Map<route, EiaApiResponse>`, drawn from the
 * 30-day disk cache when available. `--no-cache` and `--only-route` both
 * bypass the shared cache so a partial walk never overwrites the full-tree
 * snapshot.
 */
export const getWalkData = (config: ScriptConfigShape, apiKey: string) =>
  Effect.gen(function* () {
    const startRoute = Option.getOrElse(config.onlyRoute, () => "");
    const scoped = startRoute !== "";

    if (!config.noCache && !scoped) {
      const cached = yield* readWalkCache(config.rootDir, config.cacheTtlDays);
      if (cached !== null) {
        yield* Effect.log(`Using cached walk from ${cached.fetchedAt}`);
        return new Map(Object.entries(cached.routes));
      }
    } else if (config.noCache) {
      yield* Effect.log("Skipping walk cache because --no-cache was set");
    } else {
      yield* Effect.log(
        `Scoped walk for ${startRoute}; shared walk cache disabled`
      );
    }

    yield* Effect.log(
      scoped
        ? `Walking EIA API v2 fresh from subtree ${startRoute}...`
        : "Walking EIA API v2 fresh..."
    );
    const fetcher = yield* makeRateLimitedFetcher(
      config.minIntervalMs,
      config.maxRetries
    );
    const results = yield* walkRoutes(
      (route) => fetcher(route, apiKey),
      startRoute
    );

    // MutableHashMap is Iterable<[K, V]> — see effect/src/MutableHashMap.ts:69.
    // Snapshot to a plain Record for cache persistence.
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
    yield* Effect.log(`Walked ${String(Object.keys(snapshot).length)} routes`);
    return new Map(Object.entries(snapshot));
  });

// ---------------------------------------------------------------------------
// IngestGraph — typed Graph.DirectedGraph<IngestNode, IngestEdge>
// ---------------------------------------------------------------------------
//
// Edge-direction rule (Effect's Graph.topo is Kahn's algorithm; verified at
// .reference/effect/packages/effect/src/Graph.ts:3878-3917): edges encode
// dependencies — `A → B` means *A must be emitted before B*. For our
// pipeline:
//
//   agent → catalog          (Catalog.publisherAgentId → Agent.id)
//   agent → dataset          (Dataset.publisherAgentId → Agent.id)
//   agent → data-service     (DataService.publisherAgentId → Agent.id)
//   catalog → catalog-record (CatalogRecord.catalogId → Catalog.id)
//   dataset → distribution   (Distribution.datasetId → Dataset.id)
//   dataset → catalog-record (CatalogRecord.primaryTopicId → Dataset.id)
//   dataset → data-service   (DataService.servesDatasetIds[] → Dataset.id)
//
// Topological emission: Agent → {Catalog, Dataset} → {Distribution,
// CatalogRecord, DataService}.

export type IngestNode =
  | { readonly _tag: "agent"; readonly slug: string; readonly data: Agent }
  | { readonly _tag: "catalog"; readonly slug: string; readonly data: Catalog }
  | {
      readonly _tag: "data-service";
      readonly slug: string;
      readonly data: DataService;
    }
  | {
      readonly _tag: "dataset";
      readonly slug: string;
      readonly data: Dataset;
      readonly merged: boolean;
    }
  | {
      readonly _tag: "distribution";
      readonly slug: string;
      readonly data: Distribution;
    }
  | {
      readonly _tag: "catalog-record";
      readonly slug: string;
      readonly data: CatalogRecord;
    };

export type IngestEdge =
  | "publishes" //          agent → {catalog, dataset, data-service}
  | "contains-record" //    catalog → catalog-record
  | "has-distribution" //   dataset → distribution
  | "primary-topic-of" //   dataset → catalog-record
  | "served-by"; //         dataset → data-service

export type IngestGraph = Graph.DirectedGraph<IngestNode, IngestEdge>;

const nodeKey = (node: IngestNode): string => `${node._tag}::${node.data.id}`;

/**
 * Pure builder. Takes an array of *already-validated* IngestNodes (Phase A
 * has run) and assembles the dependency-direction graph. The mutate
 * callback is the only place plain JS `for` loops are permitted — it is
 * synchronous and not Effect-typed by design (matches the canonical pattern
 * in skygest-editorial/src/narrative/BuildGraph.ts:950-1018).
 */
export const buildIngestGraph = (
  validatedNodes: ReadonlyArray<IngestNode>
): IngestGraph =>
  Graph.directed<IngestNode, IngestEdge>((mutable) => {
    const indexById = new Map<string, number>();

    // Pass 1: add every node, recording its assigned index by composite key.
    for (const node of validatedNodes) {
      indexById.set(nodeKey(node), Graph.addNode(mutable, node));
    }

    // Partition nodes by tag for the edge-wiring passes below.
    const agentNodes: Array<Extract<IngestNode, { _tag: "agent" }>> = [];
    const catalogNodes: Array<Extract<IngestNode, { _tag: "catalog" }>> = [];
    const dataServiceNodes: Array<
      Extract<IngestNode, { _tag: "data-service" }>
    > = [];
    const datasetNodes: Array<Extract<IngestNode, { _tag: "dataset" }>> = [];
    const distNodes: Array<Extract<IngestNode, { _tag: "distribution" }>> = [];
    const crNodes: Array<Extract<IngestNode, { _tag: "catalog-record" }>> = [];

    for (const node of validatedNodes) {
      switch (node._tag) {
        case "agent":
          agentNodes.push(node);
          break;
        case "catalog":
          catalogNodes.push(node);
          break;
        case "data-service":
          dataServiceNodes.push(node);
          break;
        case "dataset":
          datasetNodes.push(node);
          break;
        case "distribution":
          distNodes.push(node);
          break;
        case "catalog-record":
          crNodes.push(node);
          break;
      }
    }

    // Pass 2: agent → {catalog, dataset, data-service} via "publishes"
    for (const agent of agentNodes) {
      const agentIdx = indexById.get(nodeKey(agent))!;
      for (const catalog of catalogNodes) {
        if (catalog.data.publisherAgentId === agent.data.id) {
          Graph.addEdge(
            mutable,
            agentIdx,
            indexById.get(nodeKey(catalog))!,
            "publishes"
          );
        }
      }
      for (const ds of datasetNodes) {
        if (ds.data.publisherAgentId === agent.data.id) {
          Graph.addEdge(
            mutable,
            agentIdx,
            indexById.get(nodeKey(ds))!,
            "publishes"
          );
        }
      }
      for (const svc of dataServiceNodes) {
        if (svc.data.publisherAgentId === agent.data.id) {
          Graph.addEdge(
            mutable,
            agentIdx,
            indexById.get(nodeKey(svc))!,
            "publishes"
          );
        }
      }
    }

    // Pass 3: catalog → catalog-record via "contains-record"
    for (const catalog of catalogNodes) {
      const catIdx = indexById.get(nodeKey(catalog))!;
      for (const cr of crNodes) {
        if (cr.data.catalogId === catalog.data.id) {
          Graph.addEdge(
            mutable,
            catIdx,
            indexById.get(nodeKey(cr))!,
            "contains-record"
          );
        }
      }
    }

    // Pass 4: dataset → {distribution, catalog-record, data-service}
    for (const ds of datasetNodes) {
      const dsIdx = indexById.get(nodeKey(ds))!;
      for (const dist of distNodes) {
        if (dist.data.datasetId === ds.data.id) {
          Graph.addEdge(
            mutable,
            dsIdx,
            indexById.get(nodeKey(dist))!,
            "has-distribution"
          );
        }
      }
      for (const cr of crNodes) {
        if (cr.data.primaryTopicId === ds.data.id) {
          Graph.addEdge(
            mutable,
            dsIdx,
            indexById.get(nodeKey(cr))!,
            "primary-topic-of"
          );
        }
      }
      for (const svc of dataServiceNodes) {
        if (svc.data.servesDatasetIds.includes(ds.data.id)) {
          Graph.addEdge(
            mutable,
            dsIdx,
            indexById.get(nodeKey(svc))!,
            "served-by"
          );
        }
      }
    }
  });

// ---------------------------------------------------------------------------
// Existing-entity catalog index (Task 6)
// ---------------------------------------------------------------------------
//
// Walks `<rootDir>/catalog/{datasets,distributions,catalog-records,
// data-services,catalogs,agents}/` once at ingest start, decodes each JSON
// file through the matching domain Schema, and builds lookup maps keyed
// by alias scheme (not internal ID) so Task 7's candidate builders can
// merge against existing entries deterministically.
//
// Merge keys:
//   Dataset            → eia-route alias with a "/" in the value. Legacy
//                        bulk-manifest codes live on eia-bulk-id and are
//                        intentionally invisible to this index (Task 0.5
//                        migrated them off eia-route).
//   Distribution       → `${dist.datasetId}::${dist.kind}` (the script
//                        always writes one api-access + one landing-page
//                        per dataset, so this compound key is total).
//   CatalogRecord      → `${cr.catalogId}::${cr.primaryTopicId}`. Multiple
//                        catalogs (EIA, Data.gov) can publish CRs for the
//                        same dataset; only CRs from the EIA catalog are
//                        ever merged downstream. Compound key ensures the
//                        Data.gov duplicate CR is read-only.
//   Agent (general)    → name (lookup table for any agent that needs it).
//   Agent (EIA)        → URL-alias lookup (`{scheme: "url", value:
//                        EIA_AGENT_HOMEPAGE}`) with a `homepage`-field
//                        fallback. The dedicated `catalog`/`dataService`
//                        fields are filtered by this resolved EIA agent's
//                        publisherAgentId.

export interface CatalogIndex {
  readonly datasetsByRoute: Map<string, Dataset>;
  readonly distributionsByDatasetIdKind: Map<string, Distribution>;
  readonly catalogRecordsByCatalogAndPrimaryTopic: Map<string, CatalogRecord>;
  readonly agentsByName: Map<string, Agent>;
  readonly catalog: Catalog | null;
  readonly dataService: DataService | null;
  readonly allDatasets: ReadonlyArray<Dataset>;
  readonly allDistributions: ReadonlyArray<Distribution>;
  readonly allCatalogRecords: ReadonlyArray<CatalogRecord>;
}

const EIA_AGENT_HOMEPAGE = "https://www.eia.gov/";

/**
 * Concurrency cap for filesystem reads during catalog-index loading.
 * Matches the `FILESYSTEM_CONCURRENCY = 10` convention used elsewhere in
 * the codebase (see skygest-editorial's BuildGraph.ts); keeps parallel
 * `readFileString` calls bounded so we don't saturate the fd table on
 * large cold-start registries.
 */
const INDEX_LOAD_CONCURRENCY = 10;

/** API v2 route paths always contain at least one "/". Legacy bulk-manifest
 *  codes (EBA, ELEC, NG, ...) live on the `eia-bulk-id` scheme post-Task 0.5
 *  but this guard is the second line of defence. */
const isApiV2RouteValue = (value: string): boolean => value.includes("/");

const decodeFileAs = <S extends Schema.Decoder<unknown>>(
  schema: S,
  kind: string,
  slug: string
) =>
  (text: string): Effect.Effect<S["Type"], EiaIngestSchemaError> =>
    Effect.gen(function* () {
      const result = decodeJsonStringEitherWith(schema)(text);
      if (Result.isFailure(result)) {
        return yield* new EiaIngestSchemaError({
          kind,
          slug,
          message: formatSchemaParseError(result.failure)
        });
      }
      return result.success;
    });

const loadEntitiesFromDir = <S extends Schema.Decoder<unknown>>(
  fs_: FileSystem.FileSystem,
  rootDir: string,
  subDir: string,
  schema: S,
  kind: string
): Effect.Effect<
  ReadonlyArray<S["Type"]>,
  EiaIngestFsError | EiaIngestSchemaError,
  Path.Path
> =>
  Effect.gen(function* () {
    const path_ = yield* Path.Path;
    const dir = path_.resolve(rootDir, "catalog", subDir);

    const files = yield* fs_.readDirectory(dir).pipe(
      Effect.mapError(
        (cause) =>
          new EiaIngestFsError({
            operation: "readDirectory",
            path: dir,
            message: stringifyUnknown(cause)
          })
      ),
      Effect.map((entries) => entries.filter((f) => f.endsWith(".json")))
    );

    return yield* Effect.forEach(
      files,
      (file) =>
        Effect.gen(function* () {
          const slug = file.replace(/\.json$/u, "");
          const filePath = path_.resolve(dir, file);
          const text = yield* fs_.readFileString(filePath).pipe(
            Effect.mapError(
              (cause) =>
                new EiaIngestFsError({
                  operation: "readFileString",
                  path: filePath,
                  message: stringifyUnknown(cause)
                })
            )
          );
          return yield* decodeFileAs(schema, kind, slug)(text);
        }),
      { concurrency: INDEX_LOAD_CONCURRENCY }
    );
  });

/**
 * Loads the on-disk cold-start catalog into alias-keyed lookup maps.
 * Every one of the six subdirectories must exist — missing directories
 * surface as `EiaIngestFsError { operation: "readDirectory" }` rather
 * than silently producing an empty index, which would let a stale run
 * mis-report "no existing Datasets" and duplicate-create everything.
 */
export const loadCatalogIndex = (
  rootDir: string
): Effect.Effect<
  CatalogIndex,
  EiaIngestFsError | EiaIngestSchemaError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fs_ = yield* FileSystem.FileSystem;

    const [
      datasets,
      distributions,
      catalogRecords,
      dataServices,
      catalogs,
      agents
    ] = yield* Effect.all(
      [
        loadEntitiesFromDir(fs_, rootDir, "datasets", Dataset, "Dataset"),
        loadEntitiesFromDir(
          fs_,
          rootDir,
          "distributions",
          Distribution,
          "Distribution"
        ),
        loadEntitiesFromDir(
          fs_,
          rootDir,
          "catalog-records",
          CatalogRecord,
          "CatalogRecord"
        ),
        loadEntitiesFromDir(
          fs_,
          rootDir,
          "data-services",
          DataService,
          "DataService"
        ),
        loadEntitiesFromDir(fs_, rootDir, "catalogs", Catalog, "Catalog"),
        loadEntitiesFromDir(fs_, rootDir, "agents", Agent, "Agent")
      ],
      { concurrency: "unbounded" }
    );

    // Pure synchronous index-building over already-fetched data. `for ... of`
    // is permitted inside `Effect.sync` (matches the Graph.directed mutate
    // callback pattern used in buildIngestGraph above).
    return yield* Effect.sync(() => {
      const datasetsByRoute = new Map<string, Dataset>();
      const distributionsByDatasetIdKind = new Map<string, Distribution>();
      const agentsByName = new Map<string, Agent>();
      const catalogRecordsByCatalogAndPrimaryTopic = new Map<
        string,
        CatalogRecord
      >();

      for (const ds of datasets) {
        // Only entries that look like API v2 paths are indexed — legacy
        // bulk-manifest codes live on eia-bulk-id (Task 0.5) and are
        // intentionally invisible here.
        const route = ds.aliases.find(
          (a) => a.scheme === "eia-route" && isApiV2RouteValue(a.value)
        )?.value;
        if (route !== undefined) datasetsByRoute.set(route, ds);
      }

      for (const dist of distributions) {
        distributionsByDatasetIdKind.set(
          `${dist.datasetId}::${dist.kind}`,
          dist
        );
      }

      for (const ag of agents) {
        agentsByName.set(ag.name, ag);
      }

      for (const cr of catalogRecords) {
        catalogRecordsByCatalogAndPrimaryTopic.set(
          `${cr.catalogId}::${cr.primaryTopicId}`,
          cr
        );
      }

      // EIA publisher agent: matched by homepage URL alias or homepage
      // field (either carries https://www.eia.gov/ in the registry today).
      const eiaAgent =
        agents.find((a) =>
          a.aliases.some(
            (al) => al.scheme === "url" && al.value === EIA_AGENT_HOMEPAGE
          )
        ) ?? agents.find((a) => a.homepage === EIA_AGENT_HOMEPAGE) ?? null;

      const catalog =
        eiaAgent !== null
          ? (catalogs.find((c) => c.publisherAgentId === eiaAgent.id) ?? null)
          : null;
      const dataService =
        eiaAgent !== null
          ? (dataServices.find((s) => s.publisherAgentId === eiaAgent.id) ??
            null)
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
      } satisfies CatalogIndex;
    });
  });

// ---------------------------------------------------------------------------
// Task 7 — Pure record builders
// ---------------------------------------------------------------------------
//
// These are pure synchronous transformations from EIA API v2 walk data +
// the already-loaded catalog index into unvalidated candidate records
// ready for Phase A validation in Task 8. Validation happens later; the
// builders intentionally cast their return values through `unknown` to the
// branded Dataset/Distribution/CatalogRecord types. Every cast is narrow
// and load-bearing — the branded URI + alias shapes are structurally
// correct, and Task 8's Schema.decodeUnknownEffect call will do the real
// brand enforcement.
//
// Merge contract (see Task 7 spec for the full rationale):
//   - title:              always overwrite (API v2 is canonical)
//   - description:        preserve existing (API v2 descriptions are terse)
//   - publisherAgentId:   always overwrite (structural)
//   - dataServiceIds:     always overwrite (structural)
//   - landingPage:        preserve existing; never synthesize
//   - accessRights:       preserve existing
//   - license:            preserve existing; default to EIA copyright page
//   - temporal:           preserve existing (API v2 dates are coarser)
//   - keywords:           UNION(existing, facet ids, defaultFrequency)
//   - themes:             preserve existing if non-empty, else parents
//   - inSeries:           preserve existing (curated link)
//   - aliases:            union by (scheme, value); only ever mint eia-route
//   - distributionIds:    re-stitched after distributions are minted
//
// Distribution merge contract:
//   - api-access is always present: mint or merge. Preserve existing
//     accessURL, format, mediaType, title, createdAt.
//   - landing-page / download / archive / documentation distributions
//     are never synthesized here — they are hand-curated. If an existing
//     distribution of one of those kinds is already linked to the
//     dataset, preserve it unchanged in the result set.

interface LeafRoute {
  readonly path: string;
  readonly parents: ReadonlyArray<string>;
  readonly response: EiaApiResponse["response"];
}

export interface BuildContext {
  readonly nowIso: string;
  readonly eiaAgent: Agent;
  readonly eiaCatalog: Catalog;
  readonly eiaDataService: DataService;
}

// EIA's public reuse policy URL. Applied as a default license for minted
// candidates when the existing record doesn't carry one.
const EIA_LICENSE_URL = "https://www.eia.gov/about/copyrights_reuse.php";

/** Turn an API v2 route path into a dataset slug ("electricity/retail-sales"
 *  → "eia-electricity-retail-sales"). Used for filenames and node slugs. */
export const slugifyRoute = (route: string): string =>
  `eia-${route.replace(/\//gu, "-")}`;

/**
 * Factory for the Skygest entity id URI shape. Keeping the shape in one
 * place means there's only one place to update if we ever switch ULID
 * libraries or change the id host/prefix convention.
 */
const mintEntityId = (entityKind: string, prefix: string): string =>
  `https://id.skygest.io/${entityKind}/${prefix}_${ulid()}`;

const datasetIdFromUlid = (): string => mintEntityId("dataset", "ds");
const distIdFromUlid = (): string => mintEntityId("distribution", "dist");
const crIdFromUlid = (): string => mintEntityId("catalog-record", "cr");

/**
 * Copy the listed optional keys from `source` to `target` when the value
 * is set (not `undefined`). Deduplicates the repetitive
 * `if (existing?.X !== undefined) base.X = existing.X;` pattern in the
 * candidate builders below.
 *
 * Only for the pure-preservation case ("if existing, take it; else
 * don't include"). Fields with custom merge logic (e.g. `themes`,
 * `keywords`) must not use this helper.
 *
 * The `for ... of` is permitted here because this is a non-Effect-typed
 * pure synchronous function over a small known-length array.
 */
const preserveOptionalKeys = <T extends object, K extends keyof T>(
  target: Record<string, unknown>,
  source: T | null | undefined,
  keys: ReadonlyArray<K>
): void => {
  if (source === null || source === undefined) return;
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined) {
      target[key as string] = value;
    }
  }
};

/**
 * Union two alias arrays, deduping by `(scheme, value)`. Existing
 * aliases win on collision — this preserves any curator-applied
 * relation weakening (e.g. exactMatch downgraded to closeMatch when
 * a methodology variant was discovered) and any `uri` field set on
 * the existing alias against being overwritten by a fresh import.
 */
export const unionAliases = (
  existing: ReadonlyArray<ExternalIdentifier>,
  fresh: ReadonlyArray<ExternalIdentifier>
): ReadonlyArray<ExternalIdentifier> => {
  const seen = new Set<string>();
  const out: Array<ExternalIdentifier> = [];
  // Existing aliases first so a later fresh duplicate is silently dropped.
  for (const alias of existing) {
    const key = `${alias.scheme}::${alias.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(alias);
  }
  for (const alias of fresh) {
    const key = `${alias.scheme}::${alias.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(alias);
  }
  return out;
};

/**
 * Resolve the EIA agent/catalog/dataService triple from a loaded catalog
 * index. Fails loudly when any piece is missing — the ingest pipeline has
 * no sensible way to mint candidates without all three scope records.
 */
export const buildContextFromIndex = (
  idx: CatalogIndex,
  nowIso: string
): Effect.Effect<BuildContext, EiaIngestLedgerError> =>
  Effect.gen(function* () {
    if (idx.catalog === null || idx.dataService === null) {
      return yield* new EiaIngestLedgerError({
        message:
          "EIA Catalog or DataService missing from cold-start registry — run Task 6 loader against a seeded tree"
      });
    }
    // The EIA catalog/dataService are already filtered to the EIA agent's
    // publisherAgentId during index load, so we can resolve the agent by
    // that id without re-running the homepage-alias lookup.
    //
    // Locate the EIA agent by id, walking agentsByName because the index
    // only exposes that map. There's a latent name-collision edge case in
    // loadCatalogIndex (Task 6) — if two agents share a name, only the
    // last-loaded one is findable through agentsByName. The cold-start
    // registry has unique agent names today, so this is safe; if that
    // invariant breaks, loadCatalogIndex should expose agentsById too.
    const catalogPublisherId = idx.catalog.publisherAgentId;
    const eiaAgent =
      Array.from(idx.agentsByName.values()).find(
        (a) => a.id === catalogPublisherId
      ) ?? null;
    if (eiaAgent === null) {
      return yield* new EiaIngestLedgerError({
        message:
          "EIA Agent missing from registry — catalog.publisherAgentId did not resolve to any loaded agent"
      });
    }
    return {
      nowIso,
      eiaAgent,
      eiaCatalog: idx.catalog,
      eiaDataService: idx.dataService
    } satisfies BuildContext;
  });

/**
 * Build a Dataset candidate from an EIA leaf-route response. Pure. When
 * `existing` is non-null, merges according to the Task 7 contract above.
 * The returned object is cast through `unknown` because branded IDs and
 * alias literals are validated later in Task 8.
 */
export const buildDatasetCandidate = (
  leaf: LeafRoute,
  ctx: BuildContext,
  existing: Dataset | null
): Dataset => {
  const id = existing?.id ?? (datasetIdFromUlid() as Dataset["id"]);
  const createdAt = existing?.createdAt ?? (ctx.nowIso as Dataset["createdAt"]);
  const updatedAt = ctx.nowIso as Dataset["updatedAt"];

  // The only alias ingestion ever mints is the API v2 route. Every other
  // scheme (eia-bulk-id, eia-series, ror, wikidata, doi, ...) is
  // hand-curated and preserved through unionAliases.
  const freshAliases: ReadonlyArray<ExternalIdentifier> = [
    {
      scheme: "eia-route",
      value: leaf.path,
      relation: "exactMatch"
    } as ExternalIdentifier
  ];
  const aliases = unionAliases(existing?.aliases ?? [], freshAliases);

  // Keywords: UNION(existing, facet ids, defaultFrequency), sorted for
  // deterministic on-disk ordering (matters when Task 9 serializes the
  // merged record — stable sort means stable file diffs). defaultFrequency
  // belongs in keywords per the spec, not in aliases.
  const facetIds = (leaf.response.facets ?? []).map((f) => f.id);
  const freqKw =
    leaf.response.defaultFrequency != null ? [leaf.response.defaultFrequency] : [];
  const mergedKeywords = Array.from(
    new Set<string>([...(existing?.keywords ?? []), ...facetIds, ...freqKw])
  ).sort();

  // Themes: preserve curated list if non-empty, else fall back to the
  // parent route segments (the structural derivation).
  const mergedThemes =
    existing?.themes !== undefined && existing.themes.length > 0
      ? existing.themes
      : leaf.parents;

  // Title: prefer API v2 (canonical), but fall back to existing curated
  // title when the API returns `name === null`. Only use the raw route id
  // as a last resort — otherwise a merge would overwrite a curated title
  // like "Retail Sales of Electricity" with the raw slug "retail-sales".
  const title = leaf.response.name ?? existing?.title ?? leaf.response.id;

  const base: Record<string, unknown> = {
    _tag: "Dataset",
    id,
    title,
    publisherAgentId: ctx.eiaAgent.id,
    accessRights: existing?.accessRights ?? "public",
    license: existing?.license ?? EIA_LICENSE_URL,
    keywords: mergedKeywords,
    themes: mergedThemes,
    aliases,
    createdAt,
    updatedAt,
    dataServiceIds: [ctx.eiaDataService.id],
    distributionIds: [] // re-stitched after distribution candidates are built
  };

  // description has a fresh-value fallback (API description) when no
  // existing record exists, so it can't use preserveOptionalKeys directly.
  const description =
    existing?.description ?? leaf.response.description ?? undefined;
  if (description !== undefined) base.description = description;

  // Pure-preservation fields: keep existing value if set, otherwise leave
  // the key off entirely. No fresh-value merge logic, so the helper
  // applies cleanly.
  preserveOptionalKeys(base, existing, ["landingPage", "inSeries"] as const);

  // Temporal: preserve curated value; only synthesize from start/end
  // period when neither existing record nor API response has it.
  const mergedTemporal =
    existing?.temporal ??
    (leaf.response.startPeriod != null && leaf.response.endPeriod != null
      ? `${leaf.response.startPeriod}/${leaf.response.endPeriod}`
      : undefined);
  if (mergedTemporal !== undefined) base.temporal = mergedTemporal;

  return base as unknown as Dataset;
};

/**
 * Build Distribution candidates for a leaf. Always produces (at minimum)
 * an `api-access` distribution whose accessURL is the EIA v2 URL for the
 * leaf. Preserves every other hand-curated distribution attached to the
 * same dataset (landing-page, download, archive, documentation, ...).
 */
export const buildDistributionCandidates = (
  leaf: LeafRoute,
  datasetId: Dataset["id"],
  ctx: BuildContext,
  idx: CatalogIndex
): ReadonlyArray<Distribution> => {
  const apiAccessUrl = `${EIA_API_BASE}${leaf.path}/`;
  const existingApi = idx.distributionsByDatasetIdKind.get(
    `${datasetId}::api-access`
  );

  // Build the api-access distribution. Preserve every curated field when
  // merging; only bump `updatedAt`. accessURL is preserved if already set.
  const apiBase: Record<string, unknown> = {
    _tag: "Distribution",
    id: existingApi?.id ?? (distIdFromUlid() as Distribution["id"]),
    datasetId,
    kind: "api-access",
    accessURL: existingApi?.accessURL ?? apiAccessUrl,
    aliases: existingApi?.aliases ?? [],
    createdAt:
      existingApi?.createdAt ?? (ctx.nowIso as Distribution["createdAt"]),
    updatedAt: ctx.nowIso as Distribution["updatedAt"]
  };
  // Pure-preservation pass over every optional Distribution key. If a
  // new optional field is added to the Distribution schema and should be
  // preserved, add it here — do NOT drop any key without confirming it
  // has a different merge rule.
  preserveOptionalKeys(apiBase, existingApi, [
    "title",
    "description",
    "format",
    "mediaType",
    "downloadURL",
    "byteSize",
    "checksum",
    "accessRights",
    "license",
    "accessServiceId"
  ] as const);

  const apiAccess = apiBase as unknown as Distribution;

  // Preserve all non-api-access distributions for the same dataset. These
  // are hand-curated (landing-page, download, archive, documentation);
  // ingestion never synthesizes them.
  const preserved = idx.allDistributions.filter(
    (d) => d.datasetId === datasetId && d.kind !== "api-access"
  );

  return [apiAccess, ...preserved];
};

/**
 * Build a CatalogRecord candidate for a dataset. CatalogRecord has no
 * `aliases`/`createdAt`/`updatedAt` — it carries `firstSeen`/`lastSeen`
 * catalog-tracking dates instead. Preserves existing firstSeen /
 * sourceRecordId / harvestedFrom / isAuthoritative / duplicateOf.
 */
export const buildCatalogRecord = (
  dataset: Dataset,
  ctx: BuildContext,
  existing: CatalogRecord | null,
  leafPath: string
): CatalogRecord => {
  const base: Record<string, unknown> = {
    _tag: "CatalogRecord",
    id: existing?.id ?? (crIdFromUlid() as CatalogRecord["id"]),
    catalogId: ctx.eiaCatalog.id,
    primaryTopicType: "dataset",
    primaryTopicId: dataset.id,
    firstSeen: existing?.firstSeen ?? ctx.nowIso,
    lastSeen: ctx.nowIso,
    harvestedFrom: existing?.harvestedFrom ?? `${EIA_API_BASE}${leafPath}/`,
    isAuthoritative: existing?.isAuthoritative ?? true
  };
  if (existing?.sourceRecordId !== undefined)
    base.sourceRecordId = existing.sourceRecordId;
  if (existing?.sourceModified !== undefined)
    base.sourceModified = existing.sourceModified;
  if (existing?.duplicateOf !== undefined) base.duplicateOf = existing.duplicateOf;
  return base as unknown as CatalogRecord;
};

/**
 * Walk the EIA response map, pick out the leaves, and produce an array of
 * IngestNode candidates ready for Phase A validation.
 *
 * NOT Effect-typed — this is a pure synchronous transformation over
 * already-fetched data, equivalent to the `Effect.sync` block exception
 * in CLAUDE.md's rules. Follows the same pattern as the Graph.directed
 * mutate callback in buildIngestGraph above.
 *
 * Emission shape:
 *   - 1 Agent (the EIA agent, with bumped updatedAt)
 *   - 1 Catalog (EIA catalog, bumped updatedAt)
 *   - 1 DataService (EIA API v2, bumped updatedAt, servesDatasetIds
 *     unioned with every dataset id we're about to mint/merge)
 *   - N Dataset nodes (one per leaf route)
 *   - M Distribution nodes (api-access + preserved curated)
 *   - N CatalogRecord nodes (one per dataset)
 */
export const buildCandidateNodes = (
  walkData: ReadonlyMap<string, EiaApiResponse>,
  idx: CatalogIndex,
  ctx: BuildContext
): ReadonlyArray<IngestNode> => {
  interface LeafCandidate {
    readonly slug: string;
    readonly existingDataset: Dataset | null;
    readonly datasetCandidate: Dataset;
    readonly distCandidates: ReadonlyArray<Distribution>;
    readonly crCandidate: CatalogRecord;
  }

  // Pure sync loop over already-fetched walk data. `for ... of` is
  // permitted here by the same CLAUDE.md carve-out used in loadCatalogIndex.
  const leafCandidates: Array<LeafCandidate> = [];
  for (const [path, resp] of walkData) {
    if (path === "") continue; // skip the root (no dataset)
    const childRoutes = resp.response.routes ?? [];
    if (childRoutes.length > 0) continue; // not a leaf — parent categories only

    const slug = slugifyRoute(path);
    const parents = path.split("/").slice(0, -1);
    const existingDataset = idx.datasetsByRoute.get(path) ?? null;

    const datasetCandidate = buildDatasetCandidate(
      { path, parents, response: resp.response },
      ctx,
      existingDataset
    );
    const distCandidates = buildDistributionCandidates(
      { path, parents, response: resp.response },
      datasetCandidate.id,
      ctx,
      idx
    );
    // Re-stitch the freshly-minted distribution ids back onto the dataset
    // candidate. The initial build leaves distributionIds empty because
    // distributions are minted afterwards.
    const datasetWithDists = {
      ...datasetCandidate,
      distributionIds: distCandidates.map((d) => d.id)
    } as Dataset;

    const existingCr =
      idx.catalogRecordsByCatalogAndPrimaryTopic.get(
        `${ctx.eiaCatalog.id}::${datasetWithDists.id}`
      ) ?? null;
    const crCandidate = buildCatalogRecord(
      datasetWithDists,
      ctx,
      existingCr,
      path
    );

    leafCandidates.push({
      slug,
      existingDataset,
      datasetCandidate: datasetWithDists,
      distCandidates,
      crCandidate
    });
  }

  // Top-level scope nodes. The DataService node carries the union of its
  // existing servesDatasetIds with every Dataset id we just minted/merged.
  const allDatasetIds = Array.from(
    new Set<Dataset["id"]>([
      ...ctx.eiaDataService.servesDatasetIds,
      ...leafCandidates.map((l) => l.datasetCandidate.id)
    ])
  );

  const agentNode: IngestNode = {
    _tag: "agent",
    slug: "eia",
    data: { ...ctx.eiaAgent, updatedAt: ctx.nowIso as Agent["updatedAt"] }
  };
  const catalogNode: IngestNode = {
    _tag: "catalog",
    slug: "eia",
    data: { ...ctx.eiaCatalog, updatedAt: ctx.nowIso as Catalog["updatedAt"] }
  };
  const dataServiceNode: IngestNode = {
    _tag: "data-service",
    slug: "eia-api",
    data: {
      ...ctx.eiaDataService,
      servesDatasetIds: allDatasetIds,
      updatedAt: ctx.nowIso as DataService["updatedAt"]
    }
  };

  const datasetNodes: Array<IngestNode> = leafCandidates.map((l) => ({
    _tag: "dataset" as const,
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
    _tag: "catalog-record" as const,
    slug: `${l.slug}-cr`,
    data: l.crCandidate
  }));

  return [
    agentNode,
    catalogNode,
    dataServiceNode,
    ...datasetNodes,
    ...distNodes,
    ...crNodes
  ];
};

// ---------------------------------------------------------------------------
// Phase A — validation gate (Task 8)
// ---------------------------------------------------------------------------
//
// Every candidate node is re-decoded through its matching domain schema
// before it is ever allowed onto the ingest graph. Two design notes:
//
//   1. The validation operates on the *candidate array*, not on the graph.
//      Phase A (validate) → Phase B (write) is gated on an all-clean
//      partition so that the bytes Phase B writes are byte-identical to
//      the bytes Phase A blessed.
//
//   2. `Effect.partition` runs every candidate in one parallel pass so a
//      fix-and-rerun cycle catches every Phase A problem at once instead
//      of failing fast on the first bad node. The tuple order is
//      `[excluded, satisfying]` = `[failures, successes]` (verified at
//      .reference/effect/packages/effect/src/Effect.ts:782).
//
// `validateNode` returns a NEW IngestNode whose `data` field is the
// *post-decode* value — Schema decoding may canonicalize or transform
// values, and the caller must use the returned successes (not the
// inputs) to construct the IngestGraph so Phase B writes what Phase A
// validated.

export const validateNode = (
  node: IngestNode
): Effect.Effect<IngestNode, EiaIngestSchemaError> =>
  Effect.gen(function* () {
    const mapErr = (issue: unknown) =>
      new EiaIngestSchemaError({
        kind: node._tag,
        slug: node.slug,
        message: formatSchemaParseError(issue as Parameters<typeof formatSchemaParseError>[0])
      });
    switch (node._tag) {
      case "agent": {
        const decoded = yield* Schema.decodeUnknownEffect(Agent)(node.data).pipe(
          Effect.mapError(mapErr)
        );
        return { ...node, data: decoded } as IngestNode;
      }
      case "catalog": {
        const decoded = yield* Schema.decodeUnknownEffect(Catalog)(node.data).pipe(
          Effect.mapError(mapErr)
        );
        return { ...node, data: decoded } as IngestNode;
      }
      case "data-service": {
        const decoded = yield* Schema.decodeUnknownEffect(DataService)(node.data).pipe(
          Effect.mapError(mapErr)
        );
        return { ...node, data: decoded } as IngestNode;
      }
      case "dataset": {
        const decoded = yield* Schema.decodeUnknownEffect(Dataset)(node.data).pipe(
          Effect.mapError(mapErr)
        );
        return { ...node, data: decoded, merged: node.merged } as IngestNode;
      }
      case "distribution": {
        const decoded = yield* Schema.decodeUnknownEffect(Distribution)(node.data).pipe(
          Effect.mapError(mapErr)
        );
        return { ...node, data: decoded } as IngestNode;
      }
      case "catalog-record": {
        const decoded = yield* Schema.decodeUnknownEffect(CatalogRecord)(
          node.data
        ).pipe(Effect.mapError(mapErr));
        return { ...node, data: decoded } as IngestNode;
      }
    }
  });

export const validateCandidates = (
  candidates: ReadonlyArray<IngestNode>
): Effect.Effect<{
  readonly failures: ReadonlyArray<EiaIngestSchemaError>;
  readonly successes: ReadonlyArray<IngestNode>;
}> =>
  Effect.gen(function* () {
    const [failures, successes] = yield* Effect.partition(
      candidates,
      (candidate) => validateNode(candidate),
      { concurrency: "unbounded" }
    );
    return { failures, successes };
  });

// ---------------------------------------------------------------------------
// Atomic write helpers + entity-id ledger (Task 9)
// ---------------------------------------------------------------------------
//
// `writeEntityFile` is the single source of truth for all on-disk writes.
// It routes every write through a temp-and-rename so a partially-written
// file never appears at the final path. Parent directories are created
// recursively on demand.
//
// The entity-id ledger (`.entity-ids.json`) maps a stable "kind:slug"
// key to the minted entity id and is the rerun-safety backbone of the
// ingest: on the second run, slugs that already have an id skip the
// ULID mint and the original id is preserved. `loadLedger` deliberately
// distinguishes the missing-file case (a normal first-run condition,
// `{}` is returned) from any other read/decode failure, which must
// abort the run rather than silently re-mint every id on disk trouble.

export const writeEntityFile = (
  filePath: string,
  content: string
): Effect.Effect<void, EiaIngestFsError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs_ = yield* FileSystem.FileSystem;
    const path_ = yield* Path.Path;
    const dir = path_.dirname(filePath);
    const now = yield* Clock.currentTimeMillis;
    const tmp = `${filePath}.tmp-${String(now)}`;
    yield* fs_.makeDirectory(dir, { recursive: true }).pipe(
      Effect.mapError(
        (cause) =>
          new EiaIngestFsError({
            operation: "makeDirectory",
            path: dir,
            message: stringifyUnknown(cause)
          })
      )
    );
    yield* fs_.writeFileString(tmp, content).pipe(
      Effect.mapError(
        (cause) =>
          new EiaIngestFsError({
            operation: "writeFileString",
            path: tmp,
            message: stringifyUnknown(cause)
          })
      )
    );
    yield* fs_.rename(tmp, filePath).pipe(
      Effect.mapError(
        (cause) =>
          new EiaIngestFsError({
            operation: "rename",
            path: filePath,
            message: stringifyUnknown(cause)
          })
      )
    );
  });

export const EntityIdLedger = Schema.Record(Schema.String, Schema.String);
export type EntityIdLedger = Schema.Schema.Type<typeof EntityIdLedger>;

const encodeEntityIdLedger = encodeJsonStringPrettyWith(EntityIdLedger);
const decodeEntityIdLedger = decodeJsonStringEitherWith(EntityIdLedger);

/**
 * Structural match for the Effect platform's "file not found" error.
 * PlatformError is a tagged wrapper around either BadArgument or
 * SystemError; SystemError carries a nested `_tag` discriminator with
 * `"NotFound"` as its ENOENT analogue (see
 * .reference/effect/packages/effect/src/PlatformError.ts:47-64).
 * We fall back to a string-match on the stringified cause so that a
 * platform update that reshuffles the error class hierarchy still
 * degrades to a safe "treat as missing file" rather than aborting.
 */
const isNotFoundPlatformError = (cause: unknown): boolean => {
  if (
    typeof cause === "object" &&
    cause !== null &&
    "_tag" in cause &&
    (cause as { readonly _tag: unknown })._tag === "PlatformError" &&
    "reason" in cause
  ) {
    const reason = (cause as { readonly reason: unknown }).reason;
    if (
      typeof reason === "object" &&
      reason !== null &&
      "_tag" in reason &&
      (reason as { readonly _tag: unknown })._tag === "NotFound"
    ) {
      return true;
    }
  }
  const msg = stringifyUnknown(cause).toLowerCase();
  return msg.includes("notfound") || msg.includes("enoent") || msg.includes("no such file");
};

export const loadLedger = (
  rootDir: string
): Effect.Effect<
  EntityIdLedger,
  EiaIngestLedgerError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fs_ = yield* FileSystem.FileSystem;
    const path_ = yield* Path.Path;
    const ledgerPath = path_.resolve(rootDir, ".entity-ids.json");

    const readExit = yield* Effect.exit(fs_.readFileString(ledgerPath));
    if (readExit._tag === "Failure") {
      if (isNotFoundPlatformError(readExit.cause)) {
        return {} satisfies EntityIdLedger;
      }
      return yield* new EiaIngestLedgerError({
        message: `Cannot read ledger at ${ledgerPath}: ${stringifyUnknown(readExit.cause)}`
      });
    }

    const decoded = decodeEntityIdLedger(readExit.value);
    if (Result.isFailure(decoded)) {
      return yield* new EiaIngestLedgerError({
        message: `Cannot decode ledger at ${ledgerPath}: ${formatSchemaParseError(decoded.failure)}`
      });
    }
    return decoded.success;
  });

export const saveLedger = (
  rootDir: string,
  ledger: EntityIdLedger
): Effect.Effect<
  void,
  EiaIngestFsError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const path_ = yield* Path.Path;
    const ledgerPath = path_.resolve(rootDir, ".entity-ids.json");
    yield* writeEntityFile(ledgerPath, `${encodeEntityIdLedger(ledger)}\n`);
  });

// ---------------------------------------------------------------------------
// Stub main
// ---------------------------------------------------------------------------

const main = Effect.gen(function* () {
  const config = yield* ScriptConfig;
  const apiKey = Redacted.value(config.apiKey);
  yield* Effect.log(
    `SKY-254 EIA ingest — root=${config.rootDir} dryRun=${String(config.dryRun)}`
  );

  const walkData = yield* getWalkData(config, apiKey);
  yield* Effect.log(`walkData has ${String(walkData.size)} entries`);
});

// Gate the runtime entry so test imports don't trigger `main` (which would
// fail with a missing-EIA_API_KEY ConfigError). Bun sets `import.meta.main`
// to true only when this file is the entry point.
if (import.meta.main) {
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
}
