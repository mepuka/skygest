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
import {
  Agent,
  Catalog,
  CatalogRecord,
  DataService,
  Dataset,
  Distribution
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
//   Agent              → name (strings are stable; EIA agent merge is a
//                        name lookup).
//   Catalog/DataService → publisherAgentId === EIA agent id (at most one
//                        each in the registry).

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

const decodeFileAs = <S extends Schema.Decoder<unknown>>(
  schema: S,
  kind: string,
  slug: string
) =>
  (text: string): Effect.Effect<S["Type"], EiaIngestSchemaError> => {
    const result = decodeJsonStringEitherWith(schema)(text);
    return Result.isFailure(result)
      ? Effect.fail(
          new EiaIngestSchemaError({
            kind,
            slug,
            message: formatSchemaParseError(result.failure)
          })
        )
      : Effect.succeed(result.success as S["Type"]);
  };

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
      { concurrency: 10 }
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
          (a) => a.scheme === "eia-route" && a.value.includes("/")
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
